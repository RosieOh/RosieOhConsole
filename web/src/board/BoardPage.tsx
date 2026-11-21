import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Toaster, toast } from 'sonner';
import { api, LOGIN_URL, logout } from './lib/api';
import type { BoardData, Card, ColumnKey, Me, Stage } from './lib/types';
import { cardKey, needsCheck, undoPlan } from './lib/format';
import { colorOf, ko } from './lib/stages';
import { field } from './lib/field';
import { cheer } from './lib/cheer';
import { Board } from './components/Board';
import { Sidebar, type View } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Drawer } from './components/Drawer';
import { Palette, type PaletteAction } from './components/Palette';
import { ViewersModal } from './components/ViewersModal';
import { ReposModal } from './components/ReposModal';
import { ReportPage } from './components/ReportPage';
import { FieldCanvas } from './components/FieldCanvas';
import { UnlinkedList } from './components/UnlinkedList';

export type BoardSubPage = 'board' | 'report';

const REFRESH_MS = 20000;

/**
 * 마지막으로 받은 보드(#159). 다른 탭에 갔다 돌아오면 BoardPage 는 새로
 * 만들어지는데, 그때마다 빈 화면에서 시작하면 한 박자 비어 보인다. 기억해 둔
 * 것을 먼저 그리고 받아온 것으로 덮는다(stale-while-revalidate).
 * 모듈 수준에 두는 이유 — 컴포넌트가 사라져도 남아야 한다. 새로고침하면 비는
 * 것이 맞다(판정 기준 시각이 화면에 적혀 있다).
 */
let cached: BoardData | null = null;
/** 업무 메뉴에 손이 올라가면 미리 받아 둔다 — 클릭하고 나서 받으면 늦다 */
export function prefetchBoard() {
  if (cached) return;
  void api.board().then((d) => { cached = d; }).catch(() => {});
}
const flat = (d: BoardData | null) => (d ? d.columns.flatMap((col) => col.cards.map((card) => ({ card, stage: col.key }))) : []);

/** 화면에서 카드를 옮겨 두고(서버 응답을 기다리지 않는다), 실패하면 다시 불러온다 */
function moveLocal(d: BoardData, key: string, to: ColumnKey): BoardData {
  let moved: Card | null = null;
  const columns = d.columns.map((col) => {
    const i = col.cards.findIndex((c) => cardKey(c) === key);
    if (i < 0) return col;
    moved = col.cards[i];
    return { ...col, cards: col.cards.filter((_, k) => k !== i) };
  });
  if (!moved) return d;
  const m = moved as Card;
  const card: Card = { ...m, stage: to, human: to as Stage, manual: true, disagree: !!(m.derivedStage && m.derivedStage !== to) };
  return { ...d, columns: columns.map((col) => (col.key === to ? { ...col, cards: [card, ...col.cards] } : col)) };
}

/**
 * 업무보드(#148) — 콘솔 안의 한 페이지. 예전에는 /board/ 의 별도 앱이었다.
 * 화면 전환(보드 ↔ 주간보고)과 로그인은 콘솔이 맡고, 여기는 보드 자체만 본다.
 */
