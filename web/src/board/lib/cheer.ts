import confetti from 'canvas-confetti';
import { colorOf } from './stages';

/** 축하할 단계 — 완료와 운영 반영. 그 외에는 아무것도 하지 않는다 */
export const CHEERS = new Set(['done', 'deployed']);

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * 종이꽃은 캔버스에 그린다. jsdom 에는 2D 맥락이 없어서 getContext 가 null 을
 * 주는데, canvas-confetti 는 그걸 확인하지 않고 다음 프레임에 clearRect 를
 * 부른다 — 테스트가 끝난 뒤에 터지는 잡히지 않는 예외가 된다(#154).
 * 그릴 수 없는 곳에서는 아예 쏘지 않는다. 한 번만 재 보고 기억한다.
 */
let paintable: boolean | null = null;
function canPaint() {
  if (paintable === null) {
    try { paintable = !!document.createElement('canvas').getContext('2d'); }
    catch { paintable = false; }
  }
  return paintable;
}
const read = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
/** 칸이 가로로 밀려 화면 밖이면 거기서 터져 봐야 안 보인다. 가장자리 안으로 당긴다. */
const clamp = (v: number) => Math.min(0.94, Math.max(0.06, v));
const at01 = (at: { x: number; y: number }) =>
  ({ x: clamp(at.x / window.innerWidth), y: clamp(at.y / window.innerHeight) });

/**
 * 충격파 — 터진 자리에서 빛 고리가 한 번 퍼진다(#148).
 * 종이꽃만으로는 '많다' 는 느낌뿐이라 사건이 일어난 자리가 안 읽힌다. 고리가
 * 자리를 찍어 준다. body 에 붙였다 스스로 지운다 — React 가 다시 그려도 안 끊긴다.
 */
export function shockwave(at: { x: number; y: number }, color: string, size = 620) {
  if (reduced()) return;
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', left: `${at.x}px`, top: `${at.y}px`, width: '8px', height: '8px',
    marginLeft: '-4px', marginTop: '-4px', borderRadius: '50%', pointerEvents: 'none',
    zIndex: '9998', background: `radial-gradient(circle, ${color}00 54%, ${color}66 70%, ${color}00 78%)`,
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  if (typeof el.animate !== 'function') { el.remove(); return; }
  const a = el.animate([
    { transform: 'scale(1)', opacity: 0.95 },
    { transform: `scale(${size / 8})`, opacity: 0 },
  ], { duration: 900, easing: 'cubic-bezier(.12,.72,.24,1)' });
  a.onfinish = () => el.remove();
  a.oncancel = () => el.remove();
}

/**
 * 양쪽 바닥에서 안쪽으로 쏘는 대포 — 큰 자리에서만 쓴다.
 * 가운데 한 점에서만 터지면 아무리 양을 늘려도 '한 번 펑' 이다. 양옆에서
 * 들어와야 화면이 축제가 된다.
 */
function cannons(colors: string[], shots = 3) {
  for (let i = 0; i < shots; i++) {
    setTimeout(() => {
      const common = { colors, zIndex: 9999, disableForReducedMotion: true, ticks: 220, scalar: 1 } as const;
      confetti({ ...common, particleCount: 46, angle: 58, spread: 62, startVelocity: 52, origin: { x: 0.02, y: 0.96 } });
      confetti({ ...common, particleCount: 46, angle: 122, spread: 62, startVelocity: 52, origin: { x: 0.98, y: 0.96 } });
    }, i * 220);
  }
}

/** 하늘에서 천천히 내리는 반짝이 — 터진 뒤 남는 여운 */
function glitter(colors: string[], ms = 1400) {
  // setTimeout 으로 불리므로 테스트가 끝난 뒤에 돌 수 있다 — 프레임이 없으면 그만둔다
  if (typeof requestAnimationFrame !== 'function') return;
  const end = Date.now() + ms;
  const tick = () => {
    confetti({
      colors, zIndex: 9999, disableForReducedMotion: true,
      particleCount: 5, startVelocity: 0, ticks: 280, gravity: 0.42, decay: 0.95, scalar: 0.62,
      origin: { x: Math.random(), y: -0.05 },
    });
    if (Date.now() < end) requestAnimationFrame(tick);
  };
  tick();
}

/**
 * 카드가 완료·운영 반영 칸에 내려앉을 때(#148).
 * 그 자리에서 빛 고리가 퍼지고 종이꽃이 세 겹으로 터진 뒤, 양쪽 바닥 대포가
 * 받고, 반짝이가 한동안 내린다. 한 칸을 다 옮긴 일이니 거창해도 된다.
 */
export function cheer(stage: string, at: { x: number; y: number }) {
  if (!CHEERS.has(stage)) return;
  if (reduced() || !canPaint()) return;
  const origin = at01(at);
  // 단계 색을 앞세우고 바다 쪽 색을 섞는다. CSS 변수는 confetti 가 못 읽으니 값으로.
  const c = colorOf(stage);
  const colors = [c, read('--accent') || '#4fd8ff', read('--green') || '#3df5b0',
    read('--violet') || '#b78cff', '#ffffff'].filter(Boolean);
  const common = { origin, colors, zIndex: 9999, disableForReducedMotion: true } as const;
  shockwave(at, c);
  confetti({ ...common, particleCount: 150, spread: 92, startVelocity: 46, ticks: 220, scalar: 1 });
  setTimeout(() => confetti({ ...common, particleCount: 60, spread: 120, startVelocity: 30, ticks: 190, scalar: 0.85, shapes: ['star'] }), 130);
  setTimeout(() => confetti({ ...common, particleCount: 70, spread: 165, startVelocity: 22, ticks: 170, scalar: 0.7, gravity: 0.8 }), 300);
  cannons(colors, 2);
  setTimeout(() => glitter(colors, 1200), 420);
}

/**
 * 시트에 반영됐을 때(#148) — 주간보고의 '시트에 반영'과 '전체 반영'이 같이 쓴다.
 * strong(전체 반영)은 한 주치를 한꺼번에 넘기는 일이라 제일 크게 간다 —
 * 고리, 세 겹 폭죽, 양쪽 대포, 하늘을 가로지르는 연속 폭죽, 반짝이 비.
 */
export function reflected(at: { x: number; y: number }, strong = false) {
  if (reduced() || !canPaint()) return;
  const origin = at01(at);
  const g = read('--green') || '#3df5b0';
  const colors = [g, read('--accent') || '#4fd8ff', '#9bf5d0', '#ffffff'];
  const common = { origin, colors, zIndex: 9999, disableForReducedMotion: true } as const;
  shockwave(at, g, strong ? 900 : 520);
  confetti({ ...common, particleCount: strong ? 140 : 60, spread: strong ? 96 : 72,
    startVelocity: strong ? 44 : 30, ticks: strong ? 220 : 170, scalar: strong ? 1 : 0.85 });
  if (!strong) {
    setTimeout(() => confetti({ ...common, particleCount: 34, spread: 130, startVelocity: 20, ticks: 150, scalar: 0.65 }), 160);
    return;
  }
  setTimeout(() => confetti({ ...common, particleCount: 70, spread: 130, startVelocity: 28, ticks: 190, scalar: 0.8, shapes: ['star'] }), 140);
  setTimeout(() => confetti({ ...common, particleCount: 60, spread: 170, startVelocity: 20, ticks: 170, scalar: 0.7, gravity: 0.78 }), 320);
  cannons(colors, 3);
  // 하늘을 가로지르는 연속 폭죽 — 왼쪽에서 오른쪽으로 네 번
  for (let i = 0; i < 4; i++) {
    setTimeout(() => confetti({
      colors, zIndex: 9999, disableForReducedMotion: true,
      particleCount: 42, spread: 360, startVelocity: 26, ticks: 200, scalar: 0.8,
      origin: { x: 0.18 + i * 0.22, y: 0.22 + (i % 2) * 0.12 },
    }), 420 + i * 190);
  }
  setTimeout(() => glitter(colors, 1800), 600);
}

/**
 * 반영된 카드가 초록으로 한 번 피었다 진다. React 가 다시 그려도 안 끊기게
 * className 이 아니라 Web Animations 로 건다. delay 로 줄줄이 번지게 할 수 있다.
 */
export function bloom(el: Element, delay = 0) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  // jsdom 에는 Web Animations 가 없다 — 테스트에서 터지지 않게 막는다
  if (typeof (el as HTMLElement).animate !== 'function') return;
  const g = getComputedStyle(document.documentElement).getPropertyValue('--green').trim() || '#3df5b0';
  (el as HTMLElement).animate([
    { boxShadow: `0 0 0 0 ${g}00`, transform: 'scale(1)' },
    { boxShadow: `0 0 0 5px ${g}88, 0 0 48px -2px ${g}cc`, transform: 'scale(1.028)', offset: 0.26 },
    { boxShadow: `0 0 0 16px ${g}00, 0 0 56px -6px ${g}00`, transform: 'scale(1)' },
  ], { duration: 1300, delay, easing: 'cubic-bezier(.22,1,.36,1)' });
}
