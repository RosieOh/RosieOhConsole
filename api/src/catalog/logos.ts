import { createHash } from 'node:crypto';

// 로고 — 저장소에서 후보 고르기 · 올린 파일 검사 · SVG 정리. 파일 이름은 내용 해시라 같은 그림은 한 번만 저장된다.
export const LOGO_MAX = 1024 * 1024;
export const LOGO_FILE_RE = /^[0-9a-f]{16}\.(png|svg|webp)$/;
export type LogoExt = 'png' | 'svg' | 'webp';
export const LOGO_TYPES: Record<LogoExt, string> = { png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp' };

const SKIP = /(^|\/)(node_modules|build|dist|Pods|\.gradle|\.git|vendor|coverage|\.next|out)\//;
const THIRD_PARTY = /(google|kakao|naver|apple|facebook|github|hufs|snu|yonsei|korea)/i;

/** 후보 점수 — 높을수록 그 저장소의 "얼굴". 0 이하는 후보가 아니다 */
export function logoScore(path: string): number {
  const p = path.toLowerCase();
  if (SKIP.test(path) || !/\.(png|svg|webp)$/.test(p)) return 0;
  const file = p.split('/').pop()!;
  let s = 0;
  if (/^ic_launcher(_round)?\.(png|webp)$/.test(file) && p.includes('mipmap')) {
    s = 100 - (file.includes('round') ? 5 : 0);
    s -= p.includes('xxxhdpi') ? 0 : p.includes('xxhdpi') ? 6 : p.includes('xhdpi') ? 12 : 20;
  } else if (/appicon\.appiconset\//.test(p)) s = /1024/.test(file) ? 95 : 55;
  else if (/^ic_launcher_foreground\./.test(file)) s = 60;
  else if (/logo/.test(file)) s = file.endsWith('.svg') ? 70 : 65;
  else if (/^(favicon|icon|apple-touch-icon)[^/]*\.(png|svg)$/.test(file)) s = 40;
  else return 0;
  if (/text_logo|splash|_k\.|white|black|mono/.test(file)) s -= 25;   // 글자 로고·변형은 뒤로
  if (THIRD_PARTY.test(file)) s -= 60;                                             // 로그인 버튼 등 남의 로고
  if (/drawable-(m|h)dpi|drawable-xhdpi/.test(p)) s -= 10;
  return s;
}

export function pickCandidates(paths: string[], max = 12): string[] {
  return paths.map((p) => [p, logoScore(p)] as const).filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).slice(0, max).map(([p]) => p);
}

/** 내용으로 형식 판단(확장자를 믿지 않는다) */
export function sniff(buf: Buffer): LogoExt | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  // 앞머리(<?xml?>, 주석, DOCTYPE)를 하나씩 걷어 내고 <svg 로 시작하는지 본다 — 반복이 겹친 정규식은 느린 입력에 약해(ReDoS) 쓰지 않는다
  let head = buf.toString('utf8', 0, Math.min(buf.length, 1024)).replace(/^\uFEFF/, '').trimStart();
  for (let i = 0; i < 20; i++) {
    if (head.startsWith('<?xml')) { const e = head.indexOf('?>'); if (e < 0) return null; head = head.slice(e + 2).trimStart(); continue; }
    if (head.startsWith('<!--')) { const e = head.indexOf('-->', 4); if (e < 0) return null; head = head.slice(e + 3).trimStart(); continue; }
    if (/^<!DOCTYPE svg/i.test(head)) { const e = head.indexOf('>'); if (e < 0) return null; head = head.slice(e + 1).trimStart(); continue; }
    break;
  }
  return /^<svg[\s>]/i.test(head) ? 'svg' : null;
}

const svgPass = (svg: string) => svg
  .replace(/<!DOCTYPE[^>[]*(\[[^\]]*\])?>/gi, '')
  .replace(/<script\b[\s\S]*?<\/script[^>]*>/gi, '').replace(/<script\b[^>]*>/gi, '')
  .replace(/<foreignObject\b[\s\S]*?<\/foreignObject[^>]*>/gi, '').replace(/<foreignObject\b[^>]*>/gi, '')
  .replace(/[\s/]on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ' ')
  .replace(/(href|xlink:href)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '$1="#"')
  .replace(/(href|xlink:href)\s*=\s*("\s*https?:[^"]*"|'\s*https?:[^']*')/gi, '$1="#"');   // 바깥 자원 불러오기 금지
/** 지우고 나서도 남아 있으면 안 되는 것 */
const SVG_DANGER = /<script|<foreignObject|[\s/]on[a-z]+\s*=|javascript:|<!ENTITY/i;

/** SVG 정리 — 그림으로만 쓰이게 스크립트·외부 개체·이벤트 속성·javascript: 링크를 지운다(내려줄 때 CSP sandbox 도 건다).
 *  지우면서 새로 이어 붙는 조각(예: <scr<script>ipt>)까지 없어질 때까지 되풀이하고, 그래도 남으면 거절한다 */
export function sanitizeSvg(svg: string): string {
  let out = svg;
  for (let i = 0; i < 10; i++) { const next = svgPass(out); if (next === out) break; out = next; }
  if (SVG_DANGER.test(out)) throw new Error('SVG 에 스크립트·이벤트 속성이 남아 있어 올릴 수 없습니다');
  return out;
}

/** 검사·정리한 로고와 저장할 파일 이름 */
export function prepareLogo(buf: Buffer): { file: string; body: Buffer; type: string } {
  if (!buf.length) throw new Error('빈 파일입니다');
  if (buf.length > LOGO_MAX) throw new Error('로고는 1MB 이하만 올릴 수 있습니다');
  const ext = sniff(buf);
  if (!ext) throw new Error('PNG, SVG, WEBP 만 올릴 수 있습니다');
  const body = ext === 'svg' ? Buffer.from(sanitizeSvg(buf.toString('utf8')), 'utf8') : buf;
  const file = `${createHash('sha256').update(body).digest('hex').slice(0, 16)}.${ext}`;
  return { file, body, type: LOGO_TYPES[ext] };
}
