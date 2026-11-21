import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export interface PickOption { value: string; label: string; disabled?: boolean }

/**
 * 고르기 — 네이티브 select 는 펼친 목록을 OS 가 그려서 흰 상자로 뜬다. 다크에서도
 * 흰 상자고, 유리 말투와 전혀 안 맞는다. CSS 로는 못 바꾸니 직접 그린다(#148).
 *
 * 목록은 body 로 띄운다. .fr-canvas 에 backdrop-filter 가 걸려 있어서 그 안의
 * position:fixed 는 화면이 아니라 캔버스 기준이 되고(#131 과 같은 부류), 표·
 * 사이드바처럼 overflow 가 있는 자리에서는 잘린다.
 *
 * side 를 주면 단추 오른쪽으로 펼친다 — 아래에 다른 것이 있어 가리면 안 될 때.
 */
export function Picker({ value, options, placeholder, label, side, style, onChange }: {
  value: string;
  options: PickOption[];
  /** 고른 것이 없을 때 보여 줄 말. 누르면 값이 '' 가 된다. 안 주면 '비우기' 줄이 없다 */
  placeholder?: string;
  label: string;
  side?: boolean;
  style?: CSSProperties;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const W = Math.max(r.width, 208);
    if (side && r.right + 8 + W < window.innerWidth - 12) {
      const top = Math.min(r.top, Math.max(12, window.innerHeight - 12 - 320));
      setPos({ left: r.right + 8, width: W, top });
      return;
    }
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const width = Math.max(r.width, 160);
    // 오른쪽으로 넘치면 끌어온다
    const left = Math.min(r.left, window.innerWidth - 12 - width);
    // 아래가 240px 도 안 나오고 위가 더 넓으면 위로 펼친다
    setPos(below < 240 && above > below
      ? { left, width, bottom: window.innerHeight - r.top + 6 }
      : { left, width, top: r.bottom + 6 });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    const move = () => place();
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('resize', move);
    window.addEventListener('scroll', move, true);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('resize', move);
      window.removeEventListener('scroll', move, true);
    };
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  const cur = options.find((o) => o.value === value);
  const pick = (v: string) => { onChange(v); setOpen(false); };
  return (
    <div className="mx-pick" style={style}>
      <button ref={btn} type="button" className="mx-pick-btn" aria-haspopup="listbox" aria-expanded={open}
        aria-label={label} onClick={() => setOpen(!open)}>
        <span className="mx-pick-cur">{cur?.label ?? placeholder ?? ''}</span>
        <ChevronDown size={14} className="mx-pick-chev" />
      </button>
      {open && pos && createPortal(
        <div ref={pop} className="mx-pick-pop" role="listbox" aria-label={label}
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}>
          {placeholder !== undefined && (
            <button type="button" role="option" aria-selected={!value}
              className={'mx-pick-item' + (!value ? ' on' : '')} onClick={() => pick('')}>{placeholder}</button>
          )}
          {options.map((o) => (
            <button key={o.value} type="button" role="option" aria-selected={value === o.value} disabled={o.disabled}
              className={'mx-pick-item' + (value === o.value ? ' on' : '')}
              onClick={() => pick(o.value)}>{o.label}</button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
