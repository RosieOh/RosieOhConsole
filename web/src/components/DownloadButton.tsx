import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Mirage } from 'ldrs/react';
import 'ldrs/react/Mirage.css';
import confetti from 'canvas-confetti';

// 다운로드 버튼. 브라우저에 맡기지 않고 직접 받아서(진행률을 알 수 있게) 다 받으면 파일로 저장한다.
// 받는 동안: 물결 로더 + 버튼이 왼쪽부터 차오름 + 퍼센트, 다 받으면: 체크가 그려지고 버튼에서 색종이가 터진다.
// 직접 받기가 안 되는 환경(오래된 브라우저 등)이면 예전처럼 주소로 넘긴다.
type St = { s: 'idle' } | { s: 'busy'; pct: number | null } | { s: 'done' } | { s: 'err'; msg: string };

export function DownloadButton({ href, name, size, label, className = '', onDone }: { href: string; name: string; size?: number; label: React.ReactNode; className?: string; onDone?: () => void }) {
  const [st, setSt] = useState<St>({ s: 'idle' });
  const btn = useRef<HTMLButtonElement>(null);
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => ac.current?.abort(), []);

  async function go() {
    if (st.s === 'busy') return;
    if (!('ReadableStream' in window) || !window.fetch) { location.href = href; return; }
    const c = new AbortController(); ac.current = c;
    setSt({ s: 'busy', pct: 0 });
    try {
      const res = await fetch(href, { credentials: 'same-origin', signal: c.signal });
      if (!res.ok || !res.body) {
        let msg = `받지 못했습니다(HTTP ${res.status})`;
        try { msg = (await res.json()).message || msg; } catch { /* 본문 없음 */ }
        throw new Error(msg);
      }
      const total = Number(res.headers.get('content-length')) || size || 0;
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      let got = 0, last = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length;
        const now = Date.now();
        if (now - last > 120) { last = now; setSt({ s: 'busy', pct: total ? Math.min(99, Math.floor((got / total) * 100)) : null }); }
      }
      const url = URL.createObjectURL(new Blob(parts as BlobPart[], { type: 'application/vnd.android.package-archive' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setSt({ s: 'done' });
      burst();
      onDone?.();
      setTimeout(() => setSt((x) => (x.s === 'done' ? { s: 'idle' } : x)), 2600);
    } catch (e: any) {
      if (c.signal.aborted) return;
      setSt({ s: 'err', msg: String(e?.message || e) });
      setTimeout(() => setSt((x) => (x.s === 'err' ? { s: 'idle' } : x)), 4000);
    }
  }

  function burst() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const origin = { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight };
    const colors = ['#2563eb', '#22c55e', '#a855f7', '#f59e0b', '#ec4899'];
    confetti({ particleCount: 70, spread: 75, startVelocity: 32, ticks: 160, scalar: 0.85, origin, colors, zIndex: 9999, disableForReducedMotion: true });
    setTimeout(() => confetti({ particleCount: 35, spread: 110, startVelocity: 22, ticks: 140, scalar: 0.7, origin, colors, zIndex: 9999, disableForReducedMotion: true }), 160);
  }

  const pct = st.s === 'busy' ? st.pct : null;
  return (
    <button ref={btn} type="button" className={`btn primary dl-btn ${st.s} ${className}`} onClick={go} aria-busy={st.s === 'busy'} title={st.s === 'err' ? st.msg : undefined}
      style={pct != null ? ({ '--dl': `${pct}%` } as React.CSSProperties) : undefined}>
      <span className="dl-fill" aria-hidden />
      <span className="dl-label">
        {st.s === 'idle' && <><Download size={16} />{label}</>}
        {st.s === 'busy' && <><Mirage size={42} speed={2.2} color="white" /><span className="dl-pct">{pct != null ? `${pct}%` : '받는 중'}</span></>}
        {st.s === 'done' && <><svg className="dl-check" viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M4 12.5l5 5L20 6.5" /></svg>받았습니다</>}
        {st.s === 'err' && <>다시 시도</>}
      </span>
    </button>
  );
}