export function BoardPage({ me, sub, onSub }: { me: Me; sub: BoardSubPage; onSub: (p: BoardSubPage) => void }) {
  const [data, setData] = useState<BoardData | null>(cached);
  const [view, setView] = useState<View>('all');
  const [q, setQ] = useState(''), [who, setWho] = useState(''), [repo, setRepo] = useState('');
  const [drawer, setDrawer] = useState<string | null>(null);
  const [palette, setPalette] = useState(false), [viewers, setViewers] = useState(false), [repos, setRepos] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const [boot, setBoot] = useState(!cached);   // 기억해 둔 것이 있으면 다시 등장하지 않는다
  const dragging = useRef(false), busy = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // ⚠ data 를 의존성에 두면 받아올 때마다 load 의 신원이 바뀌고, 그걸 쓰는
  //    효과들이 줄줄이 다시 걸린다(#159). 있는지만 보면 되니 ref 로 본다.
  const has = useRef(!!cached);
  const load = useCallback(async () => {
    try { const d = await api.board(); cached = d; has.current = true; setData(d); }
    catch (e) { if (!has.current) toast.error(`보드를 불러오지 못했습니다, ${(e as Error).message}`, { action: { label: '다시 시도', onClick: () => void load() } }); }
  }, []);

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);
  // 화면에 보이는 것을 그대로 기억한다 — 카드를 옮긴 직후 나갔다 돌아와도
  // 옮기기 전 모습이 잠깐 비치지 않게(#159). load 뿐 아니라 즉시 반영한
  // 이동(moveLocal)까지 담긴다.
  useEffect(() => { if (data) cached = data; }, [data]);
  useEffect(() => { const t = setTimeout(() => setBoot(false), 1800); return () => clearTimeout(t); }, []);
  /** 조용할 때만 갱신한다 — 끌고 있거나 무언가 열려 있으면 건너뛴다 */
  const quiet = () => dragging.current || busy.current > 0 || !!picked || !!drawer || palette || viewers || repos || document.activeElement === searchRef.current;
  // ⚠ 아래 효과에는 의존성 배열이 없었다. 렌더마다 setInterval 을 새로 걸어서,
  //    렌더가 잦으면 20초가 영영 안 차고 주기 갱신이 안 돌았다(#159).
  //    한 번만 걸되, 효과가 옛 quiet 을 붙잡지 않도록 매 렌더 최신 것을 ref 에 둔다.
  const quietRef = useRef(quiet);
  quietRef.current = quiet;
  useEffect(() => {
    const t = setInterval(() => { if (!quietRef.current()) void load(); }, REFRESH_MS);
    const v = () => { if (!document.hidden && !quietRef.current()) void load(); };
    document.addEventListener('visibilitychange', v);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); };
  }, [load]);

  const cards = useMemo(() => flat(data).map((x) => x.card), [data]);
  const mine = useCallback((c: Card) => !!me.login && !data?.readonly && (me.admin || c.assignees.includes(me.login)), [me, data]);
  const denyReason = data?.readonly ? '읽기 전용 보드입니다, 쓰기 토큰이 없습니다' : !me.login ? '로그인하세요' : '담당자만 옮길 수 있습니다';
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = useCallback((c: Card) => {
    const hay = `${c.title} ${c.repo} #${c.number} ${c.assignees.join(' ')} ${c.milestone}`.toLowerCase();
    return words.every((w) => hay.includes(w)) && (!who || c.assignees.includes(who)) && (!repo || c.repo === repo)
      && (view !== 'risk' || needsCheck(c)) && (view !== 'mine' || (!!me.login && c.assignees.includes(me.login)));
  }, [words.join(' '), who, repo, view, me.login]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = { all: cards.length, mine: me.login ? cards.filter((c) => c.assignees.includes(me.login!)).length : 0, risk: cards.filter(needsCheck).length, unlinked: data?.unlinked?.length || 0 };

  async function call<T>(fn: () => Promise<T>) { busy.current++; try { return await fn(); } finally { busy.current--; } }

  /** 단계 이동 — 성공하면 이슈 라벨이 실제로 바뀐 것이다 */
  async function move(card: Card, to: string, opts: { undoable?: boolean } = {}) {
    const key = cardKey(card), from = card.stage, prevHuman = card.human;
    setData((d) => (d ? moveLocal(d, key, to as ColumnKey) : d));
    try {
      await call(() => api.move(card, to));
      setLanded(key); setTimeout(() => setLanded((k) => (k === key ? null : k)), 950);
      // 완료·운영 반영으로 갔으면 그 카드 자리에서 축하한다(#148)
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-card="${CSS.escape(key)}"]`);
        const r = el?.getBoundingClientRect();
        if (r) cheer(to, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      });
      if (opts.undoable === false) { toast('되돌렸습니다'); return; }
      toast(`${ko(from)} → ${ko(to)}`, {
        duration: 8000,
        action: { label: '되돌리기', onClick: () => void undo(card, from, prevHuman) },
        ...(to === 'done' || to === 'cancelled' ? { cancel: { label: '이슈도 닫기', onClick: () => void closeIssue(card) } } : {}),
      });
    } catch (e) {
      toast.error(`옮기지 못했습니다, ${(e as Error).message}`);
      void load();
    }
  }
  async function undo(card: Card, from: string, prevHuman: Stage | null) {
    const plan = undoPlan({ from, prevHuman });
    if (plan.path === '/api/move') { void move({ ...card, stage: card.stage }, plan.to, { undoable: false }); return; }
    try { await call(() => api.follow(card)); toast('되돌렸습니다, 다시 기록을 따릅니다'); } catch (e) { toast.error(`되돌리지 못했습니다, ${(e as Error).message}`); }
    void load();
  }
  async function closeIssue(card: Card) {
    try { await call(() => api.close(card)); toast.success('이슈를 닫았습니다'); } catch (e) { toast.error(`닫지 못했습니다, ${(e as Error).message}`); }
    void load();
  }
  /** 키보드·팔레트로 옮길 때 — 카드 자리에서 물결 */
  function moveFrom(card: Card, to: string) {
    if (to === card.stage || to === 'unstaged') return;
    const el = document.querySelector(`[data-card="${CSS.escape(cardKey(card))}"]`);
    if (el) { const r = el.getBoundingClientRect(); field.ripple(r.left + r.width / 2, r.top + r.height / 2, colorOf(to), true); }
    void move(card, to);
  }

  // 키보드: / 검색, ⌘K 팔레트, 카드에서 Enter 상세 · Space 집기 · ←/→ 옮기기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); return; }
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'Escape' && picked) { setPicked(null); return; }
      if (typing || !data) return;
      const key = el?.closest?.('[data-card]')?.getAttribute('data-card');
      const card = key ? cards.find((c) => cardKey(c) === key) : null;
      if (!card || !key) return;
      if (e.key === 'Enter') { e.preventDefault(); setDrawer(key); return; }
      if (e.key === ' ') {
        e.preventDefault();
        if (!mine(card)) { toast(denyReason); return; }
        setPicked(picked === key ? null : key);
        return;
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && picked === key) {
        e.preventDefault();
        const keys = data.columns.map((c) => c.key).filter((k) => k !== 'unstaged');
        const next = keys[keys.indexOf(card.stage as never) + (e.key === 'ArrowRight' ? 1 : -1)];
        if (next) { moveFrom(card, next); requestAnimationFrame(() => (document.querySelector(`[data-card="${CSS.escape(key)}"]`) as HTMLElement | null)?.focus()); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const drawerCard = drawer ? cards.find((c) => cardKey(c) === drawer) || null : null;
  const target = (picked && cards.find((c) => cardKey(c) === picked)) || drawerCard;
  const actions: PaletteAction[] = [
    { group: '화면', label: '주간보고 검수', run: () => onSub('report') },
    { group: '화면', label: '보드', run: () => onSub('board') },
    { group: '보기', label: '모든 업무', run: () => { onSub('board'); setView('all'); } },
    { group: '보기', label: '내 업무', run: () => { onSub('board'); setView('mine'); } },
    { group: '보기', label: '확인 필요한 업무만', run: () => { onSub('board'); setView('risk'); } },
    { group: '보기', label: '미연결 작업 (이슈 번호 없는 PR, 브랜치)', run: () => { onSub('board'); setView('unlinked'); } },
    { group: '보기', label: '필터 모두 지우기', run: () => { setQ(''); setWho(''); setRepo(''); setView('all'); } },
    ...(target && mine(target) ? (data?.columns || []).filter((c) => c.key !== target.stage && c.key !== 'unstaged')
      .map((c) => ({ group: '단계 옮기기', label: `${ko(c.key)}(으)로 옮기기`, ring: c.key, run: () => moveFrom(target, c.key) })) : []),
    ...(me.admin ? [{ group: '관리', label: '열람 권한 관리', run: () => setViewers(true) }, { group: '관리', label: '저장소 관리', run: () => setRepos(true) }] : []),
    me.login
      ? { group: '계정', label: '로그아웃', run: logout }
      : { group: '계정', label: 'GitHub 으로 로그인', run: () => { location.href = LOGIN_URL; } },
  ];

  return (
    <div className={'board-scope' + (boot ? ' boot' : '')}>
      <FieldCanvas />
      <Sidebar cards={cards} me={me} view={view} who={who} repo={repo} batchAt={data?.batchAt || null} counts={counts}
        onView={(v) => { if (v === 'mine' && !me.login) { toast('로그인하면 내 업무만 볼 수 있습니다'); return; } setView(v); onSub('board'); }}
        onWho={setWho} onRepo={setRepo} onViewers={() => setViewers(true)} onRepos={() => setRepos(true)} />
      <main className="board-main">
        <TopBar q={q} onQ={setQ} risk={view === 'risk'} showRisk={sub === 'board'}
          onRisk={() => setView(view === 'risk' ? 'all' : 'risk')} onPalette={() => setPalette(true)} searchRef={searchRef} />
        {data?.warning && <div className="board-alert">{data.warning}</div>}
        {sub === 'board' && view === 'unlinked' ? (
          <UnlinkedList items={data?.unlinked || []} at={data?.unlinkedAt || null} q={q} who={who} repo={repo} />
        ) : sub === 'board' ? (
          data ? <Board data={data} visible={visible} mine={mine} pickedKey={picked} landedKey={landed} boot={boot}
            onOpen={(c) => setDrawer(cardKey(c))} onMove={(c, to) => void move(c, to)} onDenied={() => toast(denyReason)}
            onDragging={(on) => { dragging.current = on; }} />
            : <div className="board-skel-cols">{[0, 1, 2, 3].map((i) => <div key={i} className="skel board-skel-col" />)}</div>
        ) : (
          <section className="board-report" aria-label="주간보고 검수">
            <ReportPage me={me.login} active={sub === 'report'} />
          </section>
        )}
      </main>
      <AnimatePresence>
        {drawerCard && <Drawer key="drawer" card={drawerCard} can={mine(drawerCard)} denyReason={denyReason} onClose={() => setDrawer(null)}
          onBlocked={async () => {
            const was = drawerCard.flags.includes('blocked');
            try { await call(() => api.blocked(drawerCard)); toast(was ? '막힘을 풀었습니다' : '막힘으로 표시했습니다'); } catch (e) { toast.error(`바꾸지 못했습니다, ${(e as Error).message}`); }
            setDrawer(null); void load();
          }}
          onFollow={async () => {
            try { await call(() => api.follow(drawerCard)); toast(`기록을 따르게 했습니다${drawerCard.derivedStage ? `, ${ko(drawerCard.derivedStage)}` : ''}`); } catch (e) { toast.error(`바꾸지 못했습니다, ${(e as Error).message}`); }
            setDrawer(null); void load();
          }} />}
        {palette && <Palette key="palette" actions={actions} cards={flat(data)} onClose={() => setPalette(false)}
          onOpenCard={(c) => { onSub('board'); setView('all'); setDrawer(cardKey(c)); }} />}
      </AnimatePresence>
      <AnimatePresence>
        {viewers && <ViewersModal key="viewers" onClose={() => setViewers(false)} />}
        {repos && <ReposModal key="repos" onClose={() => setRepos(false)} onChanged={() => void load()} />}
      </AnimatePresence>
      {/* 알림은 콘솔 테마를 따른다 — 모양은 board.css 의 .board-toast* 가 정한다 */}
      <Toaster position="bottom-center" closeButton={false}
        toastOptions={{ classNames: { toast: 'board-toast', actionButton: 'board-toast-act', cancelButton: 'board-toast-cancel' } }} />
    </div>
  );
}
