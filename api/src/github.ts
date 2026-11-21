import { cfg } from './config.js';

// GitHub REST API — 읽기 토큰으로. 404 는 null.
export async function ghFetch(path: string, init: RequestInit = {}, token = cfg.githubToken, timeoutMs = 15000): Promise<Response> {
  return fetch(`${cfg.githubApi}/${path.replace(/^\//, '')}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers as any),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function ghJson<T = any>(path: string): Promise<T | null> {
  const res = await ghFetch(path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${path} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** 저장소 파일 원본(최대 max 바이트) */
export async function ghRaw(repo: string, path: string, ref: string, max: number): Promise<Buffer | null> {
  const enc = path.split('/').map(encodeURIComponent).join('/');
  const res = await ghFetch(`repos/${cfg.owner}/${repo}/contents/${enc}?ref=${encodeURIComponent(ref)}`, { headers: { Accept: 'application/vnd.github.raw' } }, cfg.githubToken, 20000);
  if (!res.ok) return null;
  const len = Number(res.headers.get('content-length') || 0);
  if (len > max) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > max ? null : buf;
}

/** 페이지 넘기기(배열 응답, 또는 { [key]: [...] } 응답이면 key 를 준다) */
export async function ghPaged<T = any>(path: string, perPage = 100, maxPages = 10, key?: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const j = await ghJson<any>(`${path}${sep}per_page=${perPage}&page=${page}`);
    const list: T[] = (key ? j?.[key] : j) || [];
    if (!list.length) break;
    out.push(...list);
    if (list.length < perPage) break;
  }
  return out;
}

/** 주인(cfg.owner)의 저장소 전체. 토큰 주인이 곧 owner 면 비공개 저장소까지 */
export async function ownerRepos(): Promise<any[]> {
  if (cfg.githubToken) {
    const me = await ghJson<any>('user').catch(() => null);
    if (me?.login?.toLowerCase() === cfg.owner.toLowerCase()) return ghPaged('user/repos?affiliation=owner&sort=updated');
  }
  return ghPaged(`users/${cfg.owner}/repos?type=owner&sort=updated`);
}
