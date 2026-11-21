import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// 가운데 창 — body 에 띄운다(카드의 transform 안에 있으면 fixed 가 카드 기준이 돼 창이 카드 안팎을 오간다, #131).
// Esc, 바깥 클릭으로 닫는다(바깥에서 누르고 바깥에서 뗐을 때만, 안에서 끌다 바깥에서 놓으면 안 닫힌다). height 를 주면 내용이 바뀌어도 창 높이는 그대로(넘치면 본문 스크롤)
export function Modal({ title, icon, onClose, children, footer, width = 620, height }: { title: React.ReactNode; icon?: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number; height?: number }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);
  const downOut = useRef(false);
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => { e.stopPropagation(); downOut.current = e.target === e.currentTarget; }} onClick={(e) => { e.stopPropagation(); if (downOut.current && e.target === e.currentTarget) onClose(); downOut.current = false; }}>
      <div className="modal" style={{ width: `min(${width}px, calc(100vw - 32px))`, ...(height ? { height: `min(${height}px, calc(100vh - 48px))` } : {}) }} onClick={(e) => e.stopPropagation()} role="dialog">
        <header className="modal-head">{icon}<h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="닫기"><X size={18} /></button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
