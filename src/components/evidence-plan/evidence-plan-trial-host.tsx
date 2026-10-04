'use client';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { EvidencePlanGuidedTrialHost } from './evidence-plan-guided-trial-host';
import type { TrialProgress } from '@/types/evidence-plan-guidance';
import { activeTrialMs, initialTrial, trialReducer } from '@/lib/evidence-plan/trial';
import styles from './evidence-plan-trial.module.css';

export function EvidencePlanTrialHost() {
  const [trial, dispatch] = useReducer(trialReducer, initialTrial);
  const [session, setSession] = useState(0);
  const [now, setNow] = useState(0);
  const [effort, setEffort] = useState('');
  const [willing, setWilling] = useState('');
  const [unclear, setUnclear] = useState('');
  const [feedback, setFeedback] = useState('');
  const progress = useCallback((value: TrialProgress) => {
    dispatch({ type: 'progress', now: Date.now(), ...value });
  }, []);
  useEffect(() => {
    if (trial.phase !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [trial.phase]);
  const seconds = Math.floor(activeTrialMs(trial, now) / 1000);
  const summary = `EP2A 引导原型第2版 · 14条虚构核对试用\n已浏览：${trial.viewed}/${trial.total}；待核对：${trial.pending}/${trial.total}（已标记${trial.markedPending}）\n已完成本条确认：${trial.checked}/${trial.total}；可用于整份确认：${trial.eligible}/${trial.total}；整份确认：${trial.confirmed ? '是' : '否'}\n有效用时：${seconds}秒；总经过：${trial.startedAt === null ? 0 : Math.floor(((trial.finishedAt ?? now) - trial.startedAt) / 1000)}秒\n控件激活：${trial.activations}；笔记编辑段：${trial.noteEdits}\n负担：${effort || '未填'}/5；愿意每岗位核对：${willing || '未填'}\n最不清楚：${unclear || '未填'}\n改进意见：${feedback || '未填'}`;
  return <div className={styles.page}>
    <header className={styles.header}>
      <h1>证据核对计时试用</h1>
      <p>仅使用虚构 JD 和画像，不调用模型、不连接账号、不上传或保存材料。刷新后计时和反馈会消失。</p>
      <details><summary>试用说明与计数方式</summary>
      <p>先读原句与来源卡，选择支持状态，核对范围后确认并继续。拿不准时标记待核对；浏览和跳过不冒充确认。</p>
      <p>来源已预置；真实画像建立和核对来源目录的额外操作尚未计入。</p>
      <p>控件激活计按钮、单选和复选框（含键盘，不计 Tab）；笔记编辑按失焦后的一段计算。</p>
      </details>
      <div className={styles.toolbar}>
        <button onClick={() => { dispatch({ type: 'start', now: Date.now() }); setNow(Date.now()); setSession(s => s + 1); setEffort(''); setWilling(''); setUnclear(''); setFeedback(''); }}>开始新的计时（重置本轮核对）</button>
        <button disabled={trial.phase !== 'running'} onClick={() => dispatch({ type: 'pause', now: Date.now() })}>暂停计时</button>
        <button disabled={trial.phase !== 'paused'} onClick={() => dispatch({ type: 'resume', now: Date.now() })}>继续计时</button>
        <button disabled={trial.phase === 'idle' || trial.phase === 'finished'} onClick={() => dispatch({ type: 'finish', now: Date.now() })}>结束试用（允许未完成）</button>
      </div>
      <p role="status">{trial.phase === 'idle' ? '尚未开始' : trial.phase === 'running' ? '计时中' : trial.phase === 'paused' ? '已暂停' : '试用已结束'}；有效用时 {seconds} 秒；控件激活 {trial.activations} 次；笔记编辑 {trial.noteEdits} 段。</p>
    </header>
    <div inert={trial.phase !== 'running'}
      onClick={event => { if (event.target instanceof HTMLElement && event.target.closest('button,input')) dispatch({ type: 'activation' }); }}
      onBlurCapture={event => { if (event.target instanceof HTMLTextAreaElement && event.target.dataset.edited === 'true') { dispatch({ type: 'note_edit' }); delete event.target.dataset.edited; } }}
      onChangeCapture={event => { if (event.target instanceof HTMLTextAreaElement) event.target.dataset.edited = 'true'; }}>
      <EvidencePlanGuidedTrialHost key={session} onProgress={progress} />
    </div>
    <section className={styles.feedback} aria-label="简短试用反馈">
      <h2>简短反馈（只留在当前页面）</h2>
      <label>核对负担（1 很轻，5 很重）<select value={effort} onChange={e => setEffort(e.target.value)}><option value="">请选择</option>{[1,2,3,4,5].map(n => <option key={n}>{n}</option>)}</select></label>
      <label>是否愿意为每个岗位核对？<select value={willing} onChange={e => setWilling(e.target.value)}><option value="">请选择</option>{['愿意','需要减少操作','不愿意'].map(x => <option key={x}>{x}</option>)}</select></label>
      <label>最不清楚的步骤<select value={unclear} onChange={e => setUnclear(e.target.value)}><option value="">请选择</option>{['没有','支持状态','来源选择','发生场景与证据类型','已有动作与缺口','逐条和整份确认'].map(x => <option key={x}>{x}</option>)}</select></label>
      <label>希望减少或改进什么？（不要填写个人材料）<textarea maxLength={300} value={feedback} onChange={e => setFeedback(e.target.value)} /></label>
      <label>结束后可手动复制这份摘要给产品负责人<textarea readOnly value={summary} rows={9} /></label>
      <p>两次真实反馈已独立保留。此页仍是内存试用；v2 引导流程已选定，真实保存和跨刷新恢复尚未接入。</p>
    </section>
  </div>;
}
