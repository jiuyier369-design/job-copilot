import type {
  EvidencePlanOption,
  EvidencePlanPanelProps,
  EvidenceReviewRow,
  ReviewChoice,
} from '@/types/evidence-plan';
import type { FactCategory, FactContext, JdItem, JdItemKind } from '@/types/job-copilot';
import { sourceNoteKey, type EvidencePlanGuidance, type SourceGuidance } from '@/types/evidence-plan-guidance';
import styles from './evidence-plan-panel.module.css';

/**
 * W10 display-only panel. Every decision (option legality, edit invalidation, progress source,
 * confirmation result) belongs to the host; this component renders the frozen props and forwards
 * user intent through the frozen callbacks. It never invents evidence relationships, never expands
 * the option catalogue, and never treats notes as new profile facts.
 */

/* Display-only label maps. The contract exposes no Chinese map for these frozen enum values, so
 * they live here as presentation. Every rendered label is paired with its English enum value so a
 * reviewer can trace it back to the contract. */

const KIND_ORDER: JdItemKind[] = ['qualification', 'core_duty', 'preferred'];

const KIND_LABEL: Record<JdItemKind, string> = {
  qualification: '资格要求',
  core_duty: '核心职责',
  preferred: '优先条件',
};

const CHOICE_ORDER: ReviewChoice[] = ['limited_support', 'no_clue', 'pending'];

const CHOICE_LABEL: Record<ReviewChoice, string> = {
  limited_support: '有限支持',
  no_clue: '暂无线索',
  pending: '待核对',
};

const CHOICE_HINT: Record<ReviewChoice, string> = {
  limited_support: '当前核对材料只支持部分范围，不代表整条要求已满足。',
  no_clue: '当前核对材料里暂无线索，不能据此断言本人没有相关经历。',
  pending: '可以停下继续检查，但待核对条目不能进入计划确认。',
};

const CHOICE_CLASS: Record<ReviewChoice, string> = {
  limited_support: styles.stateLimited,
  no_clue: styles.stateNoClue,
  pending: styles.statePending,
};

const SCENE_LABEL: Record<FactContext, string> = {
  education: '教育经历',
  formal_work: '正式企业任职',
  entrepreneurship: '自营工作室',
  campus: '校园活动',
  competition: '比赛',
  personal_project: '个人项目',
  self_report: '自述',
};

const CATEGORY_LABEL: Record<FactCategory, string> = {
  education: '教育',
  work: '工作',
  project: '项目',
  skill: '技能',
  award: '奖项',
  preference: '偏好',
  constraint: '限制条件',
};

const EVIDENCE_TYPE_LABEL: Record<string, string> = {
  qualification: '资格来源',
  same_task: '同类任务',
  transferable: '可迁移',
  personal_practice: '个人实践',
};

const NOTE_LIMIT = 800;

function countChecked(rows: EvidenceReviewRow[]): number {
  return rows.reduce((total, row) => (row.checked ? total + 1 : total), 0);
}

function optionKey(option: EvidencePlanOption): string {
  return `${option.actionKey}/${option.evidenceType}`;
}

function isSelected(option: EvidencePlanOption, selections: EvidenceReviewRow['selections']): boolean {
  return selections.some(
    (selection) =>
      selection.actionKey === option.actionKey && selection.evidenceType === option.evidenceType,
  );
}

