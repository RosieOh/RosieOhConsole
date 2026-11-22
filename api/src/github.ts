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

// ── 조건부 요청(ETag) — 바뀐 게 없으면 GitHub 이 304 로 답하고, 304 는 시간당 한도(5000)에서 빠진다.
// 같은 주소를 되풀이해 묻는 곳(배포 흐름·러너·저장소 목록)이 대부분 304 가 되어 한도를 거의 쓰지 않는다.
type Cached = { etag: string; body: ArrayBuffer; status: number; headers: [string, string][] };
const ETAG_MAX = 500;                  // 주소 개수
const ETAG_BODY_MAX = 1024 * 1024;     // 이보다 큰 응답은 담지 않는다
const etags = new Map<string, Cached>();
const KEEP_HEADERS = ['content-type', 'link', 'etag'];

// ── 사용량 — 10분마다 한 줄로 남긴다(어디서 한도를 많이 쓰는지 보이게) ──
const STATS_MS = 10 * 60 * 1000;
const stats = { calls: 0, notModified: 0, byPath: new Map<string, number>(), remaining: null as number | null, reset: 0, warned: false };
/** 'repos/a/b/actions/runs/123/jobs?x' → 'repos/:repo/actions/runs/:n/jobs' */
const pathKind = (path: string) => path.replace(/^\/+/, '').split('?')[0].replace(/^repos\/[^/]+\/[^/]+/, 'repos/:repo').replace(/^(orgs|users)\/[^/]+/, '$1/:name').replace(/\/\d+(?=\/|$)/g, '/:n');
export function ghStats() {
  return { calls: stats.calls, notModified: stats.notModified, remaining: stats.remaining, reset: stats.reset ? new Date(stats.reset * 1000).toISOString() : null,
    top: [...stats.byPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5) };
}
setInterval(() => {
  if (!stats.calls) return;
  const s = ghStats();
  console.log(`[GitHub] 10분 호출 ${s.calls}번(그중 304 ${s.notModified}번은 한도에서 빠짐), 남은 한도 ${s.remaining ?? '?'} · 많이 부른 곳 ${s.top.map(([k, n]) => `${k} ${n}`).join(', ')}`);
  stats.calls = 0; stats.notModified = 0; stats.byPath.clear();
}, STATS_MS).unref?.();

function note(path: string, res: Response) {
  stats.calls++;
  if (res.status === 304) stats.notModified++;
  else stats.byPath.set(pathKind(path), (stats.byPath.get(pathKind(path)) || 0) + 1);   // 304 는 공짜라 '많이 부른 곳'에서 뺀다
  const left = Number(res.headers.get('x-ratelimit-remaining'));
  if (res.headers.has('x-ratelimit-remaining') && Number.isFinite(left)) {
    stats.remaining = left; stats.reset = Number(res.headers.get('x-ratelimit-reset')) || 0;
    if (left < 500 && !stats.warned) { stats.warned = true; console.warn(`[GitHub] 시간당 한도가 ${left} 남았습니다 — 많이 부른 곳: ${ghStats().top.map(([k, n]) => `${k} ${n}`).join(', ')}`); }
    if (left > 1000) stats.warned = false;
  }
}

// GitHub REST API — 읽기 토큰으로. 404 는 null. 본문 없는 GET 은 ETag 로 조건부 요청을 한다
export async function ghFetch(path: string, init: RequestInit = {}, token = cfg.githubToken, timeoutMs = 15000): Promise<Response> {
  const url = ghUrl(path);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as any),
  };
  const cacheable = (init.method ?? 'GET').toUpperCase() === 'GET' && !init.body;
  // 토큰마다 보이는 것이 다르다 — 토큰 끝 6자로 나눈다(토큰 전체는 담지 않는다)
  const key = cacheable ? `${token ? token.slice(-6) : '-'} ${headers.Accept} ${url.href}` : '';
  const hit = cacheable ? etags.get(key) : undefined;
  if (hit) headers['If-None-Match'] = hit.etag;

  // 주소는 fetch 안에서 ghUrl 로 바로 만든다 — 변수에 담아 넘기면 CodeQL 이 ghUrl 의 검사(API 밖 거절)를 따라가지 못해 SSRF 로 본다
  const res = await fetch(ghUrl(path), { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
  note(path, res);
  if (!cacheable) return res;
  if (res.status === 304 && hit) {
    etags.delete(key); etags.set(key, hit);   // 최근에 쓴 것을 뒤로(오래 안 쓴 것부터 버린다)
    return new Response(hit.body.slice(0), { status: hit.status, headers: hit.headers });
  }
  const etag = res.headers.get('etag');
  const len = Number(res.headers.get('content-length') || 0);
  if (res.ok && etag && !res.redirected && len <= ETAG_BODY_MAX) {
    const body = await res.arrayBuffer();
    if (body.byteLength <= ETAG_BODY_MAX) {
      const kept = KEEP_HEADERS.flatMap((h) => { const v = res.headers.get(h); return v ? [[h, v] as [string, string]] : []; });
      etags.delete(key);
      etags.set(key, { etag, body, status: res.status, headers: kept });
      while (etags.size > ETAG_MAX) etags.delete(etags.keys().next().value!);
    }
    return new Response(body.slice(0), { status: res.status, headers: res.headers });
  }
  return res;
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
let reposCache: { at: number; list: any[] } | null = null;
let reposInflight: Promise<any[]> | null = null;
const REPOS_TTL = 2 * 60 * 1000;
/** 저장소 목록은 여러 화면·작업이 같이 쓴다 — 2분 동안 담아 두고, 동시에 들어온 요청은 한 번만 부른다 */
export async function ownerRepos(): Promise<any[]> {
  if (reposCache && Date.now() - reposCache.at < REPOS_TTL) return reposCache.list;
  reposInflight ??= loadOwnerRepos().then((list) => { reposCache = { at: Date.now(), list }; return list; }).finally(() => { reposInflight = null; });
  return reposInflight;
}
/** 시험·저장소를 막 만든 뒤 — 다음 ownerRepos() 가 새로 읽게 */
export function forgetOwnerRepos() { reposCache = null; }

async function loadOwnerRepos(): Promise<any[]> {
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
