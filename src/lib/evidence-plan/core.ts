import type { EvidencePlanOption, EvidencePlanSource, EvidenceReviewInput, EvidenceReviewRow, ReviewedSelection } from '../../types/evidence-plan.ts';
import { object, array, text, boolean, integer, strings, oneOf } from '../report/schema.ts';
import { jdItemsSchema, profileSchema } from '../report/schema.ts';

export class EvidencePlanError extends Error {
  readonly code: 'SOURCE_INVALID' | 'INPUT_INVALID' | 'STALE_PLAN' | 'REVIEW_REQUIRED' | 'EVIDENCE_NOT_ALLOWED' | 'ANSWER_INVALID' | 'ANSWER_COVERAGE' | 'ANSWER_MISALIGNED';
  constructor(code: EvidencePlanError['code']) {
    super(code); this.name = 'EvidencePlanError'; this.code=code;
  }
}
const inputSchema = object({
  contractVersion: oneOf('evidence-plan-prototype/1'),
  binding: object({ draftId: text, draftRevision: integer, confirmationDigest: text, profileVersion: integer }),
  planRevision: integer,
  rows: array(object({ jdId: text, choice: oneOf('limited_support', 'no_clue', 'pending'),
    selections: array(object({ actionKey: text, evidenceType: oneOf('qualification', 'same_task', 'transferable', 'personal_practice') })),
    existingAction: (v,p,e) => { if (typeof v !== 'string' || v.length > 800) e.push(p); },
    missingScope: (v,p,e) => { if (typeof v !== 'string' || v.length > 800) e.push(p); }, checked: boolean })),
  acknowledged: boolean,
});
const sourceSchema = object({
  binding: object({ draftId: text, draftRevision: integer, confirmationDigest: text, profileVersion: integer }),
  jdText: text, jdItems: jdItemsSchema, profile: profileSchema,
  actions: array(object({ key: text, factId: text, quote: text, capability: text })),
  scopes: array(object({ jdId: text, capabilities: strings,
    qualificationStatus: (v,p,e) => { if (v !== undefined) oneOf('meets', 'does_not_meet', 'needs_confirmation')(v,p,e); } })),
});
const unique = (keys: string[]) => new Set(keys).size === keys.length;
export function checkSource(source: EvidencePlanSource): void {
  const errors: string[] = []; sourceSchema(source, 'source', errors);
  if (errors.length) throw new EvidencePlanError('SOURCE_INVALID');
  const { jdItems, actions, scopes, profile, binding } = source;
  if (!jdItems.length || !unique(jdItems.map(i=>i.jdId)) || !unique(profile.facts.map(f=>f.factId)) ||
      !unique(actions.map(a=>a.key)) || !unique(scopes.map(s=>s.jdId)) ||
      scopes.length !== jdItems.length || binding.draftRevision < 1 || binding.profileVersion < 1 ||
      jdItems.some(i=>!source.jdText.includes(i.exactText) || !scopes.some(s=>s.jdId===i.jdId)) ||
      actions.some(a=>!profile.facts.some(f=>f.factId===a.factId && f.statement.includes(a.quote))) ||
      scopes.some(s=>s.qualificationStatus && jdItems.find(i=>i.jdId===s.jdId)?.kind !== 'qualification')) {
    throw new EvidencePlanError('SOURCE_INVALID');
  }
}
/** Finite, curated action/scope compatibility. User notes never create new source facts or capabilities. */
export function optionsFor(source: EvidencePlanSource, jdId: string): EvidencePlanOption[] {
  checkSource(source);
  const requirement = source.jdItems.find(i=>i.jdId===jdId);
  const scope = source.scopes.find(s=>s.jdId===jdId);
  if (!requirement || !scope) throw new EvidencePlanError('SOURCE_INVALID');
  return source.actions.flatMap(action=>{
    const fact = source.profile.facts.find(f=>f.factId===action.factId)!;
    if (!scope.capabilities.includes(action.capability) || ['preference','constraint'].includes(fact.category)) return [];
    let types: ReviewedSelection['evidenceType'][];
    if (requirement.kind === 'qualification') {
      if (fact.category !== 'education' && fact.context !== 'formal_work') return [];
      types = ['qualification'];
    } else {
      if (fact.category === 'education') return [];
      types = fact.context === 'personal_project' ? ['personal_practice'] : ['same_task','transferable'];
    }
    return types.map(evidenceType=>({ actionKey: action.key, evidenceType,
      label: `${fact.factId} · ${evidenceType}`, factStatement: fact.statement, scene: fact.context, actionQuote: action.quote }));
  });
}
export function checkReview(source: EvidencePlanSource, value: unknown): EvidenceReviewInput {
  checkSource(source);
  const errors: string[] = []; inputSchema(value, 'review', errors);
  if (errors.length) throw new EvidencePlanError('INPUT_INVALID');
  const review = value as EvidenceReviewInput;
  if (Object.entries(source.binding).some(([k,v])=>review.binding[k as keyof typeof source.binding] !== v)) throw new EvidencePlanError('STALE_PLAN');
  if (review.planRevision < 1 || review.rows.length !== source.jdItems.length ||
      !unique(review.rows.map(r=>r.jdId)) || source.jdItems.some(i=>!review.rows.some(r=>r.jdId===i.jdId))) throw new EvidencePlanError('INPUT_INVALID');
  if (!review.acknowledged || review.rows.some(r=>r.choice==='pending' || !r.checked)) throw new EvidencePlanError('REVIEW_REQUIRED');
  for (const row of review.rows) checkRow(source,row);
  return structuredClone(review);
}
export function checkRow(source: EvidencePlanSource, row: EvidenceReviewRow): void {
    if(row.choice==='pending') throw new EvidencePlanError('REVIEW_REQUIRED');
    const options = optionsFor(source, row.jdId);
    if (!unique(row.selections.map(s=>s.actionKey)) || row.selections.some(s=>!options.some(o=>o.actionKey===s.actionKey && o.evidenceType===s.evidenceType)) ||
        (row.choice==='no_clue' && (row.selections.length || row.existingAction.trim())) || (row.choice==='limited_support' && (!row.selections.length || !row.existingAction.trim())) || !row.missingScope.trim()) {
      throw new EvidencePlanError('EVIDENCE_NOT_ALLOWED');
    }
}
export interface ReviewDemoState { review: EvidenceReviewInput; confirmed: boolean; activeJdId: string; error: string | null }
export function initialReview(source: EvidencePlanSource): EvidenceReviewInput {
  checkSource(source);
  return { contractVersion: 'evidence-plan-prototype/1', binding: structuredClone(source.binding), planRevision: 1, acknowledged: false,
    rows: source.jdItems.map(i=>({ jdId:i.jdId,choice:'pending',selections:[],existingAction:'',missingScope:'',checked:false })) };
}
/** Any edit invalidates row review and overall confirmation. Qualification/task conclusions remain separate. */
export function editReview(state: ReviewDemoState, patch: Partial<Pick<EvidenceReviewRow,'choice'|'selections'|'existingAction'|'missingScope'>>): ReviewDemoState {
  return { ...state, confirmed:false,error:null,review:{...state.review,planRevision:state.review.planRevision+1,acknowledged:false,
    rows:state.review.rows.map(r=>r.jdId===state.activeJdId ? {...r,...patch,checked:false,...(patch.choice==='no_clue'||patch.choice==='pending'?{selections:[],existingAction:''}:{})}:r) } };
}