function ChecklistEntry({
  item,
  row,
  active,
  position,
  onActivate,
  status,
}: {
  item: JdItem;
  row: EvidenceReviewRow | undefined;
  active: boolean;
  position: number;
  onActivate: (jdId: string) => void;
  status?: EvidencePlanGuidance['rowStates'][string];
}) {
  const choice: ReviewChoice = row?.choice ?? 'pending';
  return (
    <li className={styles.listItem}>
      <button
        type="button"
        className={active ? styles.listButtonActive : styles.listButton}
        aria-current={active ? 'step' : undefined}
        onClick={() => onActivate(item.jdId)}
      >
        <span className={styles.listHead}>
          <span className={styles.listIndex}>{position + 1}</span>
          <span className={styles.mono}>{item.jdId}</span>
          <span className={styles.kindChip}>{KIND_LABEL[item.kind]}</span>
        </span>
        <span className={styles.listQuote}>{item.exactText}</span>
        <span className={styles.listMeta}>
          <span className={CHOICE_CLASS[choice]}>{CHOICE_LABEL[choice]}</span>
          <span className={row?.checked ? styles.checkedMark : styles.uncheckedMark}>
            {status ? (row?.checked ? '✓ 已完成本条确认' : status.deferredReason ? '待核对已标记' : '未完成本条确认') : row?.checked ? '✓ 已核对' : '· 未核对'}
          </span>
        </span>
      </button>
    </li>
  );
}

function SelectedFactCard({ option }: { option: EvidencePlanOption }) {
  return (
    <li className={styles.factCard}>
      <div className={styles.factCardBody}>
        <p className={styles.factCardHead}>
          <span className={styles.factLabel}>{option.label}</span>
          <span className={styles.selectedBadge}>已选择</span>
        </p>
        <p className={styles.factLine}>
          <span className={styles.fieldTerm}>完整原句：</span>
          <span>{option.factStatement}</span>
        </p>
        <p className={styles.factLine}>
          <span className={styles.fieldTerm}>来源动作：</span>
          <span>{option.actionQuote}</span>
        </p>
        <p className={styles.factLine}>
          <span className={styles.fieldTerm}>发生场景：</span>
          <span>
            {SCENE_LABEL[option.scene]}（<span className={styles.mono}>{option.scene}</span>）
          </span>
        </p>
        <p className={styles.factLine}>
          <span className={styles.fieldTerm}>允许证据类型：</span>
          <span>
            {EVIDENCE_TYPE_LABEL[option.evidenceType] ?? option.evidenceType}（
            <span className={styles.mono}>{option.evidenceType}</span>）
          </span>
        </p>
        {option.evidenceType === 'personal_practice' && (
          <p className={styles.factBoundary}>
            个人项目类型锁定 <span className={styles.mono}>personal_practice</span>
            ：只代表个人实践，不升级为同类任务或企业经历。
          </p>
        )}
        <p className={styles.factBoundary}>取消或更换来源，请在下方“来源动作与发生场景”里勾选/取消。</p>
      </div>
    </li>
  );
}

function OptionCard({
  option,
  row,
  disabled,
  onSelection,
  guidance,
  compact,
}: {
  option: EvidencePlanOption;
  row: EvidenceReviewRow;
  disabled: boolean;
  onSelection: EvidencePlanPanelProps['onSelection'];
  guidance?: SourceGuidance;
  compact?: boolean;
}) {
  const selected = isSelected(option, row.selections);
  const inputId = `option-${option.actionKey}-${option.evidenceType}`;
  return (
    <li className={selected ? styles.optionCardSelected : styles.optionCard}>
      <label className={styles.optionLabel} htmlFor={inputId}>
        <input
          id={inputId}
          type="checkbox"
          className={styles.checkbox}
          checked={selected}
          disabled={disabled}
          onChange={(event) =>
            onSelection(
              { actionKey: option.actionKey, evidenceType: option.evidenceType },
              event.target.checked,
            )
          }
        />
        <span className={styles.optionBody}>
          <span className={styles.optionHead}>
            <span className={styles.factLabel}>{option.label}</span>
            <span className={styles.sceneChip}>
              场景：{SCENE_LABEL[option.scene]}{!compact && <>（<span className={styles.mono}>{option.scene}</span>）</>}
            </span>
            <span className={styles.typeChip}>
              类型：{EVIDENCE_TYPE_LABEL[option.evidenceType] ?? option.evidenceType}{!compact && <>（<span className={styles.mono}>{option.evidenceType}</span>）</>}
            </span>
          </span>
          <span className={styles.factLine}>
            <span className={styles.fieldTerm}>完整原句：</span>
            <span>{option.factStatement}</span>
          </span>
          <span className={styles.factLine}>
            <span className={styles.fieldTerm}>来源动作：</span>
            <span>{option.actionQuote}</span>
          </span>
          {guidance && <>
            <span className={styles.factLine}><span className={styles.fieldTerm}>为什么可选：</span>{guidance.why}</span>
            <span className={styles.factLine}><span className={styles.fieldTerm}>只能支持到：</span>{guidance.boundary}</span>
            {!compact && <span className={styles.factLine}>勾选表示你核对了原句、场景与本条关联；不是系统证明你具备完整资历。{option.evidenceType === 'same_task' ? '同类任务指任务相似，不等于正式企业任职。' : option.evidenceType === 'transferable' ? '可迁移指部分方法可参考，不等于已经完成岗位全部任务。' : ''}</span>}
          </>}
        </span>
      </label>
    </li>
  );
}

