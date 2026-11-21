import { NEEDS_CHECK_TIP } from '../lib/stages';
import { Icon } from './Icons';

/**
 * 보드 안쪽 도구 줄 — 검색, 확인 필요만, ⌘K.
 * 예전에는 경로·화면 전환(보드/주간보고)·내 계정도 여기 있었다. 콘솔로 들어오면서
 * 화면 전환은 왼쪽 레일이, 계정은 콘솔 오른쪽 위 사용자 메뉴가 맡는다(#148).
 */
export function TopBar({ q, onQ, risk, showRisk, onRisk, onPalette, searchRef }: {
  q: string; onQ: (v: string) => void; risk: boolean; showRisk: boolean; onRisk: () => void;
  onPalette: () => void; searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <header className="board-topbar">
      <span className="board-spacer" />
      <label className="board-searchwrap">
        <Icon name="search" size={13} className="board-search-ic" />
        <input ref={searchRef} type="search" value={q} onChange={(e) => onQ(e.target.value)} placeholder="검색" aria-label="검색 ( / )"
          className="board-search" />
      </label>
      {showRisk && <button type="button" className="tbtn" aria-pressed={risk} data-tip={NEEDS_CHECK_TIP} onClick={onRisk}>확인 필요만</button>}
      <button type="button" className="tbtn wide-only" title="명령 (⌘K)" onClick={onPalette}><kbd>⌘K</kbd></button>
    </header>
  );
}
