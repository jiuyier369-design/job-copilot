import type {
  EvidenceType,
  FactContext,
  JobAnalysisRecord,
  JdItem,
  ProfileFact,
  QualificationAssessment,
  TaskAssessment,
} from "@/types/job-copilot";

const evidenceLabels: Record<EvidenceType, string> = {
  same_task: "同类任务证据",
  transferable: "可迁移证据",
  personal_practice: "个人实践",
  no_evidence: "暂无证据",
};

const evidenceStyles: Record<EvidenceType, string> = {
  same_task: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  transferable: "bg-sky-50 text-sky-800 ring-sky-200",
  personal_practice: "bg-violet-50 text-violet-800 ring-violet-200",
  no_evidence: "bg-slate-100 text-slate-700 ring-slate-200",
};

const contextLabels: Record<FactContext, string> = {
  education: "教育背景",
  formal_work: "正式工作",
  entrepreneurship: "创业工作室",
  campus: "校园组织",
  competition: "竞赛",
  personal_project: "个人项目",
  self_report: "个人陈述",
};

const qualificationLabels = {
  meets: "明确符合",
  does_not_meet: "明确不符合",
  needs_confirmation: "待确认",
} as const;

const qualificationStyles = {
  meets: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  does_not_meet: "bg-rose-50 text-rose-800 ring-rose-200",
  needs_confirmation: "bg-amber-50 text-amber-800 ring-amber-200",
} as const;

const actionLabels = {
  prioritize: "优先投递",
  verify_first: "核验后决定",
  try_with_weak_evidence: "证据较弱但可尝试",
  explicit_hard_gate: "存在明确硬门槛",
} as const;

const materialLabels = {
  strong: "较强",
  partial: "部分匹配",
  weak: "证据较弱",
} as const;

const cardClass = "rounded-3xl border border-slate-200/80 bg-white shadow-[0_16px_48px_-32px_rgba(15,23,42,0.28)]";

