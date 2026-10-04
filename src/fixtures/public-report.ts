import type {
  ActionCategory,
  EvidenceType,
  MaterialFitLevel,
  QualificationStatus,
  Report,
} from "@/types/job-copilot";

/**
 * Invented report sample for the `/ui-preview/report` Mock page.
 *
 * The position is the same fictional one used by the JD-review preview
 * (虚构客户成功实习生), and the jdIds continue that page's DEMO-JD numbering,
 * so the two pages read as one consistent fictional scenario. The report
 * scenario assumes a *confirmed* draft, so this snapshot additionally carries
 * one fictional availability requirement (DEMO-JD-6) of the same fictional
 * position; the JD-review page shows an earlier moment where one line is still
 * unconfirmed.
 *
 * Everything here is fictional: no real company, school, metric or outcome.
 * The report satisfies the frozen `Report` contract so the preview can be
 * reviewed against the real shape, but it is never read from or sent anywhere.
 */

export type ReportPreview = {
  readonly id: string;
  readonly company: string;
  readonly jobTitle: string;
  readonly createdOn: string;
  /** Shown verbatim in the meta line: 报告结构版本 1.0.0 · 演示. */
  readonly structureVersionNote: string;
  readonly report: Report;
};

/**
 * Label wording mirrors `src/components/report/report-view.tsx` exactly: the
 * preview and the real page must never name the same tag differently.
 */
export const reportPreviewEvidenceLabels: Record<EvidenceType, string> = {
  same_task: "同类任务证据",
  transferable: "可迁移证据",
  personal_practice: "个人实践",
  no_evidence: "暂无证据",
};

export const reportPreviewQualificationLabels: Record<QualificationStatus, string> = {
  meets: "明确符合",
  does_not_meet: "明确不符合",
  needs_confirmation: "待确认",
};

export const reportPreviewFitLabels: Record<MaterialFitLevel, string> = {
  strong: "较强",
  partial: "部分匹配",
  weak: "证据较弱",
};

export const reportPreviewActionLabels: Record<ActionCategory, string> = {
  prioritize: "优先投递",
  verify_first: "核验后决定",
  try_with_weak_evidence: "证据较弱但可尝试",
  explicit_hard_gate: "存在明确硬门槛",
};

/** Tag shown on assessments a human still has to confirm. */
export const reportPreviewNeedsConfirmationTag = "需用户确认";

/**
 * The completed, auto-validated fictional report.
 *
 * Evidence-tag coverage is deliberate: all four tags appear — same_task on
 * DEMO-JD-1, transferable on DEMO-JD-2, personal_practice on DEMO-JD-5 and
 * no_evidence on DEMO-JD-4 — and the campus/personal-practice rows state their
 * boundary instead of reading like formal employment. DEMO-JD-1 is the row a
 * human still has to confirm; verification item 0 is its counterpart.
 */
