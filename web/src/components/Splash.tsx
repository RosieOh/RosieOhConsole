/** 콘솔이 뜨는 동안(로그인 확인 중) 보이는 로고 — favicon 과 같은 모양: 고리가 그려지고 점이 튀어나온다 */
export function Splash() {
  return (
    <div className="splash" role="status" aria-label="Rosie 콘솔을 여는 중">
      <svg className="splash-mark" width="88" height="88" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <circle className="splash-ring" cx="14" cy="18" r="9.5" stroke="#E0435A" strokeWidth="5" pathLength={100} />
        <circle className="splash-dot" cx="26" cy="6" r="4" fill="#E0435A" />
      </svg>
      <span className="splash-name">Rosie 콘솔</span>
    </div>
  );
}
