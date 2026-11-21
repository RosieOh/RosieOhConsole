import { Command } from 'cmdk';
import { motion } from 'framer-motion';
import type { Card, ColumnKey } from '../lib/types';
import { ko } from '../lib/stages';
import { repoShort } from '../lib/format';
import { Portal, Scrim, useEscape } from './Overlay';
import { StageRing } from './StageRing';

export interface PaletteAction { group: string; label: string; ring?: string; run: () => void }

/** ⌘K 명령 팔레트 — 화면·보기 전환, 선택한 카드 단계 옮기기, 관리, 업무 찾기 */
export function Palette({ actions, cards, onClose, onOpenCard }: {
  actions: PaletteAction[]; cards: Array<{ card: Card; stage: ColumnKey }>; onClose: () => void; onOpenCard: (c: Card) => void;
}) {
  useEscape(onClose);
  const groups = [...new Set(actions.map((a) => a.group))];
  const pick = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <>
      <Scrim onClose={onClose} />
      <Portal><motion.div className="board-pop board-cmd"
        initial={{ opacity: 0, y: -10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
        <Command label="명령" loop>
          <Command.Input autoFocus placeholder="업무 찾기 또는 명령…" className="board-cmd-input" />
          <Command.List className="board-cmd-list">
            <Command.Empty className="board-cmd-empty">찾는 게 없습니다</Command.Empty>
            {groups.map((g) => (
              <Command.Group key={g} heading={g}>
                {actions.filter((a) => a.group === g).map((a) => (
                  <Command.Item key={g + a.label} value={`${g} ${a.label}`} onSelect={pick(a.run)} className="board-cmd-item">
                    {a.ring ? <StageRing stage={a.ring} size={13} /> : <span className="board-cmd-gap" />}<span>{a.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
            <Command.Group heading="업무">
              {cards.map(({ card, stage }) => (
                <Command.Item key={`${card.repo}#${card.number}`} value={`${card.title} ${card.repo} #${card.number} ${card.assignees.join(' ')}`}
                  onSelect={pick(() => onOpenCard(card))} className="board-cmd-item">
                  <StageRing stage={stage} size={13} /><span className="board-cmd-t">{card.title}</span>
                  <span className="board-cmd-s">{repoShort(card.repo)}#{card.number}, {ko(stage)}</span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </motion.div></Portal>
    </>
  );
}
