import { logoUrl } from '../api';

// 서비스 로고 — 없으면 이름 첫 글자를 색 원으로(이름이 같으면 색도 같다)
// 바다 팔레트에 맞춘 8색 — 서비스 구분은 되되 콘솔에서 혼자 튀지 않게 채도를 낮췄다
const PALETTE = ['#3a8fb5', '#2f9c8f', '#5f7fc0', '#7d74b8', '#3f9b6b', '#a3708c', '#5a97b8', '#b08a5a'];
const hue = (s: string) => PALETTE[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

export function Logo({ file, name, size = 22, round = false }: { file?: string | null; name: string; size?: number; round?: boolean }) {
  const r = round ? '50%' : Math.max(4, Math.round(size / 4.5));
  if (file) return <img src={logoUrl(file)} alt="" width={size} height={size} style={{ borderRadius: r, objectFit: 'contain', flexShrink: 0, background: 'var(--panel-2)', border: '1px solid var(--border)' }} />;
  const ch = [...name][0] ?? '?';
  return (
    <span style={{ width: size, height: size, borderRadius: r, background: hue(name), color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.5), fontWeight: 700, flexShrink: 0 }}>{ch}</span>
  );
}
