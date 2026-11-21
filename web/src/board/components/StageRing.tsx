import type { CSSProperties } from 'react';
import { STAGE_PROGRESS, colorOf } from '../lib/stages';

/** 단계 링 (Linear 식) — 접수·미분류는 점선, 진행할수록 안쪽 파이가 차고, 완료는 체크, 취소는 X */
export function StageRing({ stage, size = 14 }: { stage: string; size?: number }) {
  const s = size, c = colorOf(stage), h = s / 2, R = h - 1.25;
  const box = { className: 'stage-ring', width: s, height: s, viewBox: `0 0 ${s} ${s}`, 'aria-hidden': true } as const;
  if (stage === 'done') {
    return (
      <svg {...box}>
        <circle cx={h} cy={h} r={R + 0.5} fill={c} />
        <path d={`M${s * .3} ${s * .52} L${s * .44} ${s * .66} L${s * .71} ${s * .37}`} fill="none" style={{ stroke: 'var(--bg)' }} strokeWidth={s * .12} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (stage === 'cancelled') {
    return (
      <svg {...box}>
        <circle cx={h} cy={h} r={R} fill="none" stroke={c} strokeWidth={1.5} />
        <path d={`M${s * .36} ${s * .36} L${s * .64} ${s * .64} M${s * .64} ${s * .36} L${s * .36} ${s * .64}`} stroke={c} strokeWidth={1.5} strokeLinecap="round" />
      </svg>
    );
  }
  const dashed = stage === 'intake' || stage === 'unstaged' || !(stage in STAGE_PROGRESS);
  const p = STAGE_PROGRESS[stage as keyof typeof STAGE_PROGRESS] || 0;
  const r2 = R / 2, full = 2 * Math.PI * r2;
  const style = { strokeDasharray: full, strokeDashoffset: full * (1 - p), '--full': full } as CSSProperties;
  return (
    <svg {...box}>
      <circle cx={h} cy={h} r={R} fill="none" stroke={c} strokeWidth={1.5} strokeDasharray={dashed ? '2 1.8' : undefined} />
      {p > 0 && <circle className="pie" cx={h} cy={h} r={r2} fill="none" stroke={c} strokeWidth={R} transform={`rotate(-90 ${h} ${h})`} style={style} />}
    </svg>
  );
}
