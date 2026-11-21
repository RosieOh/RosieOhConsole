import { orbBackground } from '../lib/format';

/**
 * 담당자 오브 — 이니셜 없이 아이디마다 정해진 그라데이션.
 * 구슬처럼 읽히게 셋을 얹는다(#148): 왼쪽 위에 맺히는 광, 아래로 가라앉는
 * 그늘(terminator), 바닥에 떨어지는 작은 그림자. 평면 원이 아니라 구가 된다.
 */
export function Avatar({ login, size = 20, ring = 'transparent' }: { login?: string | null; size?: number; ring?: string }) {
  if (!login) {
    return <span className="board-orb board-orb-none" style={{ width: size, height: size }} title="담당 없음" />;
  }
  return (
    <span role="img" aria-label={login} title={login} className="board-orb"
      style={{ width: size, height: size, background: orbBackground(login), ['--ring' as string]: ring }} />
  );
}