export function EvidencePlanPanel(props: EvidencePlanPanelProps & { guidance?: EvidencePlanGuidance }) {
  const guide = props.guidance;
  const {
    jdText,
    rows,
    requirements,
    facts,
    options,
    activeJdId,
    notice,
    error,
    canConfirm,
    confirmed,
    onActivate,
    onChoice,
    onSelection,
    onNote,
    onCheckRow,
    onConfirm,
  } = props;

  const activeItem = requirements.find((item) => item.jdId === activeJdId);
  const activeRow = rows.find((row) => row.jdId === activeJdId);
  const activeOptions = options[activeJdId] ?? [];
  const checkedCount = countChecked(rows);
  const limitedSupport = activeRow?.choice === 'limited_support';
  const selectedOptions = activeRow
    ? activeOptions.filter((option) => isSelected(option, activeRow.selections))
    : [];

  const groups = KIND_ORDER.map((kind) => ({
    kind,
    items: requirements.filter((item) => item.kind === kind),
  })).filter((group) => group.items.length > 0);

  const hasRequirements = requirements.length > 0;

  return (
    <section className={styles.panel} aria-label="逐条证据核对计划">
      <p className={styles.notice} role="status">
        {notice}
      </p>
      {guide && <>
        <details className={styles.jdDetails}><summary>操作说明与状态含义</summary>
          <p className={styles.kindNote}>读 JD 与原句 → 选择支持状态与来源 → 核对范围提示 → 确认本条并继续。没有合适来源选“暂无线索”；拿不准就标记“待核对”。来源相似不代表企业任职或完整任务经历。</p>
          <p>已浏览表示打开过详情，不证明读完。已确认还须通过核对才能用于整份确认；待核对和未确认都阻止生成。</p>
        </details>
        <div className={styles.guidedProgress} aria-label="四种核对进度" role="status">
          <span>已浏览 {guide.progress.viewed}/{guide.progress.total}</span>
          <span>待核对 {guide.progress.pending}/{guide.progress.total}（已标记 {guide.progress.markedPending} 条）</span>
          <span>已完成本条确认 {guide.progress.checked}/{guide.progress.total}</span>
          <span>可用于整份确认 {guide.progress.eligible}/{guide.progress.total}</span>
        </div>
        <section className={styles.remaining} aria-label="仍需处理条目">
          <h2>仍需处理 {guide.remaining.length} 条</h2>
          {guide.remaining.length ? <ul>{guide.remaining.map(item => <li key={item.jdId}>
            <button type="button" onClick={() => onActivate(item.jdId)}>核对 {item.jdId}</button>
            <span><strong>{requirements.find(r => r.jdId === item.jdId)?.exactText}</strong><br />{item.explanation}</span>
          </li>)}</ul> : <p>每条均已明确确认并通过核对，可以确认整份计划。</p>}
        </section>
        {guide.notice && <p role="status" className={styles.kindNote}>{guide.notice}</p>}
      </>}

      <details className={styles.jdDetails}>
        <summary className={styles.jdSummary}>完整 JD 原文（随时可查，共 {requirements.length} 条要求）</summary>
        {jdText.trim() ? (
          <pre className={styles.jdText}>{jdText}</pre>
        ) : (
          <p className={styles.emptyText}>当前没有 JD 原文可显示。</p>
        )}
      </details>

      <div className={`${styles.workspace} ${guide ? styles.guidedWorkspace : ''}`}>
        <section className={styles.checklistPane} aria-label="确认要求清单">
          <details open={guide ? undefined : true}>
          <summary className={styles.paneTitle}>查看全部要求及确认状态（{requirements.length} 条）</summary>
          {hasRequirements ? (
            groups.map((group) => (
              <div key={group.kind} className={styles.group}>
                <h3 className={styles.groupTitle}>
                  {KIND_LABEL[group.kind]}
                  {!guide && <span className={styles.mono}>{group.kind}</span>}
                  <span className={styles.groupCount}>{group.items.length} 条</span>
                </h3>
                <ol className={styles.list}>
                  {group.items.map((item) => (
                    <ChecklistEntry
                      key={item.jdId}
                      item={item}
                      row={rows.find((row) => row.jdId === item.jdId)}
                      active={item.jdId === activeJdId}
                      position={requirements.findIndex((entry) => entry.jdId === item.jdId)}
                      onActivate={onActivate}
                      status={guide?.rowStates[item.jdId]}
                    />
                  ))}
                </ol>
              </div>
            ))
          ) : (
            <p className={styles.emptyText}>
              当前没有可显示的要求。请返回宿主场景切换控件，选择“空白核对计划”或“固定完成样例”。
            </p>
          )}
          </details>
        </section>

        <section className={styles.detailPane} aria-label="当前要求核对详情">
          {activeItem && activeRow ? (
            <article className={styles.detailCard}>
              <header className={styles.detailHead}>
                <h2 className={styles.detailTitle} tabIndex={guide ? -1 : undefined}>
                  <span className={styles.mono}>{activeItem.jdId}</span>
                  <span className={styles.kindChip}>{KIND_LABEL[activeItem.kind]}</span>
                  {!guide && <span className={styles.kindCode}>
                    kind：<span className={styles.mono}>{activeItem.kind}</span>
                  </span>}
                </h2>
                <blockquote className={styles.quote}>原文：{activeItem.exactText}</blockquote>
              </header>
              {guide?.navigationWarning && <section className={styles.navigationWarning} aria-label="切换前提醒">
                <p role="alert">本条尚未完成确认。切换不会自动确认，也不会丢弃当前输入。</p>
                <p>可在下方确认来源与范围后继续，或明确保留未确认状态继续浏览。</p>
                <button type="button" onClick={guide.onStay}>留在本条核对</button>{' '}
                <button type="button" onClick={guide.onLeaveUnconfirmed}>保留未确认并切换</button>
              </section>}

              {activeItem.kind === 'qualification' && (
                <p className={styles.kindNote}>
                  这里核对的是资格来源，不表示已满足全部资格。最终资格状态只能由可靠服务器规则推导；
                  用户的核对选择并不是资格判定本身。
                </p>
              )}
              {activeItem.kind === 'preferred' && (
                <p className={styles.kindNote}>
                  优先条件是背景加分说明，不是岗位基本门槛。核对只记录当前材料能否提供有限支持，
                  不据此升级为已完成经历。
                </p>
              )}

              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>当前核对材料能提供什么支持？</legend>
                <div className={styles.choiceGroup}>
                  {CHOICE_ORDER.map((choice) => (
                    <label key={choice} className={styles.choiceLabel} htmlFor={`choice-${choice}`}>
                      <input
                        id={`choice-${choice}`}
                        className={styles.radio}
                        type="radio"
                        name={`support-choice-${activeItem.jdId}`}
                        value={choice}
                        checked={activeRow.choice === choice}
                        onChange={() => onChoice(choice)}
                      />
                      <span className={styles.choiceBody}>
                        <span className={styles.choiceTitle}>{CHOICE_LABEL[choice]}</span>
                        <span className={styles.choiceHint}>
                          {CHOICE_HINT[choice]}{!guide && <>（<span className={styles.mono}>{choice}</span>）</>}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className={styles.fieldset} disabled={!limitedSupport}>
                <legend className={styles.legend}>来源动作与发生场景（混合场景请分开选择）</legend>
                {guide && <p className={styles.footnote}>来源是画像原句中的具体动作，不是技能勾选。只选与你核对的本条任务相关的部分；混合场景分开选。没有合适的选项不等于本人没有经历。</p>}
                {limitedSupport ? (
                  activeOptions.length > 0 ? (
                    <ul className={styles.optionList}>
                      {activeOptions.map((option) => (
                        <OptionCard
                          key={optionKey(option)}
                          option={option}
                          row={activeRow}
                          disabled={!limitedSupport}
                          onSelection={onSelection}
                          guidance={guide?.sourceNotes[sourceNoteKey(option)]}
                          compact={Boolean(guide)}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.noOptionNote}>
                      当前来源目录没有允许的关联。可以核对为“暂无线索”，或保持“待核对”；这并不说明本人一定没有相关经验，
                      也不能把偏好或知识整理硬套成本条证据。
                    </p>
                  )
                ) : (
                  <p className={styles.disabledHint}>
                    只有“有限支持”可以选择来源动作与链接类型；当前状态下这些控件已按原生语义禁用。
                  </p>
                )}
              </fieldset>

              {limitedSupport && !guide && (
                <section className={styles.factSection} aria-label="已选来源事实卡">
                  <h3 className={styles.sectionTitle}>已选来源事实卡</h3>
                  {selectedOptions.length > 0 ? (
                    <ul className={styles.factList}>
                      {selectedOptions.map((option) => (
                        <SelectedFactCard key={optionKey(option)} option={option} />
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.disabledHint}>尚未选择来源动作。</p>
                  )}
                </section>
              )}

              <div className={styles.noteFields}>
                <details open={guide ? undefined : true} className={styles.noteField}>
                  <summary>查看已选来源动作（无需重复填写）</summary>
                <label className={styles.noteField} htmlFor={`note-existing-${activeItem.jdId}`}>
                  <span className={styles.noteLabel}>
                    {guide ? '已选来源动作（自动带出，无需重复抄写；完整原句见来源卡）' : '已有动作说明（选中来源动作后自动填入原句；笔记不是新增画像事实）'}
                  </span>
                  <textarea
                    id={`note-existing-${activeItem.jdId}`}
                    className={styles.textarea}
                    value={activeRow.existingAction}
                    maxLength={NOTE_LIMIT}
                    disabled={!limitedSupport}
                    readOnly={Boolean(guide)}
                    onChange={(event) => onNote('existingAction', event.target.value)}
                  />
                  <span className={styles.noteCounter}>
                    {activeRow.existingAction.length} / {NOTE_LIMIT}
                  </span>
                </label>
                </details>
                <label className={styles.noteField} htmlFor={`note-missing-${activeItem.jdId}`}>
                  <span className={styles.noteLabel}>仍缺的范围／待核实条件</span>
                  {guide && <span className={styles.footnote}>范围提示来自预置虚构来源，可直接核对或修改；不是模型结论。确认本条时同时确认这段范围，不需要重复输入。</span>}
                  <textarea
                    id={`note-missing-${activeItem.jdId}`}
                    className={styles.textarea}
                    value={activeRow.missingScope}
                    maxLength={NOTE_LIMIT}
                    onChange={(event) => onNote('missingScope', event.target.value)}
                  />
                  <span className={styles.noteCounter}>
                    {activeRow.missingScope.length} / {NOTE_LIMIT}
                  </span>
                </label>
              </div>

              <div className={styles.rowActions}>
                {guide && activeRow.choice === 'pending' ? <div>
                  <p>待核对不能完成确认或进入生成。请选择暂不能确认的原因，标记后可以继续浏览。</p>
                  <label htmlFor="pending-reason">待核对原因（只在本页保留）</label>
                  <select id="pending-reason" value={guide.pendingReason} onChange={e => guide.onPendingReason(e.target.value)}>
                    <option value="">请选择原因</option>
                    {['不确定来源与本条的关联', '需要补充画像事实', '需要核实事实或支持范围', '尚未读完，需要稍后核对'].map(reason => <option key={reason}>{reason}</option>)}
                  </select>
                  <button type="button" className={styles.primaryButton} disabled={!guide.pendingReason.trim()} onClick={guide.onMarkPending}>标记待核对并继续</button>
                  {guide.rowStates[activeItem.jdId]?.deferredReason && <p role="status">已标记原因：{guide.rowStates[activeItem.jdId].deferredReason}</p>}
                </div> : <button type="button" className={styles.primaryButton} disabled={guide ? !guide.rowCanConfirm || activeRow.checked : false} onClick={onCheckRow}>
                  {guide ? activeRow.checked ? '本条确认已完成' : '确认本条来源与边界并继续' : '确认本条来源与边界'}
                </button>}
                {guide?.rowBlocker && activeRow.choice !== 'pending' && <p className={styles.footnote}>{guide.rowBlocker}</p>}
                <p className={styles.rowStatus} role="status">
                  {activeRow.checked
                    ? '本条已完成确认；任何修改都会让本条确认与整份确认失效。'
                    : guide ? '本条未完成确认；已浏览和已标记待核对都不能代替确认。' : '本条尚未核对。'}
                </p>
              </div>
            </article>
          ) : (
            <p className={styles.emptyText} role="status">
              当前没有可显示的要求，请返回清单或宿主场景切换控件。这里不做猜测，也不会访问不存在的数据。
            </p>
          )}
        </section>
      </div>

      <details className={styles.factsDetails}>
        <summary className={styles.jdSummary}>
          查看全部画像事实（{facts.length} 条；含不可选与不相关事实，可回查原句）
        </summary>
        {facts.length > 0 ? (
          <>
            <ul className={styles.factList}>
              {facts.map((fact) => (
                <li key={fact.factId} className={styles.factRow}>
                  <span className={styles.factRowHead}>
                    <span className={styles.mono}>{fact.factId}</span>
                    <span className={styles.sceneChip}>
                      {SCENE_LABEL[fact.context]}（<span className={styles.mono}>{fact.context}</span>）
                    </span>
                    <span className={styles.sceneChip}>
                      类别：{CATEGORY_LABEL[fact.category]}（
                      <span className={styles.mono}>{fact.category}</span>）
                    </span>
                  </span>
                  <span className={styles.factRowText}>{fact.statement}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className={styles.emptyText}>当前画像为空。</p>
        )}
        <p className={styles.footnote}>
          偏好、知识整理等事实保留在画像里可查，但不会成为所有要求的可选项；教育事实不会作为任务证据。
          个人项目类型锁定 <span className={styles.mono}>personal_practice</span>；校园、工作室、比赛各自保留原场景，
          不合并、也不称为正式企业经历。
        </p>
      </details>

      <footer className={styles.footer}>
        <p className={styles.progress} role="status">
          {guide ? `可用于整份确认：${guide.progress.eligible} / ${requirements.length}；待核对和未完成确认的条目仍需处理。` : `进度：${checkedCount} / ${requirements.length} 条已核对`}
        </p>
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.footerActions}>
          <div className={styles.confirmWrap}>
            <button type="button" className={styles.confirmButton} disabled={!canConfirm} onClick={onConfirm}>
              确认这份证据核对计划
            </button>
            <p className={styles.confirmHint}>
              需要全部条目都已核对且没有待核对项；确认只表示计划已核对。
            </p>
          </div>
          <div className={styles.generateWrap}>
            <button type="button" className={styles.generateButton} disabled>
              生成报告（未接入）
            </button>
            <p className={styles.confirmHint}>生成功能尚未接入，按钮始终保持禁用。</p>
          </div>
        </div>
        {confirmed ? (
          <p className={styles.confirmedNote} role="status">
            内存计划已确认（演示）。这只代表计划核对，不代表岗位仍在招聘、资格全部满足，或用户接受 AI 报告；
            不会保存到账户，也不会调用外部模型。
          </p>
        ) : null}
      </footer>
    </section>
  );
}
