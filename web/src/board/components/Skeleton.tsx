/** 불러오는 동안 실제 모양과 같은 자리에 반짝이는 막대 */
export function Bar({ w = '100%', h = 11, round = 7 }: { w?: string | number; h?: number; round?: number }) {
  return <div className="skel" style={{ width: w, height: h, borderRadius: round }} aria-hidden="true" />;
}
export function SkeletonRows({ n = 4 }: { n?: number }) {
  return <>{Array.from({ length: n }, (_, i) => <li key={i} className="board-skel-row"><Bar w={`${50 + (i * 13) % 40}%`} /></li>)}</>;
}
export function SkeletonChips({ n = 4 }: { n?: number }) {
  return <>{Array.from({ length: n }, (_, i) => <Bar key={i} w={80 + (i * 17) % 50} h={26} round={999} />)}</>;
}
