/* 합성 디스코 — disco.mp3 를 못 받거나 자동재생이 막혔을 때의 대비.
   120BPM, 4비트 킥 · 2·4박 박수 · 엇박 오픈 하이햇 · 옥타브 베이스. */
const BPM = 120, BEAT = 60 / BPM;
const hz = (s: number) => 440 * Math.pow(2, s / 12);

export function playSynthDisco(durationMs = 10000): () => void {
  const AC: typeof AudioContext | undefined =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return () => {};
  const ctx = new AC();
  const t0 = ctx.currentTime + 0.06, end = t0 + durationMs / 1000;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(0.22, t0 + 0.3);
  master.gain.setValueAtTime(0.22, end - 0.9);
  master.gain.linearRampToValueAtTime(0, end - 0.05);
  master.connect(ctx.destination);

  const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const kick = (at: number) => {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(165, at);
    o.frequency.exponentialRampToValueAtTime(45, at + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
    o.connect(g); g.connect(master); o.start(at); o.stop(at + 0.28);
  };
  const hat = (at: number, open: boolean) => {
    const s = ctx.createBufferSource(); s.buffer = nb;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 8200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(open ? 0.28 : 0.13, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + (open ? 0.22 : 0.05));
    s.connect(hp); hp.connect(g); g.connect(master); s.start(at); s.stop(at + 0.3);
  };
  const clap = (at: number) => {
    for (const [d, v] of [[0, 0.5], [0.011, 0.8], [0.023, 1]] as const) {
      const s = ctx.createBufferSource(); s.buffer = nb;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.4 * v, at + d);
      g.gain.exponentialRampToValueAtTime(0.0001, at + d + 0.13);
      s.connect(bp); bp.connect(g); g.connect(master); s.start(at + d); s.stop(at + d + 0.16);
    }
  };
  const bass = (at: number, semi: number) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(semi);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(900, at);
    lp.frequency.exponentialRampToValueAtTime(260, at + BEAT * 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.4, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + BEAT * 0.46);
    o.connect(lp); lp.connect(g); g.connect(master); o.start(at); o.stop(at + BEAT * 0.5);
  };

  const roots = [0, -4, -9, -2];
  for (let bar = 0; bar < Math.ceil(durationMs / 1000 / (BEAT * 4)) + 1; bar++) {
    const r = roots[bar % roots.length];
    for (let b = 0; b < 4; b++) {
      const at = t0 + (bar * 4 + b) * BEAT;
      if (at > end) break;
      kick(at); hat(at, false); hat(at + BEAT * 0.5, true);
      if (b === 1 || b === 3) clap(at);
      bass(at, r - 12); bass(at + BEAT * 0.5, r);
    }
  }

  let stopped = false;
  const stop = () => {
    if (stopped) return; stopped = true;
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.18);
      window.setTimeout(() => void ctx.close(), 400);
    } catch { /* 이미 닫혔으면 그만 */ }
  };
  window.setTimeout(stop, durationMs + 300);
  return stop;
}
