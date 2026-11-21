import { useEffect, useRef } from 'react';

// 로그 상자 — 열리면 맨 아래(실패 지점)부터, 오류·경고 줄 강조, 러너 잡음 줄은 흐리게
const ERR = /\b(ERROR|Error|FAIL(ED|URE)?|failed|Exception|exit code [1-9]|exitcode '[1-9]|BUILD FAILED|tests completed, \d+ failed)/;
const WARN = /\b(WARN(ING)?|warning)\b/;
const NOISE = /^(::(group|endgroup)|##\[|\[command\])/;

export function LogBox({ text, maxHeight = 420 }: { text: string; maxHeight?: number | string }) {
  const ref = useRef<HTMLPreElement>(null);
  // 마지막 오류 줄을 가운데로(없으면 맨 아래) — 실패 원인이 바로 보이게
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const errs = el.querySelectorAll<HTMLElement>('.err-line');
    const last = errs[errs.length - 1];
    if (last) el.scrollTop = Math.max(0, last.offsetTop - el.clientHeight / 2);
    else el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <pre ref={ref} className="out logbox" style={{ maxHeight }}>
      {text.split('\n').map((l, i) => <div key={i} className={ERR.test(l) ? 'err-line' : WARN.test(l) ? 'warn-line' : NOISE.test(l) ? 'noise-line' : ''}>{l || '\u00a0'}</div>)}
    </pre>
  );
}
