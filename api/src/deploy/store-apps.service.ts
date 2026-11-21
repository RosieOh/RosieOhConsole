import { Injectable } from '@nestjs/common';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { CatalogService } from '../catalog/catalog.service.js';
import { cfg, repoUrl as urlOf, full } from '../config.js';
import { ghJson } from '../github.js';
import { StoreLane, latestStoreTag, readStoreLane } from './store-lane.js';

// 스토어 앱(부모·보호자앱) — main 머지로 도는 릴리스 워크플로의 실행 기록과 store/<버전> 태그
export interface StoreRun {
  id: number; number: number; url: string; at: string; actor: string; event: string; sha: string; title: string;
  state: string; lane: StoreLane | null; runner: string | null;
}
export interface StoreAppView {
  key: string; repo: string; repoUrl: string; workflow: string;
  storeVersion: string | null; storeTagUrl: string | null; storeAt: string | null;
  lastStore: StoreRun | null; lastOta: StoreRun | null; last: StoreRun | null; running: StoreRun[]; history: StoreRun[];
  error?: string;
}

const TTL = 30 * 1000;
const RUNS = 15;

@Injectable()
export class StoreAppsService {
  private lanes = new Map<string, { lane: StoreLane; runner: string | null }>();
  private loaded = false;
  private saveTimer?: NodeJS.Timeout;
  private snap: { at: number; list: StoreAppView[] } | null = null;
  private inflight: Promise<StoreAppView[]> | null = null;

  constructor(private readonly catalog: CatalogService) {}

  private get file() { return `${cfg.dataDir}/store-readings.json`; }
  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try { for (const [k, v] of Object.entries(JSON.parse(await readFile(this.file, 'utf8')))) this.lanes.set(k, v as any); } catch { /* 처음 */ }
  }
  private save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      try {
        await mkdir(cfg.dataDir, { recursive: true });
        await writeFile(this.file + '.tmp', JSON.stringify(Object.fromEntries(this.lanes)), 'utf8');
        await rename(this.file + '.tmp', this.file);
      } catch (e: any) { console.warn('[스토어 앱] 기록 캐시를 쓰지 못했다:', e?.message); }
    }, 2000);
  }

  async list(force = false): Promise<StoreAppView[]> {
    if (!force && this.snap && Date.now() - this.snap.at < TTL) return this.snap.list;
    this.inflight ??= this.build().then((list) => { this.snap = { at: Date.now(), list }; return list; }).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async build() {
    await this.load();
    const apps = this.catalog.view().components.filter((c) => c.kind === 'store-app' && c.repo && c.store);
    return Promise.all(apps.map((a) => this.one(a.key, a.repo, a.store!.workflow, a.store!.tagPrefix)));
  }

  private async one(key: string, repo: string, workflow: string, prefix: string): Promise<StoreAppView> {
    const repoUrl = urlOf(repo);
    const base: StoreAppView = { key, repo, repoUrl, workflow, storeVersion: null, storeTagUrl: null, storeAt: null, lastStore: null, lastOta: null, last: null, running: [], history: [] };
    try {
      const [runsJ, tags] = await Promise.all([
        ghJson<any>(`repos/${full(repo)}/actions/workflows/${encodeURIComponent(workflow)}/runs?per_page=${RUNS}`),
        ghJson<any[]>(`repos/${full(repo)}/tags?per_page=50`),
      ]);
      const v = latestStoreTag((tags || []).map((t) => t.name), prefix);
      const tag = v ? (tags || []).find((t) => t.name === prefix + v) : null;
      const runs: StoreRun[] = [];
      for (const r of runsJ?.workflow_runs || []) {
        const state = r.status === 'completed' ? (r.conclusion || 'unknown') : 'running';
        if (state === 'skipped') continue;                    // dev 머지 등 — 릴리스 대상이 아니다
        const run: StoreRun = {
          id: r.id, number: r.run_number, url: r.html_url, at: r.run_started_at || r.created_at || '', actor: r.triggering_actor?.login || r.actor?.login || '',
          event: r.event, sha: String(r.head_sha || '').slice(0, 12), title: String(r.display_title || r.title || '').split('\n')[0].slice(0, 120), state, lane: null, runner: null,
        };
        if (state !== 'running') {
          const k = `${repo}#${r.id}`;
          let hit = this.lanes.get(k);
          if (!hit) {
            const jobs: any[] = (await ghJson<any>(`repos/${full(repo)}/actions/runs/${r.id}/jobs`))?.jobs || [];
            const steps = jobs.flatMap((j) => j.steps || []);
            hit = { lane: readStoreLane(steps, state), runner: jobs.find((j) => j.runner_name)?.runner_name ?? null };
            this.lanes.set(k, hit); this.save();
          }
          run.lane = hit.lane; run.runner = hit.runner;
        }
        runs.push(run);
      }
      const done = runs.filter((r) => r.state !== 'running');
      return {
        ...base, storeVersion: v, storeTagUrl: tag ? `${repoUrl}/tree/${encodeURIComponent(tag.name)}` : null, storeAt: null /* GitHub 태그 목록엔 시각이 없다 */,
        lastStore: done.find((r) => r.lane === 'store') ?? null, lastOta: done.find((r) => r.lane === 'ota') ?? null,
        last: done.find((r) => r.lane !== 'dry-run') ?? null, running: runs.filter((r) => r.state === 'running'), history: runs.slice(0, 10),
      };
    } catch (e: any) {
      console.warn(`[스토어 앱] ${repo}:`, e?.message);
      const prev = this.snap?.list.find((x) => x.key === key);
      return prev ? { ...prev, error: '갱신 실패, 마지막 값' } : { ...base, error: 'GitHub 에서 읽지 못했다' };
    }
  }
}
