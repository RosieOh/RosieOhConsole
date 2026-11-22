import { cfg, full } from './config.js';

/** GitHub API 주소 — path 가 API 밖(다른 호스트·'..' 로 거슬러 오르기)으로 나가면 거절한다. 토큰이 붙어 나가는 길이라서 */
export function ghUrl(path: string): URL {
  const base = new URL(cfg.githubApi.replace(/\/?$/, '/'));
  const rel = path.replace(/^\/+/, '');
  const segs = rel.split(/[?#]/)[0].split('/');
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel) || segs.some((s) => /^(\.|%2e){1,2}$/i.test(s))) throw new Error(`GitHub API 경로가 올바르지 않습니다: ${rel.slice(0, 80)}`);
  const url = new URL(rel, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('GitHub API 밖으로 나가는 경로입니다');
  return url;
}

// GitHub REST API — 읽기 토큰으로. 404 는 null.
export async function ghFetch(path: string, init: RequestInit = {}, token = cfg.githubToken, timeoutMs = 15000): Promise<Response> {
  return fetch(ghUrl(path), {
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
  const res = await ghFetch(`repos/${full(repo)}/contents/${enc}?ref=${encodeURIComponent(ref)}`, { headers: { Accept: 'application/vnd.github.raw' } }, cfg.githubToken, 20000);
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

/** 주인(GITHUB_OWNER)의 저장소. 토큰 주인이 곧 owner 면 비공개 저장소까지 */
async function userRepos(): Promise<any[]> {
  if (cfg.githubToken) {
    const me = await ghJson<any>('user').catch(() => null);
    if (me?.login?.toLowerCase() === cfg.owner.toLowerCase()) return ghPaged('user/repos?affiliation=owner&sort=updated');
  }
  return ghPaged(`users/${cfg.owner}/repos?type=owner&sort=updated`);
}

/**
 * 주인 저장소 + 조직(GITHUB_ORGS) 저장소. 조직 저장소는 name 을 '<조직>/<저장소>' 로 바꿔 돌려준다 —
 * 콘솔 안에서 저장소 이름은 늘 이 모양이고, API 경로는 full() 로 만든다. 조직을 못 읽으면 그 조직만 빠진다
 */
export async function ownerRepos(): Promise<any[]> {
  const [mine, ...orgs] = await Promise.all([
    userRepos(),
    ...cfg.orgs.map((org) => ghPaged(`orgs/${org}/repos?type=all&sort=updated`)
      .then((list) => list.map((r: any) => ({ ...r, name: `${org}/${r.name}` })))
      .catch((e) => { console.warn(`[GitHub] 조직 ${org} 저장소를 읽지 못했다:`, e?.message); return [] as any[]; })),
  ]);
  return [...mine, ...orgs.flat()];
}

/** GraphQL — 오류가 있으면 첫 메시지로 던진다 */
export async function ghGraphql<T = any>(query: string, variables: Record<string, unknown>, token = cfg.githubToken): Promise<T> {
  const res = await ghFetch('graphql', { method: 'POST', body: JSON.stringify({ query, variables }) }, token, 30000);
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || j.errors?.length) throw new Error(`GitHub GraphQL → ${j.errors?.[0]?.message || `HTTP ${res.status}`}`);
  return j.data as T;
}
