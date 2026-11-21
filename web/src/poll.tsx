import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// 화면 자동 갱신 — 몇 초 전에 갱신했고 몇 초 뒤 다시 하는지 보여 주고, 직접 새로고침도. 직접 누르면 다음 자동 갱신까지 다시 센다
export interface Poll { lastAt: number | null; nextAt: number | null; loading: boolean; failed: boolean; every: number; refresh: () => void }

export function usePoll(fn: (force: boolean) => unknown, every: number, deps: unknown[] = []): Poll {
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const f = useRef(fn); f.current = fn;
  const run = useCallback(async (force: boolean) => {
    window.clearTimeout(timer.current);
    setLoading(true);
    try { await f.current(force); setFailed(false); } catch { setFailed(true); }
    setLoading(false); setLastAt(Date.now());
    if (every > 0) timer.current = window.setTimeout(() => void run(false), every);
  }, [every]);
  useEffect(() => { void run(false); return () => window.clearTimeout(timer.current); }, [run, ...deps]);   // eslint-disable-line
  return { lastAt, nextAt: lastAt && every > 0 ? lastAt + every : null, loading, failed, every, refresh: () => void run(true) };
}

const ago = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))}초 전` : `${Math.round(ms / 60_000)}분 전`);
const left = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.ceil(ms / 1000))}초 뒤` : `${Math.ceil(ms / 60_000)}분 뒤`);

export function RefreshBar({ poll, live }: { poll: Poll; live?: boolean }) {
  const [, tick] = useState(0);
  // 누르면 한 바퀴. 클래스로 걸면 폴링 리렌더에 className 이 되돌아가 애니메이션이
  // 끊긴다 — DOM 요소에 직접 건다(Web Animations). 리렌더와 무관하게 끝까지 돈다.
  const icon = useRef<SVGSVGElement>(null);
  const spinOnce = () => {
    const el = icon.current;
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());        // 연타하면 처음부터 다시
    const slow = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
      { duration: slow ? 3600 : 1800, easing: 'cubic-bezier(0.34, 0.68, 0.26, 1)' });
  };
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  // 자동 갱신에도 돈다 — 불러오기가 시작되는 순간(거짓→참)에 한 바퀴.
  // 클릭이든 폴링이든 같은 자리에서 걸리므로 직접 부르는 곳은 없어도 된다.
  const wasLoading = useRef(false);
  useEffect(() => {
    if (poll.loading && !wasLoading.current) spinOnce();
    wasLoading.current = poll.loading;
  });
  const now = Date.now();
  return (
    <div className="refresh">
      {live ? <span className="live"><i />실시간</span> : null}
      <span className={poll.failed ? 'red' : 'muted'}>
        {poll.loading && !poll.lastAt ? '불러오는 중' : poll.failed ? '갱신 실패' : poll.lastAt ? `${ago(now - poll.lastAt)} 갱신` : ''}
        {!live && poll.nextAt && !poll.loading ? `, ${left(poll.nextAt - now)} 다시` : ''}
      </span>
      <button className="btn sm" onClick={() => { poll.refresh(); }} disabled={poll.loading} title="지금 새로고침">
        <RefreshCw ref={icon} size={14} />새로고침
      </button>
    </div>
  );
}