function Badge({
  children,
  className = "bg-slate-100 text-slate-700 ring-slate-200",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold leading-5 ring-1 ring-inset ${className}`}>
      {children}
    </span>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-7 text-sm text-slate-500">
      {label}
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-5">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-700">{eyebrow}</p>
      <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h2>
      {description ? <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p> : null}
    </div>
  );
}

function RefBadges({ ids, label }: { ids: string[]; label: string }) {
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-slate-500">{label}</span>
      {ids.map((id) => <Badge key={id}>{id}</Badge>)}
    </div>
  );
}

function FactBlock({ fact }: { fact: ProfileFact | undefined }) {
  if (!fact) {
    return <p className="text-sm text-rose-700">画像事实引用未找到</p>;
  }
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge>{fact.factId}</Badge>
        <span className="text-xs font-medium text-slate-500">发生场景：{contextLabels[fact.context]}</span>
      </div>
      <p className="text-sm leading-6 text-slate-700">{fact.statement}</p>
    </div>
  );
}

function QualificationCard({
  item,
  assessment,
  facts,
}: {
  item: JdItem | undefined;
  assessment: QualificationAssessment;
  facts: Map<string, ProfileFact>;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-sky-700">{assessment.jdId} · JD 原文事实</p>
          <h3 className="mt-2 text-sm font-semibold leading-6 text-slate-900">{item?.exactText ?? "JD 原文引用未找到"}</h3>
        </div>
        <Badge className={qualificationStyles[assessment.status]}>{qualificationLabels[assessment.status]}</Badge>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{assessment.explanation}</p>
      {assessment.factIds.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {assessment.factIds.map((id) => <FactBlock key={id} fact={facts.get(id)} />)}
        </div>
      ) : (
        <p className="mt-4 text-xs text-slate-500">当前画像未提供可引用的资格事实。</p>
      )}
    </article>
  );
}

function TaskCard({
  item,
  assessment,
  facts,
}: {
  item: JdItem | undefined;
  assessment: TaskAssessment;
  facts: Map<string, ProfileFact>;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-sky-700">{assessment.jdId} · JD 原文事实</p>
          <h3 className="mt-2 text-sm font-semibold leading-6 text-slate-900">{item?.exactText ?? "JD 原文引用未找到"}</h3>
        </div>
        <Badge className={evidenceStyles[assessment.evidenceType]}>{evidenceLabels[assessment.evidenceType]}</Badge>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{assessment.explanation}</p>
      {assessment.needsUserConfirmation ? (
        <p className="mt-2 text-xs font-semibold text-amber-700">待用户确认画像事实</p>
      ) : null}
      {assessment.evidenceLinks.length > 0 ? (
        <div className="mt-4 space-y-3">
          {assessment.evidenceLinks.map((link, index) => (
            <div key={`${assessment.jdId}-${index}`} className="rounded-2xl bg-slate-50 p-4">
              <Badge className={evidenceStyles[link.evidenceType]}>{evidenceLabels[link.evidenceType]}</Badge>
              <div className="mt-3 grid gap-2">
                {link.factIds.map((id) => <FactBlock key={id} fact={facts.get(id)} />)}
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-700"><span className="font-semibold">关联：</span>{link.connection}</p>
              <p className="mt-1 text-sm leading-6 text-slate-600"><span className="font-semibold">能力边界：</span>{link.boundary}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          当前画像暂无可引用的任务证据。
        </div>
      )}
      {assessment.missingAspects.length > 0 ? (
        <p className="mt-4 text-sm leading-6 text-slate-600">
          <span className="font-semibold text-slate-700">仍缺少：</span>{assessment.missingAspects.join("、")}
        </p>
      ) : null}
    </article>
  );
}

export function ReportView({ analysis, mode = 'sample' }: { analysis: JobAnalysisRecord; mode?: 'sample'|'saved-test'|'saved' }) {
  const label = mode === 'sample' ? '只读固定样例' : mode === 'saved-test' ? '已保存测试报告 · fixture' : '本人历史报告';
  const notice = mode === 'sample' ? '页面使用固定样例，不代表岗位当前仍在招'
    : mode === 'saved-test' ? '虚构验收数据，确定性 fixture 输出；不是 DeepSeek 或真实模型结果'
    : '依据生成时的不可变快照；不代表岗位当前仍在招';
  const { report } = analysis;
  const jdItems = new Map(analysis.jdItems.map((item) => [item.jdId, item]));
  const facts = new Map(analysis.profileSnapshot.facts.map((fact) => [fact.factId, fact]));
  const generatedAt = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(analysis.createdAt));

  return (
    <main className="min-h-screen break-words bg-[#f5f7fb] pb-16 text-slate-900">
      <div className="bg-[#10223d] text-white">
        <div className="mx-auto max-w-6xl px-4 pb-12 pt-7 sm:px-8 sm:pb-16">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/15 pb-6">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-sky-400 text-base font-black text-slate-950">J</span>
              <span className="text-sm font-semibold tracking-wide">Job Copilot</span>
              <span className="hidden text-xs text-slate-400 sm:inline">/ 岗位分析报告</span>
            </div>
            <Badge className="bg-white/10 text-sky-100 ring-white/20">{label}</Badge>
          </div>
          <div className="mt-10 max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-300">JOB ANALYSIS REPORT</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{analysis.jobTitle}</h1>
            <p className="mt-3 text-base text-slate-300">{analysis.company}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {analysis.city ? <Badge className="bg-white/10 text-white ring-white/20">{analysis.city}</Badge> : null}
              {analysis.direction ? <Badge className="bg-white/10 text-white ring-white/20">{analysis.direction}</Badge> : null}
              <Badge className="bg-white/10 text-white ring-white/20">报告 v{analysis.reportStructureVersion}</Badge>
            </div>
            <p className="mt-5 text-xs leading-5 text-slate-400">
              保存日期 {generatedAt} · 依据画像版本 {analysis.profileVersion} · {notice}
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-10 px-4 sm:px-8">
        <section aria-label="报告结论" className="-mt-6 grid gap-4 md:grid-cols-2">
          <div className={`${cardClass} p-6 sm:p-7`}>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">01 / MATERIAL FIT</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold">材料适配判断</h2>
              <Badge className="bg-sky-50 text-sky-800 ring-sky-200">{materialLabels[report.materialFit.level]}</Badge>
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-600">{report.materialFit.summary}</p>
            <div className="mt-5 space-y-2">
              <RefBadges ids={report.materialFit.supportingJdIds} label="支持" />
              <RefBadges ids={report.materialFit.limitingJdIds} label="限制" />
            </div>
          </div>
          <div className={`${cardClass} p-6 sm:p-7`}>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-700">02 / NEXT ACTION</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold">投递动作建议</h2>
              <Badge className="bg-violet-50 text-violet-800 ring-violet-200">{actionLabels[report.applicationAction.category]}</Badge>
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-600">{report.applicationAction.summary}</p>
            {report.applicationAction.conditionalNextAction ? (
              <p className="mt-4 text-sm font-semibold text-violet-800">条件满足后：{report.applicationAction.conditionalNextAction}</p>
            ) : null}
            <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">报告提供判断依据，最终是否投递由你决定。</p>
          </div>
        </section>

        <section id="qualifications" className={`${cardClass} p-5 sm:p-7`}>
          <SectionHeading eyebrow="01 / ELIGIBILITY" title="资格判断" description="只判断 JD 明确写出的条件，学历与毕业时间不会被当作任务经历。" />
          <div className="grid gap-3">
            {report.qualifications.length > 0
              ? report.qualifications.map((assessment) => (
                  <QualificationCard key={assessment.jdId} item={jdItems.get(assessment.jdId)} assessment={assessment} facts={facts} />
                ))
              : <EmptyState label="暂无资格条件记录；如 JD 有明确资格要求，应补齐后再使用报告。" />}
          </div>
        </section>

        <section id="core-duties" className={`${cardClass} p-5 sm:p-7`}>
          <SectionHeading eyebrow="02 / RESPONSIBILITIES" title="核心职责与证据" description="逐项展示岗位任务、画像事实、发生场景和可以迁移的边界。" />
          <div className="grid gap-3">
            {report.coreDuties.length > 0
              ? report.coreDuties.map((assessment) => (
                  <TaskCard key={assessment.jdId} item={jdItems.get(assessment.jdId)} assessment={assessment} facts={facts} />
                ))
              : <EmptyState label="暂无核心职责分析；这份报告还不能用于判断岗位适配。" />}
          </div>
        </section>

        <section id="preferred" className={`${cardClass} p-5 sm:p-7`}>
          <SectionHeading eyebrow="03 / PREFERRED" title="优先条件与加分项" description="加分项与硬性资格分开展示。" />
          <div className="grid gap-3">
            {report.preferredItems.length > 0
              ? report.preferredItems.map((assessment) => (
                  <TaskCard key={assessment.jdId} item={jdItems.get(assessment.jdId)} assessment={assessment} facts={facts} />
                ))
              : <EmptyState label="这份报告没有单独记录优先条件或加分项。" />}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section id="inferences" className={`${cardClass} p-5 sm:p-7`}>
            <SectionHeading eyebrow="04 / INFERENCE" title="AI 推断" description="以下判断由 JD 职责推得，并非招聘方明示条件。" />
            {report.inferences.length > 0 ? (
              <div className="space-y-3">
                {report.inferences.map((inference, index) => (
                  <article key={index} className="rounded-2xl bg-slate-50 p-4">
                    <RefBadges ids={inference.jdIds} label="JD 依据" />
                    <p className="mt-3 text-sm font-semibold leading-6 text-slate-800">{inference.statement}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">不确定性：{inference.uncertainty}</p>
                  </article>
                ))}
              </div>
            ) : <EmptyState label="暂无 AI 推断；报告不会以推断补齐原文没有的条件。" />}
          </section>

          <section id="resume" className={`${cardClass} p-5 sm:p-7`}>
            <SectionHeading eyebrow="05 / RESUME" title="简历定制建议" description="建议必须基于已记录事实，并保留不可越过的表达边界。" />
            {report.resumeSuggestions.length > 0 ? (
              <div className="space-y-3">
                {report.resumeSuggestions.map((suggestion, index) => (
                  <article key={index} className="rounded-2xl bg-slate-50 p-4">
                    <div className="space-y-2">
                      <RefBadges ids={suggestion.jdIds} label="JD" />
                      <RefBadges ids={suggestion.factIds} label="画像" />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-800"><span className="font-semibold">建议表达：</span>{suggestion.suggestedWording}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600"><span className="font-semibold">真实性边界：</span>{suggestion.factualBoundary}</p>
                  </article>
                ))}
              </div>
            ) : <EmptyState label="暂无有画像事实支持的简历建议。" />}
          </section>
        </div>

        <section id="verification" className={`${cardClass} p-5 sm:p-7`}>
          <SectionHeading eyebrow="06 / VERIFY BEFORE DECIDING" title="岗位核验项" description="仅保留会改变投递动作、岗位适配或资格判断的问题。" />
          {report.verificationItems.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-3">
              {report.verificationItems.map((item, index) => (
                <article key={index} className="rounded-2xl border border-slate-200 p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xs font-bold text-white">{String(index + 1).padStart(2, "0")}</span>
                    <h3 className="text-sm font-bold leading-6">{item.question}</h3>
                  </div>
                  <div className="mt-4"><RefBadges ids={item.jdIds} label="JD 依据" /></div>
                  <dl className="mt-4 space-y-3 text-sm leading-6">
                    <div><dt className="font-semibold text-slate-800">为何核验</dt><dd className="text-slate-600">{item.reason}</dd></div>
                    <div><dt className="font-semibold text-slate-800">向谁或怎样询问</dt><dd className="text-slate-600">{item.askWhomOrHow}</dd></div>
                    <div><dt className="font-semibold text-slate-800">不同答案的影响</dt><dd className="text-slate-600">{item.answerImpacts.length > 0 ? item.answerImpacts.join("；") : "暂无具体影响说明。"}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          ) : <EmptyState label="暂无需要额外核验、且会改变投递判断的问题。" />}
        </section>

        {mode !== 'sample' ? <details className={`${cardClass} p-5 sm:p-7`}>
          <summary className="cursor-pointer font-semibold">回查生成时的 JD 与画像快照</summary>
          <p className="mt-3 text-sm text-slate-600">画像版本 {analysis.profileVersion} · JD 确认版本 {analysis.jdConfirmationSnapshot?.revision ?? '旧记录未保存确认快照'} · Prompt {analysis.promptVersion} · 服务商 {analysis.modelProvider} · 模型 {analysis.modelName} · 测试数据版本 {analysis.testDataVersion ?? '无'}</p>
          <h2 className="mt-4 font-semibold">JD 原文</h2>
          <pre className="mt-2 whitespace-pre-wrap break-words text-sm">{analysis.jdText}</pre>
          <h2 className="mt-4 font-semibold">画像事实</h2>
          {analysis.profileSnapshot.facts.length ? analysis.profileSnapshot.facts.map(fact=><p key={fact.factId} className="mt-2 text-sm leading-6">{fact.factId} · {contextLabels[fact.context]} · {fact.statement}</p>) : <p className="mt-2 text-sm">该历史画像没有事实条目。</p>}
        </details> : null}
        <p className="pb-4 text-center text-xs leading-5 text-slate-500">
          {label} · JD 原文与画像事实分别标注编号 · 岗位信息尚未核验当前有效性
        </p>
      </div>
    </main>
  );
}
