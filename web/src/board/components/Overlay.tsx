import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { Icon } from './Icons';

/**
 * 떠 있는 것들은 body 에 띄운다(#148).
 * 콘솔의 .fr-canvas 에는 backdrop-filter 가 걸려 있는데, 그러면 그 안의
 * position:fixed 가 화면이 아니라 캔버스를 기준으로 잡힌다. 보드가 따로 돌 때는
 * 몰랐던 문제다 — 막이 캔버스 안쪽(10,58 부터)에만 깔려서 메뉴·도크를 안 덮었다.
 * 콘솔 자신의 Drawer 도 #131 에서 같은 이유로 body 에 띄운다.
 */
export const Portal = ({ children }: { children: ReactNode }) =>
  (typeof document === 'undefined' ? null : createPortal(children, document.body));

/** 뒤를 흐리는 막 — 누르면 닫힌다 */
export function Scrim({ onClose }: { onClose: () => void }) {
  return <Portal><motion.div className="board-scrim" onClick={onClose}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} /></Portal>;
}

/** 가운데 창 (열람 권한·저장소) */
export function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEscape(onClose);
  return (
    <>
      <Scrim onClose={onClose} />
      <Portal><motion.div role="dialog" aria-label={title}
        className={clsx('board-pop board-modal', wide && 'wide')}
        initial={{ opacity: 0, y: -10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
        <button type="button" onClick={onClose} aria-label="닫기" className="board-x"><Icon name="close" size={14} /></button>
        <h3>{title}</h3>
        {children}
      </motion.div></Portal>
    </>
  );
}

export function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);
}
