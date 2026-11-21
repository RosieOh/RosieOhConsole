import type { InfraDef } from './defaults.js';

// 인프라 이름 — 연관 관계에서 바꾼 이름 > 카탈로그 프로젝트 이름("Illinare 운영 서버") > 기본 이름
// short 는 좁은 표(대시보드 서버 자원)용: "운영 서버"·"(사내)" 를 뗀 것
const shorten = (n: string) => n.replace(/\s*운영 서버$/, '').replace(/\s*\(사내\)$/, '').trim() || n;

export function infraName(def: Pick<InfraDef, 'name' | 'of'>, renamed: string | undefined, projectName: (id: string) => string | undefined) {
  const proj = def.of && projectName(def.of.project);
  const name = renamed || (proj ? `${proj} ${def.of!.role ? def.of!.role + ' ' : ''}운영 서버` : def.name);
  return { name, short: shorten(name) };
}

// sub("IP · 도메인 · 설명 …") 에서 복사할 만한 것만 — IP·도메인
const IP = /^\d{1,3}(\.\d{1,3}){3}$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
export function addrOf(sub = '') {
  const parts = sub.split(', ').map((x) => x.trim()).filter(Boolean);
  const ip = parts.find((x) => IP.test(x)) ?? null;
  const domains = parts.filter((x) => !IP.test(x) && DOMAIN.test(x));
  const note = parts.filter((x) => x !== ip && !domains.includes(x)).join(', ');
  return { ip, domains, note };
}
