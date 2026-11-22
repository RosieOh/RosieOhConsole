import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api } from '../lib/api';
import type { ReportData, ReportProject, ReportStatus } from '../lib/types';
import { ko } from '../lib/stages';
import { kstShort } from '../lib/format';
import { field } from '../lib/field';
import { bloom, reflected } from '../lib/cheer';
import { StageRing } from './StageRing';
import { Bar } from './Skeleton';

const STATUS_KO: Record<ReportStatus, string> = { auto: '자동 초안', edited: '수정됨', changed: '반영 뒤 수정됨', reflected: '반영됨' };
// 바탕·테두리는 .board-badge 가 유리로 그린다(board.css). 여기서는 색만.
const STATUS_CLS: Record<ReportStatus, string> = {
  auto: 'board-badge', edited: 'board-badge board-badge-w', changed: 'board-badge board-badge-w', reflected: 'board-badge board-badge-ok',
};
const rippleAt = (el: Element, color: string) => { const r = el.getBoundingClientRect(); field.ripple(r.left + r.width / 2, r.top + r.height / 2, color, true); };

/** 주간보고 검수 — 프로젝트(따라가는 저장소)마다 이슈 기록으로 만든 초안을 보여 주고, 사람이 고친 뒤 [확정]을 누르면 그 주 보고로 남긴다 */
export function ReportPage({ me, active }: { me: string | null; active: boolean }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [failed, setFailed] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busyAll, setBusyAll] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api.report()); setFailed(false); }
    catch (e) {
      setFailed(true);
      toast.error(`주간보고를 불러오지 못했습니다, ${(e as Error).message}`, { action: { label: '다시 시도', onClick: () => void load() }, duration: 12000 });
    }
  }, []);
  useEffect(() => { if (active) void load(); }, [active, load]);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 5000); return () => clearTimeout(t); }, [armed]);

  if (!data) {
    if (failed) return (
      <div className="board-rp-fail"><span>주간보고를 불러오지 못했습니다</span><button type="button" className="btn" onClick={() => void load()}>다시 시도</button></div>
    );
    return (
      <div className="board-rp" aria-busy="true">
        <div className="board-rp-skel-head"><Bar w={220} h={18} /><span className="board-spacer" /><Bar w={130} h={30} round={9} /></div>
        <div className="board-rp-grid">
          {[0, 1, 2, 3].map((i) => <div key={i} className="board-rp-skel-panel"><Bar w="45%" /><Bar w="88%" /><Bar w="72%" /><Bar h={110} round={10} /><Bar w="38%" /></div>)}
        </div>
      </div>
    );
  }

  const mapped = data.projects.filter((p) => p.repos.length);
  const unmapped = data.projects.filter((p) => !p.repos.length);
  const pending = mapped.filter((p) => p.status !== 'reflected');
  const count = (...st: ReportStatus[]) => mapped.filter((p) => st.includes(p.status)).length;
  const warned = mapped.filter((p) => p.warnings.length).length;

  async function reflectAll(btn: HTMLButtonElement) {
    if (!armed) { setArmed(true); return; }   // 한 번 더 눌러야 실행 — 여러 칸을 한꺼번에 바꾸는 일이라서
    setArmed(false); setBusyAll(true);
    let ok = 0; const fail: string[] = [];
    for (const p of pending) {
      const text = (document.querySelector(`[data-project="${CSS.escape(p.name)}"] textarea`) as HTMLTextAreaElement | null)?.value ?? p.text;
      try { await api.reportAct({ action: 'reflect', project: p.name, text }); ok++; } catch (e) { fail.push(`${p.name}: ${(e as Error).message}`); }
    }
    const r = btn.getBoundingClientRect();
    const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    rippleAt(btn, fail.length ? 'var(--amber)' : 'var(--green)');
    if (!fail.length) {
      reflected(at, true);
      // 반영된 카드가 위에서부터 줄줄이 핀다 — 뭐가 바뀌었는지 눈으로 따라간다
      pending.forEach((p, i) => {
        const el = document.querySelector(`[data-project="${CSS.escape(p.name)}"]`);
        if (el) bloom(el, 120 + i * 110);
      });
    }
    if (fail.length) toast.error(`${ok}개 반영, ${fail.length}개 실패, ${fail[0]}`, { duration: 10000 }); else toast.success(`${ok}개 프로젝트를 확정했습니다`);
    setBusyAll(false);
    void load();
  }

  return (
    <div className="board-rp">
      <div className="board-rp-head">
        <h2>{data.week} 주간보고</h2>
        <div className="board-rp-counts">
          <span className={STATUS_CLS.reflected}>반영됨 {count('reflected')}</span>
          <span className={STATUS_CLS.edited}>수정됨 {count('edited', 'changed')}</span>
          <span className={STATUS_CLS.auto}>자동 초안 {count('auto')}</span>
          {warned > 0 && <span className="board-badge board-badge-d">경고 {warned}</span>}
        </div>
        <span className="board-spacer" />
        <button type="button" className={clsx('btn', armed ? 'ok' : 'primary')} disabled={!pending.length || !data.weekFound || busyAll}
          onClick={(e) => void reflectAll(e.currentTarget)}>
          {busyAll ? '반영하는 중…' : armed ? `${pending.length}개 프로젝트를 반영할까요? 한 번 더 누르세요` : `전체 반영 (${pending.length})`}
        </button>
        <span className="board-rp-note">확정하면 이 주차 보고로 남습니다. 단계는 이슈 기록 그대로 적혀 있으니 문장만 다듬어 확정하세요.</span>
      </div>
      {!data.weekFound && (
        <div className="board-rp-warn">
          "{data.week}" 주차 보고를 아직 열 수 없습니다. 잠시 뒤 다시 여세요.
        </div>
      )}
      <div className="board-rp-grid">
        {mapped.map((p) => <Panel key={p.name} p={p} me={me} canReflect={data.weekFound} onDone={load} />)}
      </div>
      {unmapped.length > 0 && (
        <>
          <div className="board-rp-sub">
            <h2>저장소가 연결되지 않은 프로젝트 {unmapped.length}개</h2>
            <span>업무 › 저장소 관리에서 저장소를 따라가면 초안이 만들어집니다. 직접 써서 확정할 수도 있습니다.</span>
          </div>
          <div className="board-rp-grid faded">
            {unmapped.map((p) => <Panel key={p.name} p={p} me={me} canReflect={data.weekFound} onDone={load} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Panel({ p, me, canReflect, onDone }: { p: ReportProject; me: string | null; canReflect: boolean; onDone: () => Promise<void> }) {
  const [text, setText] = useState(p.text);
  const [status, setStatus] = useState(p.status);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { setText(p.text); setStatus(p.status); }, [p.text, p.status]);
  useEffect(() => { const ta = ref.current; if (ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight + 2, 420)}px`; } }, [text]);

  function onEdit(v: string) {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { await api.reportAct({ action: 'save', project: p.name, text: v }); setStatus(p.reflectedAt ? 'changed' : 'edited'); }
      catch (e) { toast.error(`저장하지 못했습니다, ${(e as Error).message}`); }
    }, 900);
  }
  async function act(kind: 'reset' | 'reflect', btn: HTMLButtonElement) {
    clearTimeout(timer.current);
    setBusy(true);
    try {
      if (kind === 'reset') { await api.reportAct({ action: 'reset', project: p.name }); toast.success('자동 초안으로 되돌렸습니다'); }
      else {
        await api.reportAct({ action: 'reflect', project: p.name, text });
        rippleAt(btn, 'var(--green)');
        const r = btn.getBoundingClientRect();
        reflected({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        const card = btn.closest('[data-project]');
        if (card) bloom(card);
        toast.success(`${p.name}, 확정했습니다`);
      }
      await onDone();
    } catch (e) { toast.error(`하지 못했습니다, ${(e as Error).message}`, { duration: 8000 }); }
    finally { setBusy(false); }
  }
  const who = p.reflectedAt ? `반영 ${kstShort(p.reflectedAt)}, ${p.reflectedBy || ''}`
    : status !== 'auto' ? `수정 ${kstShort(p.editedAt) || '방금'}, ${p.editedBy || me || ''}` : '이슈 기록으로 만든 초안';
  return (
    <article data-project={p.name} className={clsx('board-panel',
      p.warnings.length ? 'warn' : status === 'reflected' && 'ok')}>
      <h3>
        {p.name}{p.milestone && <span className="ms">{p.milestone}</span>}
        <span className={STATUS_CLS[status]}>{STATUS_KO[status]}</span>
      </h3>
      {p.tasks.length > 0 && (
        <ul className="board-tasks">
          {p.tasks.map((t) => (
            <li key={`${t.repo}#${t.number}`}>
              <StageRing stage={t.stage} size={12} /><span className="t">{t.title}</span>
              <span className="s">{t.prevStage && t.prevStage !== t.stage ? `${ko(t.prevStage)} → ` : ''}{ko(t.stage)}</span>
            </li>
          ))}
        </ul>
      )}
      <textarea ref={ref} value={text} onChange={(e) => onEdit(e.target.value)} spellCheck={false} aria-label={`${p.name} 보고 문장`}
        className="board-rp-text" />
      {p.warnings.length > 0 && (
        <ul className="board-warns">
          {p.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {p.sheetText && <details className="board-sheet"><summary>확정한 내용</summary>
        <pre>{p.sheetText}</pre></details>}
      <div className="board-panel-foot">
        <span className="who">{who}</span>
        {status !== 'auto' && <button type="button" className="btn" disabled={busy} onClick={(e) => void act('reset', e.currentTarget)}>자동 초안으로</button>}
        <button type="button" className="btn primary" disabled={busy || !canReflect} onClick={(e) => void act('reflect', e.currentTarget)}>확정</button>
      </div>
    </article>
  );
}
