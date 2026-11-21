// 러너별 작업 집계 — 저장소별 최근 실행의 작업 목록에서
export interface JobLite {
  id: number; repo: string; name: string; status: string; conclusion: string | null; runner: string | null; labels: string[];
  created: string | null; started: string | null; completed: string | null; url: string;
}
export interface RunnerStats { count24h: number; success24h: number; failure24h: number; avgSec24h: number | null; lastAt: string | null; lastJob: JobLite | null; active: JobLite[] }

const t = (s: string | null) => (s ? Date.parse(s) : NaN);
const ACTIVE = new Set(['in_progress', 'running']);

/** GitHub 작업 하나 → 가벼운 모양. repo 는 html_url 에서 */
export function toJob(j: any): JobLite {
  const m = /\/([^/]+)\/([^/]+)\/actions\/runs\//.exec(String(j.html_url || ''));
  return {
    id: j.id, repo: m ? m[2] : '', name: String(j.name || ''), status: String(j.status || ''), conclusion: j.conclusion || null,
    runner: j.runner_name || null, labels: (j.labels || []).map(String),
    created: j.created_at || null, started: j.started_at || null, completed: j.completed_at || null, url: String(j.html_url || ''),
  };
}

export function statsFor(name: string, jobs: JobLite[], now = Date.now(), norm = (s: string) => s): RunnerStats {
  const mine = jobs.filter((j) => j.runner && norm(j.runner) === norm(name));
  const day = mine.filter((j) => j.status === 'completed' && j.conclusion !== 'skipped' && now - t(j.completed ?? j.started) < 24 * 3600e3);
  const durs = day.map((j) => (t(j.completed) - t(j.started)) / 1000).filter((d) => Number.isFinite(d) && d >= 0);
  const done = mine.filter((j) => j.status === 'completed' && j.started).sort((a, b) => t(b.started) - t(a.started));
  return {
    count24h: day.length,
    success24h: day.filter((j) => j.conclusion === 'success').length,
    failure24h: day.filter((j) => j.conclusion === 'failure').length,
    avgSec24h: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null,
    lastAt: done[0]?.completed ?? done[0]?.started ?? null,
    lastJob: done[0] ?? null,
    active: mine.filter((j) => ACTIVE.has(j.status)),
  };
}

/** 대기열 — 러너를 아직 못 받은 작업. 가장 오래 기다린 시간 */
export function queueOf(jobs: JobLite[], now = Date.now()) {
  const q = jobs.filter((j) => j.status === 'waiting' || j.status === 'queued' || j.status === 'blocked');
  const oldest = q.reduce<number | null>((m, j) => { const c = t(j.created); return Number.isFinite(c) && (m === null || c < m) ? c : m; }, null);
  return { count: q.length, oldestSec: oldest === null ? null : Math.round((now - oldest) / 1000), jobs: q };
}

// ── 가동률 — 상태가 바뀐 순간만 남긴다(최근 7일) ──
export type History = Record<string, { at: number; online: boolean }[]>;
export const WEEK = 7 * 24 * 3600e3;

export function record(h: History, name: string, online: boolean, now = Date.now()): boolean {
  const list = (h[name] ||= []);
  const last = list[list.length - 1];
  let changed = false;
  if (!last || last.online !== online) { list.push({ at: now, online }); changed = true; }
  // 7일보다 오래된 변화는 버리되, 창 시작 시점의 상태를 알 수 있게 직전 하나는 남긴다
  while (list.length > 1 && list[1].at < now - WEEK) { list.shift(); changed = true; }
  return changed;
}

/** 관찰한 기간 중 온라인 비율(0~1). 기록이 없으면 null */
export function uptime(list: { at: number; online: boolean }[] | undefined, now = Date.now()): { ratio: number; since: number } | null {
  if (!list?.length) return null;
  const start = Math.max(list[0].at, now - WEEK);
  let on = 0;
  for (let i = 0; i < list.length; i++) {
    const a = Math.max(list[i].at, start);
    const b = i + 1 < list.length ? list[i + 1].at : now;
    if (b > a && list[i].online) on += b - a;
  }
  const total = now - start;
  return total > 0 ? { ratio: on / total, since: start } : { ratio: list[list.length - 1].online ? 1 : 0, since: start };
}
