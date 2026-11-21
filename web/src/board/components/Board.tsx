import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragMoveEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import clsx from 'clsx';
import type { BoardData, Card, Column } from '../lib/types';
import { NEEDS_CHECK_TIP, colorOf } from '../lib/stages';
import { cardKey, needsCheck } from '../lib/format';
import { field } from '../lib/field';
import { StageRing } from './StageRing';
import { CardView } from './CardView';

interface Props {
  data: BoardData;
  visible: (c: Card) => boolean;
  mine: (c: Card) => boolean;
  pickedKey: string | null;
  landedKey: string | null;
  boot: boolean;
  onOpen: (c: Card) => void;
  onMove: (c: Card, to: string) => void;
  onDenied: () => void;
  onDragging: (on: boolean) => void;
}

/**
 * 칸반 — 카드를 들면 유령 카드가 속도만큼 기울어지고, 놓을 칸은 단계 색으로 빛나며 맨 위에 자리가 벌어진다.
 * 놓는 순간 배경에 물결이 번지고, 카드는 새 칸에서 링이 차오르며 내려앉는다.
 */
export function Board({ data, visible, mine, pickedKey, landedKey, boot, onOpen, onMove, onDenied, onDragging }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [active, setActive] = useState<{ card: Card; from: string; height: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const pointer = useRef({ x0: 0, y0: 0, x: 0, y: 0, lastDx: 0, vx: 0 });
  const boardRef = useRef<HTMLDivElement>(null);

  const validTarget = (key: string | null, from: string) => !!key && key !== from && key !== 'unstaged';

  function onDragStart(e: DragStartEvent) {
    const card = e.active.data.current?.card as Card;
    const from = e.active.data.current?.from as string;
    const ev = e.activatorEvent as PointerEvent;
    pointer.current = { x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, lastDx: 0, vx: 0 };
    setActive({ card, from, height: e.active.rect.current.initial?.height || 90 });
    document.body.classList.add('grabbing');
    onDragging(true);
  }
  function onDragMove(e: DragMoveEvent) {
    const p = pointer.current;
    p.x = p.x0 + e.delta.x; p.y = p.y0 + e.delta.y;
    p.vx = p.vx * 0.5 + (e.delta.x - p.lastDx) * 0.5; p.lastDx = e.delta.x;
    field.attract(p.x, p.y, colorOf(validTarget(over, active?.from || '') ? over : active?.from));
    edgeScroll(boardRef.current, p.x);
  }
  function onDragOver(e: DragOverEvent) { setOver((e.over?.id as string) || null); }
  function finish() { document.body.classList.remove('grabbing'); field.release(); setActive(null); setOver(null); onDragging(false); }
  function onDragEnd(e: DragEndEvent) {
    const a = active, target = (e.over?.id as string) || null;
    finish();
    if (!a || !validTarget(target, a.from)) return;
    field.ripple(pointer.current.x, pointer.current.y, colorOf(target), true);   // 물결은 놓을 때만
    onMove(a.card, target!);
  }

  const dropOk = !!active && validTarget(over, active.from);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={finish}>
      <LayoutGroup>
        <div ref={boardRef} className="board-cols">
          {data.columns.map((col, i) => (
            <ColumnView key={col.key} col={col} index={i} boot={boot} visible={visible} mine={mine}
              pickedKey={pickedKey} landedKey={landedKey} onOpen={onOpen} onDenied={onDenied}
              activeFrom={active?.from || null} activeKey={active ? cardKey(active.card) : null}
              slotHeight={dropOk && over === col.key ? active!.height : 0} />
          ))}
        </div>
      </LayoutGroup>
      <DragOverlay dropAnimation={dropOk ? null : { duration: 320, easing: 'cubic-bezier(.2,.9,.25,1.12)' }}>
        {active && <Ghost card={active.card} pointer={pointer} />}
      </DragOverlay>
    </DndContext>
  );
}

