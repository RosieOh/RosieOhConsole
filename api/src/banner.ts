// 시작할 때 터미널에 찍는 로고 — favicon.svg 의 모양(32×32: 고리 중심 14,18 반지름 9.5 굵기 5, 점 중심 26,6 반지름 4)을
// 반 칸 문자(▀▄█)로 그려 옆에 콘솔 정보를 붙인다. 색은 브랜드 빨강(#E0435A), 터미널이 아니거나 NO_COLOR 면 색 없이.

const COLS = 22, ROWS = 20;   // 문자 열 수, 픽셀 행 수(2행 = 문자 1줄)

function pixel(cx: number, cy: number) {
  const x = (cx + 0.5) * (32 / COLS), y = (cy + 0.5) * (32 / ROWS);
  return Math.abs(Math.hypot(x - 14, y - 18) - 9.5) <= 2.6 || Math.hypot(x - 26, y - 6) <= 4.1;
}

/** 로고 줄들(색 없음) */
export function logoLines(): string[] {
  const out: string[] = [];
  for (let y = 0; y < ROWS; y += 2) {
    let s = '';
    for (let x = 0; x < COLS; x++) {
      const a = pixel(x, y), b = pixel(x, y + 1);
      s += a && b ? '█' : a ? '▀' : b ? '▄' : ' ';
    }
    out.push(s);
  }
  return out;
}

/** 로고 + 오른쪽 정보 줄. info 는 위에서부터 붙는다(로고 2번째 줄부터) */
export function banner(info: string[], color = !!process.stdout.isTTY && !process.env.NO_COLOR) {
  const red = (s: string) => (color ? `\x1b[38;2;224;67;90m${s}\x1b[0m` : s);
  const bold = (s: string) => (color ? `\x1b[1m${s}\x1b[0m` : s);
  const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[0m` : s);
  const logo = logoLines();
  const start = 3;
  return '\n' + logo.map((l, i) => {
    const k = i - start;
    const text = k === 0 ? bold(info[0] ?? '') : k > 0 && info[k] ? dim(info[k]) : '';
    return `  ${red(l)}   ${text}`.trimEnd();
  }).join('\n') + '\n';
}
