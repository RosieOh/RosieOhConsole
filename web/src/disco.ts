/* 디스코 모드 BGM — public/disco.mp3 를 효과 시작부터 끝까지만 재생한다.
   (원본: '26. Stadium Rave.mp3' 에서 가장 센 10초 구간을 잘라 넣음)
   파일을 못 받으면 Web Audio 로 합성한 디스코로 떨어진다 — 소리가 아예 없는 것보다 낫다. */

export function playDisco(durationMs = 10000): () => void {
  const el = new Audio('/disco.mp3');
  el.volume = 0;
  el.preload = 'auto';

  let stopped = false;
  let fallbackStop: (() => void) | null = null;
  let fadeTimer = 0;

  /** 0 → target 또는 현재 → 0 으로 부드럽게. 뚝 끊기면 놀란다. */
  const fade = (to: number, ms: number, done?: () => void) => {
    window.clearInterval(fadeTimer);
    const from = el.volume;
    const t0 = performance.now();
    fadeTimer = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k >= 1) { window.clearInterval(fadeTimer); done?.(); }
    }, 25);
  };

  el.play().then(() => {
    fade(0.55, 300);
  }).catch(() => {
    // 자동재생이 막혔거나 파일이 없을 때 — 합성 디스코로
    if (stopped) return;
    import('./discoSynth').then(({ playSynthDisco }) => {
      if (!stopped) fallbackStop = playSynthDisco(durationMs);
    });
  });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    fallbackStop?.();
    fade(0, 220, () => { el.pause(); el.currentTime = 0; });
  };

  // 효과가 끝나는 순간 같이 끝낸다 — 0.5초 먼저 줄이기 시작해서 겹치게
  window.setTimeout(() => { if (!stopped) fade(0, 500); }, Math.max(0, durationMs - 500));
  window.setTimeout(stop, durationMs + 60);
  return stop;
}
