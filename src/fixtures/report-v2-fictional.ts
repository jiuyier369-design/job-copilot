import type { NarrativeBundle, ReportV2Manifest, ReportV2Record } from '../types/report-v2.ts';
import { REPORT_V2_VERSIONS } from '../types/report-v2.ts';
import type { V2PlanEnvelope } from '../types/evidence-plan-v2.ts';
import { fictionalId, fictionalRowCommand, fictionalV2Material } from './evidence-plan-v2-fictional.ts';
import { createV2PlanSimulator } from '../lib/evidence-plan-v2/domain.ts';
import { compileReportV2Manifest } from '../lib/report-v2/manifest.ts';
import { assembleReportV2 } from '../lib/report-v2/validate.ts';
import type { JdDraft } from '../types/jd-review.ts';
import { draftDigest } from '../lib/jd/service.ts';

/** Complete synthetic report factory, never a real person's profile/report or model output. */
export function fictionalConfirmedV2Plan(count = 14, inputMaterial = fictionalV2Material(count)) {
  const material = structuredClone(inputMaterial);
  material.requirements.forEach(r => { r.jdId = r.jdId.replace(/^R/, 'JD'); });
  const draft: JdDraft = { id: material.binding.draftId, revision: material.binding.draftRevision,
    ruleVersion: 'rules-1', rawText: material.jdText,
    segments: material.requirements.map(r => ({ id: r.jdId, start: r.start, end: r.end, sourceStart: r.start, sourceEnd: r.end, suggestedCategory: r.kind, category: r.kind })),
    confirmation: null };
  draft.confirmation = { revision: draft.revision, digest: draftDigest(draft), confirmedAt: '2026-10-03T00:00:00Z' };
  material.binding.confirmationDigest = draft.confirmation.digest;
  const owner = fictionalId(900), id = fictionalId(1000), db = createV2PlanSimulator();
  let serial = 1000;
  const env = (command: V2PlanEnvelope['command']): V2PlanEnvelope => ({ contractVersion: 'evidence-plan-write/2', operationId: fictionalId(serial++), command });
  const created = db.execute(owner, null, env({ action: 'create_plan', draftId: material.binding.draftId,
    expectedDraftRevision: material.binding.draftRevision, expectedProfileVersion: material.binding.profileVersion }), material);
  if (created.receipt.outcome !== 'applied') throw new Error('SYNTHETIC_FIXTURE_INVALID');
  for (const item of material.requirements) {
    const result = db.execute(owner, id, env(fictionalRowCommand(material, item.jdId, db.read(owner, id, material).revision)), material);
    if (result.receipt.outcome !== 'applied') throw new Error('SYNTHETIC_FIXTURE_INVALID');
  }
  const confirmed = db.execute(owner, id, env({ action: 'confirm_plan', expectedRevision: db.read(owner, id, material).revision, acknowledged: true }), material);
  if (confirmed.resource?.status !== 'confirmed') throw new Error('SYNTHETIC_FIXTURE_INVALID');
  return { owner, material, plan: db.snapshot(owner, id)!, draft };
}
export function fictionalNarrativeV2(manifest: ReportV2Manifest): NarrativeBundle {
  return { contractVersion: 'narrative-bundle/2', manifestDigest: manifest.digest,
    answers: manifest.slots.map(s => ({ slotKey: s.slotKey,
      explanation: s.kind === 'qualification' ? '日期部分按已核对资料判断；其它未知条件仍须单独核验。'
        : s.links.length ? '当前原句提供有限支持；缺少正式企业环境中的用户验证与上线交付证据。' : '当前材料暂无线索，不代表从未做过。',
      missingAspects: ['超出已核对动作的范围仍待核对。'],
      links: s.links.map(l => ({ linkKey: l.linkKey,
        connection: ['qualification', 'background'].includes(l.evidenceType) ? '仅支持该资格或背景原句的核对。' : '仅支持所选原句中的有限动作。',
        boundary: l.scene === 'personal_project' ? '个人场景实践，不是正式企业任职。' : '保留原始场景，不升级企业经历。' })),
      conditions: s.conditionSlots.map(c => ({ conditionKey: c.conditionKey, explanation: c.status === 'meets' ? '毕业日期条件符合窗口；其它条件不由日期推出。'
        : c.status === 'does_not_meet' ? '毕业日期条件不在窗口内。' : '当前条件仍需核验，不因资料选择自动视为符合。' })),
      preferredSections: s.preferredSections.map(p => ({ sectionKey: p.sectionKey, explanation: p.kind === 'background'
        ? '专业仅为加分背景，不是基本资格硬门槛。' : '项目提供个人场景中的有限支持，未证明企业交付。' })) })),
    materialFit: { level: 'partial', summary: '有个人实践和校园动作的有限支持；企业交付范围仍缺证据。',
      supportingSlotKeys: manifest.slots.filter(s => s.links.length).map(s => s.slotKey), limitingSlotKeys: manifest.slots.map(s => s.slotKey) },
    applicationAction: { category: manifest.allowedActions[0], summary: manifest.verificationAnchors.length
      ? '先核验未知资格，再独立决定投递；实习竞争力与资格分开。' : '根据已核对材料独立决定投递，招聘状态另行核验。',
      conditionalNextAction: '核验通过后可考虑投递；当前判断不证明仍在招聘。', verificationKeys: manifest.verificationAnchors.map(v => v.verificationKey) },
    inferences: [{ inferenceKey: manifest.inferenceKeys[0], basisSlotKeys: manifest.slots.map(s => s.slotKey),
      statement: '材料可能支持部分动作，这是推断而非资格认证。', uncertainty: '实际岗位范围和材料外经历需人工核验。' }],
    verificationAnswers: manifest.verificationAnchors.map(v => ({ verificationKey: v.verificationKey,
      question: v.origin === 'jd_unresolved_condition' ? '请核对这一未知资格条件是否成立。' : '请核对该岗位实际任务与交付范围。',
      reason: v.origin === 'jd_unresolved_condition' ? '现有资料未能证明此条件。' : '来源只覆盖有限场景，岗位范围仍须核验。', askWhomOrHow: '对照本人实际情况和招聘方原要求核验。',
      answerImpacts: ['若符合该条件，再继续评估投递。', '若不符合该条件，保留差异并重新评估资格。'] })),
    resumeSuggestions: manifest.resumeAnchors.slice(0, 1).map(a => ({ ...a,
      suggestedWording: manifest.slots.flatMap(s => s.links).find(l => a.basisLinkKeys.includes(l.linkKey))!.exactQuote,
      factualBoundary: '仅表达所引用原句的动作和原始场景，不增加职责、业绩或资历。' })) };
}
export function fictionalCompleteReportV2(count = 14) {
  const setup = fictionalConfirmedV2Plan(count), manifest = compileReportV2Manifest(setup.owner, setup.plan, setup.material);
  const narrative = fictionalNarrativeV2(manifest), report = assembleReportV2(narrative, manifest), m = setup.material;
  const record: ReportV2Record = { id: fictionalId(5000), userId: setup.owner, createdAt: '2026-10-03T00:00:00Z',
    company: '虚构测试公司', jobTitle: '虚构岗位', city: null, direction: null, jdSourceUrl: null,
    versions: { ...REPORT_V2_VERSIONS, promptVersion: 'fictional-offline/2', testDataVersion: 'synthetic-v2/1' },
    modelMetadata: { provider: 'offline-mock', model: 'deterministic', inputTokens: null, outputTokens: null, totalTokens: null,
      elapsedMs: 0, finishReason: 'stop', costEstimate: null, pricingVersion: null },
    provenance: { jdText: m.jdText, jdItems: m.requirements,
      jdConfirmationSnapshot: setup.draft, profileSnapshot: m.profile, profileVersion: m.binding.profileVersion,
      planSnapshot: setup.plan, planRevision: setup.plan.revision, sourceDigest: manifest.sourceDigest, planDigest: manifest.planDigest, slotManifestDigest: manifest.digest }, report };
  return { ...setup, manifest, narrative, report, record };
}