/** 끌고 다니는 카드 — 속도만큼 기울었다가 스프링처럼 돌아온다 */
function Ghost({ card, pointer }: { card: Card; pointer: React.RefObject<{ vx: number }> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let rot = 0, scale = 1, raf = 0;
    const tick = () => {
      const p = pointer.current!;
      const want = Math.max(-11, Math.min(11, p.vx * 0.9));
      rot += (want - rot) * 0.18; p.vx *= 0.82; scale += (1.045 - scale) * 0.25;
      if (ref.current) ref.current.style.transform = `rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pointer]);
  return <div ref={ref} className="board-ghost-wrap"><CardView card={card} ghost /></div>;
}

function ColumnView({ col, index, boot, visible, mine, pickedKey, landedKey, onOpen, onDenied, activeFrom, activeKey, slotHeight }: {
  col: Column; index: number; boot: boolean; visible: (c: Card) => boolean; mine: (c: Card) => boolean;
  pickedKey: string | null; landedKey: string | null; onOpen: (c: Card) => void; onDenied: () => void;
  activeFrom: string | null; activeKey: string | null; slotHeight: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key, disabled: col.key === 'unstaged' });
  const shown = col.cards.filter(visible);
  const risk = col.cards.filter(needsCheck).length;
  const glowing = isOver && !!activeFrom && activeFrom !== col.key && col.key !== 'unstaged';
  return (
    <section ref={setNodeRef} data-stage={col.key}
      style={{ '--c': colorOf(col.key), '--i': index } as CSSProperties}
      className={clsx('board-col', glowing && 'glow', activeFrom && col.key === 'unstaged' && 'dim')}>
      <h2 className="col-head">
        <StageRing stage={col.key} size={15} />
        <span>{col.title}</span>
        <span className="board-col-n">{shown.length}</span>
        {risk > 0 && <span tabIndex={0} data-tip={NEEDS_CHECK_TIP}
          className="board-badge board-badge-d board-col-risk">확인 필요 {risk}</span>}
      </h2>
      <div className="board-col-list">
        <AnimatePresence initial={false}>
          {slotHeight > 0 && (
            <motion.div key="slot" className="board-slot"
              initial={{ height: 0, opacity: 0 }} animate={{ height: slotHeight, opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} />
          )}
        </AnimatePresence>
        {col.cards.map((c, k) => (
          <DraggableCard key={cardKey(c)} card={c} from={col.key} hidden={!visible(c)} locked={!mine(c)}
            picked={pickedKey === cardKey(c)} landed={landedKey === cardKey(c)} dragging={activeKey === cardKey(c)}
            boot={boot} order={k} onOpen={onOpen} onDenied={onDenied} />
        ))}
        {shown.length === 0 && slotHeight === 0 && (
          <div className="board-col-empty">없음</div>
        )}
      </div>
    </section>
  );
}

function DraggableCard({ card, from, hidden, locked, picked, landed, dragging, boot, order, onOpen, onDenied }: {
  card: Card; from: string; hidden: boolean; locked: boolean; picked: boolean; landed: boolean; dragging: boolean;
  boot: boolean; order: number; onOpen: (c: Card) => void; onDenied: () => void;
}) {
  const key = cardKey(card);
  const { setNodeRef, listeners, attributes } = useDraggable({ id: key, data: { card, from }, disabled: locked });
  const denied = useRef<{ x: number; y: number; told: boolean } | null>(null);
  if (hidden) return null;
  return (
    <motion.article ref={setNodeRef} data-card={key}
      layoutId={landed ? undefined : key} layout={!landed}
      initial={boot ? { opacity: 0, y: 8, scale: 0.985 } : false}
      animate={{ opacity: dragging ? 0.28 : 1, y: 0, scale: dragging ? 0.97 : 1 }}
      transition={{ layout: { duration: 0.46, ease: [0.16, 1, 0.3, 1] }, opacity: { duration: 0.2, delay: boot ? order * 0.022 + 0.18 : 0 }, y: { duration: 0.5, delay: boot ? order * 0.022 + 0.18 : 0 } }}
      className={clsx('board-cardwrap', locked && 'locked', landed && 'landed', picked && 'picked', dragging && 'dragging')}
      style={{ '--c': colorOf(card.stage), touchAction: 'pan-y' } as CSSProperties}
      {...attributes} {...(locked ? {} : listeners)} role="button" aria-roledescription="업무 카드"
      onClick={() => onOpen(card)}
      onPointerDown={(e) => {
        if (!locked) { listeners?.onPointerDown?.(e); return; }
        denied.current = { x: e.clientX, y: e.clientY, told: false };
      }}
      onPointerMove={(e) => {
        const d = denied.current;
        if (!d || d.told) return;
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 5) { d.told = true; onDenied(); }
      }}
      onPointerUp={() => { denied.current = null; }}>
      <CardView card={card} />
    </motion.article>
  );
}

function edgeScroll(el: HTMLElement | null, x: number) {
  if (!el) return;
  const pad = 90, left = el.getBoundingClientRect().left;
  if (x < left + pad) el.scrollLeft -= Math.ceil((left + pad - x) / 6);
  else if (x > window.innerWidth - pad) el.scrollLeft += Math.ceil((x - (window.innerWidth - pad)) / 6);
}
