/** 사이드바·버튼용 선 아이콘 — 16px 격자, currentColor */
const paths = {
  all: <><path d="M3 5.5 8 3l5 2.5-5 2.5z" /><path d="m3 8.5 5 2.5 5-2.5" /><path d="m3 11.5 5 2.5 5-2.5" /></>,
  mine: <><circle cx="8" cy="5.5" r="2.5" /><path d="M3.5 13.5c.8-2.4 2.5-3.5 4.5-3.5s3.7 1.1 4.5 3.5" /></>,
  risk: <><path d="M8 2.5 14 13H2z" /><path d="M8 6.5v3" /><path d="M8 11.4v.1" /></>,
  people: <><circle cx="6" cy="5.5" r="2.2" /><path d="M2 13c.6-2 2-3 4-3s3.4 1 4 3" /><circle cx="11.3" cy="6" r="1.8" /><path d="M11 10c1.6 0 2.6.9 3 2.5" /></>,
  repo: <><path d="M3.5 3.5a1 1 0 0 1 1-1h8v10h-8a1 1 0 0 0-1 1z" /><path d="M3.5 13.5a1 1 0 0 1 1-1h8v2h-8a1 1 0 0 1-1-1z" /><path d="M6 5.5h4" /></>,
  gear: <><circle cx="8" cy="8" r="2" /><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2" /></>,
  unlinked: <><path d="M6.5 9.5 5 11a2.1 2.1 0 0 1-3-3l1.5-1.5" /><path d="M9.5 6.5 11 5a2.1 2.1 0 0 1 3 3l-1.5 1.5" /><path d="M6 3v1.5M3 6h1.5M10 13v-1.5M13 10h-1.5" /></>,
  shield: <><path d="M8 2 13 4v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" /><path d="m6 8 1.5 1.5L10.5 6.5" /></>,
  search: <><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></>,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  chev: <path d="m4 6.5 4 4 4-4" />,
};
export type IconName = keyof typeof paths;

/** 크기는 className(Tailwind) 이 아니라 속성으로 받는다 — 보드가 유틸을 떼면서(#148) */
export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
  );
}

export function Logo() {
  return (
    <span className="board-logo">
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" style={{ stroke: 'var(--accent)' }} strokeWidth="1.8" /><path d="M8 2a6 6 0 0 1 6 6H8z" style={{ fill: 'var(--accent)' }} />
      </svg>
    </span>
  );
}
