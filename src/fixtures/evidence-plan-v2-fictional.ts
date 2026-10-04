import type { V2Material, V2PlanCommand, V2SourceSelection } from '../types/evidence-plan-v2';

/** Synthetic only. Does not copy the user's JD, profile, reviews or old reports. */
export const fictionalId = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export function fictionalV2Material(count = 6): V2Material {
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error('FICTIONAL_COUNT_INVALID');
  const examples = [
    ['qualification', '毕业时间在2026年9月至2027年8月期间；最高学历毕业后无全职工作经验。'],
    ['core_duty', '提出AI产品需求，设计功能并辅助迭代。'],
    ['core_duty', '追踪产品指标并分析实验数据。'],
    ['preferred', '计算机相关专业优先。'],
    ['preferred', '计算机相关专业优先；有实习或项目快速验证经验优先。'],
    ['core_duty', '协调校园活动任务并说明协作范围。'],
  ] as const;
  const m: V2Material = { binding: { draftId: fictionalId(1), draftRevision: 3, profileVersion: 2, confirmationDigest: 'fictional-confirmation' },
    jdText: '', requirements: [], profile: { structureVersion: '1.0.0', targetDirections: ['虚构方向'], facts: [
      { factId: 'EDU', category: 'education', context: 'education', statement: '预计2027年6月毕业。计算机相关专业本科在读。' },
      { factId: 'PROJECT', category: 'project', context: 'personal_project', statement: '个人AI助手项目中提出需求、设计功能，并使用Agent辅助迭代。没有企业上线或用户验证。' },
      { factId: 'CAMPUS', category: 'project', context: 'campus', statement: '在校园活动中安排任务并协调同学。没有企业客户交付。' },
      { factId: 'KNOWLEDGE', category: 'project', context: 'personal_project', statement: '用个人知识整理工作流整理资料。没有产品指标追踪。' },
      { factId: 'PREFERENCE', category: 'preference', context: 'self_report', statement: '希望参与团队交付工作。' },
    ] } };
  for (let i = 0; i < count; i++) {
    const [kind, exactText] = examples[i % examples.length]; const start = m.jdText.length;
    m.jdText += exactText + '\n'; const end = start + exactText.length, jdId = `R${i + 1}`;
    const split = exactText.indexOf('；') + 1;
    m.requirements.push({ jdId, kind, exactText, start, end,
      conditions: kind !== 'qualification' ? [] : [
        { key: `${jdId}/date`, start, end: start + split, basisKind: 'verified_date_rule' },
        { key: `${jdId}/employment`, start: start + split, end, basisKind: 'unresolved' }],
      sections: kind !== 'preferred' ? [] : split ? [
        { key: `${jdId}/background`, start, end: start + split, kind: 'background' },
        { key: `${jdId}/task`, start: start + split, end, kind: 'task' }]
        : [{ key: `${jdId}/background`, start, end, kind: 'background' }] });
  }
  return m;
}
export function fictionalRowCommand(m: V2Material, jdId: string, revision: number): Extract<V2PlanCommand, { action: 'review_row' }> {
  const r = m.requirements.find(r => r.jdId === jdId)!;
  const select = (factId: string, evidenceType: V2SourceSelection['evidenceType'], sectionKey: string | null): V2SourceSelection => ({
    factId, evidenceType, sectionKey, start: 0, end: m.profile.facts.find(f => f.factId === factId)!.statement.length });
  const selectedSources = r.kind === 'qualification' ? [select('EDU', 'qualification', null)]
    : r.kind === 'preferred' ? r.sections.map(s => s.kind === 'background' ? select('EDU', 'background', s.key) : select('PROJECT', 'personal_practice', s.key))
    : /指标/.test(r.exactText) ? [] : /校园/.test(r.exactText) ? [select('CAMPUS', 'transferable', null)] : [select('PROJECT', 'personal_practice', null)];
  return { action: 'review_row', expectedRevision: revision, jdId, choice: selectedSources.length ? 'limited_support' : 'no_clue',
    selectedSources, missingScope: selectedSources.length ? '仅支持原句所述场景与动作；其它范围仍待核对。' : '当前材料暂无线索，不代表没有经历。',
    pendingReason: '', intent: 'confirm_and_continue', acknowledged: true };
}