export const reportPreviewCompleted: ReportPreview = {
  id: "DEMO-ANL-1",
  company: "演示企业 · 拾光",
  jobTitle: "客户成功实习生（虚构演示岗位）",
  createdOn: "2026-09-30",
  structureVersionNote: "1.0.0 · 演示",
  report: {
    materialFit: {
      level: "partial",
      summary: "演示：反馈整理有校园项目证据，文档整理有个人项目线索；企业客户场景与到岗要求仍需确认。",
      supportingJdIds: ["DEMO-JD-1", "DEMO-JD-2"],
      limitingJdIds: ["DEMO-JD-4", "DEMO-JD-6"],
    },
    applicationAction: {
      category: "verify_first",
      summary: "演示：先与用户本人确认校园项目经历边界、再确认到岗要求后决定；最终由用户决定。",
      conditionalNextAction: "演示：两项确认完成后可优先考虑投递",
      verificationItemIndexes: [0, 1],
    },
    qualifications: [
      {
        jdId: "DEMO-JD-3",
        status: "meets",
        factIds: ["DEMO-W11-1"],
        explanation: "演示：画像记载的本科在读状态落在岗位要求区间内。",
      },
      {
        jdId: "DEMO-JD-6",
        status: "needs_confirmation",
        factIds: [],
        explanation: "演示：画像未记载可到岗时间，需用户确认后才能判断。",
      },
    ],
    coreDuties: [
      {
        jdId: "DEMO-JD-1",
        evidenceType: "same_task",
        evidenceLinks: [
          {
            evidenceType: "same_task",
            factIds: ["DEMO-W11-4"],
            connection: "演示：画像记载曾在校内工具试用中收集使用反馈并整理问题记录。",
            boundary: "演示：该经历来自校园项目，不是企业客户反馈处理工作。",
          },
        ],
        missingAspects: ["企业客户反馈渠道", "正式问题流转工具"],
        needsUserConfirmation: true,
        explanation: "演示：校园项目中收集反馈并整理记录有同类任务线索，客户场景仍需用户确认。",
      },
      {
        jdId: "DEMO-JD-2",
        evidenceType: "transferable",
        evidenceLinks: [
          {
            evidenceType: "transferable",
            factIds: ["DEMO-W11-2"],
            connection: "演示：画像记载曾独立完成个人工具的界面与流程整理。",
            boundary: "演示：个人项目文档整理不能等同于企业产品文档维护。",
          },
        ],
        missingAspects: ["企业产品文档体系", "多人协作维护"],
        needsUserConfirmation: false,
        explanation: "演示：文档与流程整理能力可迁移，企业场景证据不足。",
      },
    ],
    preferredItems: [
      {
        jdId: "DEMO-JD-5",
        evidenceType: "personal_practice",
        evidenceLinks: [
          {
            evidenceType: "personal_practice",
            factIds: ["DEMO-W11-2"],
            connection: "演示：画像记载的个人工具搭建属于个人 AI 应用实践。",
            boundary: "演示：个人项目实践不得表述成正式企业经历或企业级 AI 应用经验。",
          },
        ],
        missingAspects: [],
        needsUserConfirmation: false,
        explanation: "演示：与个人实践方向一致。",
      },
      {
        jdId: "DEMO-JD-4",
        evidenceType: "no_evidence",
        evidenceLinks: [],
        missingAspects: ["对外文档成果", "可核验的表达记录"],
        needsUserConfirmation: false,
        explanation:
          "演示：该行在核对中的分类仍待人工确认，按规则建议呈现为加分项；当前画像未提供对应证据。",
      },
    ],
    verificationItems: [
      {
        jdIds: ["DEMO-JD-1"],
        question: "演示：校园项目中收集反馈的经历，覆盖对象与渠道是什么？",
        reason: "演示：该行标记为需用户确认，回答决定证据强度如何表述。",
        askWhomOrHow: "演示：与用户本人确认校园项目经历的场景与可表述边界。",
        answerImpacts: [
          "若仅为校内工具的反馈整理，按校园项目表述。",
          "若有对外用户沟通记录，补充证据后再调整表述。",
        ],
      },
      {
        jdIds: ["DEMO-JD-6"],
        question: "演示：岗位要求的每周到岗天数是多少？",
        reason: "演示：画像未记载可到岗时间，影响是否满足资格。",
        askWhomOrHow: "演示：询问招聘联系人确认到岗要求。",
        answerImpacts: ["若要求超出可安排时间，重新评估投递。", "若可协商，可维持考虑。"],
      },
    ],
    resumeSuggestions: [
      {
        jdIds: ["DEMO-JD-1", "DEMO-JD-2"],
        factIds: ["DEMO-W11-2", "DEMO-W11-4"],
        suggestedWording:
          "演示：可描述为「在校园项目中收集使用反馈并整理成待跟进的问题记录；在个人项目中独立完成界面与流程整理」。",
        factualBoundary:
          "演示：不得写成企业客户成功经历、正式产品文档维护或对外付费用户服务经验。",
      },
    ],
    inferences: [
      {
        jdIds: ["DEMO-JD-2"],
        statement: "演示：该岗位可能同时考察文档撰写与跨团队沟通。",
        uncertainty: "演示：JD 未说明文档维护与团队协作在日常工作中的比重。",
      },
    ],
  },
};

/**
 * The fictional JD items the report refers to, so the page can render each
 * assessment with the JD line it assesses. DEMO-JD-6 exists only in this
 * report scenario (the confirmed-draft snapshot); see the file header.
 */
export const reportPreviewJdItems: readonly { jdId: string; exactText: string }[] = [
  { jdId: "DEMO-JD-1", exactText: "收集客户使用反馈，整理成可跟进的问题记录。" },
  { jdId: "DEMO-JD-2", exactText: "协助维护产品使用说明与常见问题文档。" },
  { jdId: "DEMO-JD-3", exactText: "本科在读或应届毕业生。" },
  { jdId: "DEMO-JD-4", exactText: "能清晰表达，并独立整理文档。" },
  { jdId: "DEMO-JD-5", exactText: "有个人 AI 应用实践者优先。" },
  { jdId: "DEMO-JD-6", exactText: "每周可到岗四天以上。（虚构演示行）" },
];

/**
 * Failed-generation copy. The preview shows only REPORT_INVALID; the wording
 * is the frozen, neutral statement — it never says which category of reason
 * caused the failure, because the contract does not expose that distinction
 * and the preview must not infer one.
 */
export const reportPreviewFailed = {
  code: "REPORT_INVALID",
  title: "生成结果未通过自动校验，报告未保存",
} as const;

/** Uncertain-result copy, frozen by the task card. */
export const reportPreviewUncertain = {
  title: "本次结果暂无法确认",
  body: "可以查询原请求的状态，页面不会自动重新生成。",
} as const;
