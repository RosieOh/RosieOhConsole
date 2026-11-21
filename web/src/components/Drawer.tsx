import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// 오른쪽 상세 패널 — Esc·바깥 클릭으로 닫는다. body 에 띄운다(조상의 transform 영향 없게, #131)
export function Drawer({ onClose, children, wide, width }: { onClose: () => void; children: React.ReactNode; wide?: boolean; width?: number }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);
  return createPortal(
    <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer" role="dialog" style={wide || width ? { width: `min(${width ?? 920}px, 100vw)` } : undefined}>
        <button className="drawer-close" title="닫기 (Esc)" aria-label="닫기" onClick={onClose}><X size={18} /></button>
        {children}
      </aside>
    </div>,
    document.body,
  );
}
