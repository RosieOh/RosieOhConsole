import { Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service.js';
import { pathOf } from '../catalog/merge.js';
import { cfg, repoUrl, full } from '../config.js';
import { ghJson, ghPaged } from '../github.js';
import { readReleaseBody } from './release.js';
import { ApkKind, hasReleases } from './apps.js';
import { Change, normVersion, splitVersions, summarize } from './changes.js';
import { Status, VerState, currentKnox, knoxStore, statusOf } from './knox.js';
import { SHIPPED, Shipped, cleanShipped, mergeVersions, prevShipped, shippedStore, upsertShipped, windowCommits } from './shipped.js';
import { isSafeKey } from '../safe.js';
import { audit } from '../audit.js';

export interface ApkAsset { id: number; name: string; size: number; downloads: number }
export interface ApkRelease {
  id: number; tag: string; name: string; date: string; prerelease: boolean; url: string;
  versionCode: number | null; sha256: string | null; buildUrl: string | null; branch: string;
  commit: string | null; server: string | null;
  assets: ApkAsset[];
}
export interface ApkRepo {
  key: string; repo: string; name: string; logo: string | null; project: string; path: string[];
  /** device-app 은 운영 릴리스와 내부 테스트, store-app(부모앱)은 내부 테스트만(#175) */
  kind: ApkKind;
  description: string; url: string; releases: (ApkRelease & { status: Status; state: VerState | null })[]; error?: string;
  /** 내부 테스트 빌드(테스트배드 서버를 보는 dev 빌드, GitHub 프리릴리스). 녹스, 출고와는 상관없다 */
  tests: ApkRelease[];
  knox: { tag: string; at: string; by: string } | null;
  history: { at: string; by: string; tag: string; action: 'knox' | 'undo' }[];
}

const CACHE_MS = 2 * 60 * 1000;
const KEEP = 20;   // 앱마다 최근 릴리스 몇 개까지 보여 주나

@Injectable()
export class ApksService {
  private cache = new Map<string, { at: number; data: { description: string; url: string; releases: ApkRelease[]; tests: ApkRelease[]; error?: string } }>();
  private changeCache = new Map<string, { changes: Change[]; base: string | null; count: number }>();
  private verCache = new Map<string, { top: string; segs: ReturnType<typeof splitVersions>; commits: { sha: string; message: string; date: string }[] }>();
  readonly knox = knoxStore();
  readonly shippedSt = shippedStore();

  constructor(private readonly catalog: CatalogService) {}

  /** 카탈로그의 기기앱과 부모앱(이름, 로고, 프로젝트는 그때그때 카탈로그 값) + 릴리스(2분 캐시). 부모앱은 내부 테스트만(#175) */
  async list(force = false): Promise<ApkRepo[]> {
    const { roots } = this.catalog.view();
    const apps = this.catalog.apkApps();
    const st = this.knox.get().apps;
    return Promise.all(apps.map(async (a) => {
      const kind = a.kind as ApkKind;
      const withReleases = hasReleases(kind);
      const r = await this.releases(a.repo, force, withReleases);
      const versions = withReleases ? st[a.repo]?.versions ?? {} : {};
      return {
        key: a.key, repo: a.repo, name: a.name, logo: a.logo, project: a.project, path: pathOf(roots, a.project), kind,
        ...r, releases: r.releases.map((rel: ApkRelease) => ({ ...rel, status: statusOf(versions[rel.tag]), state: versions[rel.tag] ?? null })),
        knox: withReleases ? currentKnox(versions) : null, history: withReleases ? (st[a.repo]?.history ?? []).slice(-20).reverse() : [],
      };
    }));
  }

  private async releases(repo: string, force: boolean, withReleases = true) {
    const hit = this.cache.get(repo);
    if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    const base = { description: '', url: `${repoUrl(repo)}`, releases: [] as ApkRelease[], tests: [] as ApkRelease[] };
    let data: any;
    try {
      // 운영 릴리스와 내부 테스트(프리릴리스)를 따로 읽는다. 테스트가 많이 쌓여도 운영 릴리스가 밀려나지 않게.
      // 부모앱은 운영 릴리스를 보관함에서 내지 않으므로 프리릴리스만 읽는다(#175)
      // GitHub 은 프리릴리스 여부로 거르지 못한다 — 한 번에 받아 나눈다
      const [info, all] = await Promise.all([
        ghJson<any>(`repos/${full(repo)}`),
        ghJson<any[]>(`repos/${full(repo)}/releases?per_page=100`),
      ]);
      const rels = withReleases ? (all || []).filter((r: any) => !r.prerelease).slice(0, KEEP) : [];
      const tests = (all || []).filter((r: any) => r.prerelease).slice(0, KEEP);
      const read = (list: any[] | null, pre: boolean): ApkRelease[] => (list || [])
        .filter((r: any) => !r.draft && !!r.prerelease === pre)
        .map((r: any) => ({
          id: r.id, tag: r.tag_name, name: r.name || r.tag_name, date: r.published_at || r.created_at, prerelease: !!r.prerelease,
          url: r.html_url, branch: r.target_commitish || '', ...readReleaseBody(r.body),
          assets: (r.assets || []).filter((x: any) => /\.apk$/i.test(x.name))
            .map((x: any) => ({ id: x.id, name: x.name, size: x.size, downloads: x.download_count ?? 0 })),
        }))
        .filter((r: ApkRelease) => r.assets.length);
      if (!info) data = { ...base, error: '저장소를 찾지 못했다' };
      else data = { description: info.description || '', url: base.url, releases: read(rels, false), tests: read(tests, true) };
    } catch (e: any) {
      console.warn(`[APK] ${repo} 릴리스 읽기 실패:`, e?.message);
      if (hit) return { ...hit.data, error: '갱신 실패, 마지막으로 받은 목록입니다' };
      data = { ...base, error: 'GitHub 에서 릴리스를 읽지 못했다' };
    }
    this.cache.set(repo, { at: Date.now(), data });
    return data;
  }

  // ── 녹스·다운로드·메모 ──
  recordDownload(repo: string, tag: string, who: string) {
    if (!isSafeKey(repo) || !isSafeKey(tag)) return;
    this.knox.update(undefined, (d) => {
      const app = (d.apps[repo] ||= { versions: {}, history: [] });
      const v = (app.versions[tag] ||= { downloads: 0 });
      v.downloads += 1; v.lastDownload = { at: new Date().toISOString(), who };
    });
  }

  async markKnox(repo: string, tag: string, by: string, undo: boolean) {
    if (!isSafeKey(repo) || !isSafeKey(tag)) throw new Error('없는 앱, 버전입니다');
    const r = (await this.list()).find((x) => x.repo === repo);
    if (!r || !r.releases.some((x) => x.tag === tag)) throw new Error('없는 앱, 버전입니다');
    this.knox.update(undefined, (d) => {
      const app = (d.apps[repo] ||= { versions: {}, history: [] });
      const v = (app.versions[tag] ||= { downloads: 0 });
      if (undo) delete v.knox; else v.knox = { at: new Date().toISOString(), by };
      app.history.push({ at: new Date().toISOString(), by, tag, action: undo ? 'undo' : 'knox' });
      if (app.history.length > 200) app.history.splice(0, app.history.length - 200);
    });
    await audit({ login: by, action: undo ? 'apk.knox.undo' : 'apk.knox', target: `${repo} ${tag}`, ok: true });
  }

  async setNote(repo: string, tag: string, text: string, by: string) {
    if (!isSafeKey(repo) || !isSafeKey(tag)) throw new Error('없는 앱, 버전입니다');
    const r = (await this.list()).find((x) => x.repo === repo);
    if (!r || !r.releases.some((x) => x.tag === tag)) throw new Error('없는 앱, 버전입니다');
    this.knox.update(undefined, (d) => {
      const app = (d.apps[repo] ||= { versions: {}, history: [] });
      const v = (app.versions[tag] ||= { downloads: 0 });
      if (text.trim()) v.note = { text: text.trim().slice(0, 2000), by, at: new Date().toISOString() }; else delete v.note;
    });
  }

  /** 커밋 기록을 버전 올림 커밋으로 나눈 버전들(최신 릴리스 태그 기준, 그 태그가 바뀔 때까지 캐시).
   *  보관함에 파일이 없는 옛 버전도 내역은 볼 수 있게 한다 */
  private async history(repo: string, top: string) {
    const hit = this.verCache.get(repo);
    if (hit?.top === top) return hit;
    const raw = await ghPaged<any>(`repos/${full(repo)}/commits?sha=${encodeURIComponent(top)}`, 50, 6);
    const commits = raw.map((c) => ({ sha: c.sha, message: c.commit?.message || '', date: c.commit?.author?.date || '' }));
    const h = { top, segs: splitVersions(commits, top).slice(0, 30), commits };
    this.verCache.set(repo, h);
    return h;
  }
  private segments(repo: string, top: string) { return this.history(repo, top).then((h) => h.segs); }

  /** 업데이트 내역에서 고를 버전들, 최신부터. release 는 보관함에 파일이 있는 버전, shipped 는 고객에게 출고한 버전(출고 기록) */
  async versions(repo: string) {
    const r = (await this.list()).find((x) => x.repo === repo);
    if (!r) throw new Error('없는 앱입니다');
    if (!r.releases.length) return { versions: [] };
    const segs = await this.segments(repo, r.releases[0].tag).catch(() => [] as ReturnType<typeof splitVersions>);
    return { versions: mergeVersions(segs.map((g) => ({ version: g.version, date: g.date, count: summarize(g.commits).length })), r.releases, this.shippedOf(repo), normVersion) };
  }

  /** 이 버전에서 바뀐 점.
   *  출고 버전: 출고 기록을 정리한 내용 + 앞 출고 뒤부터 이번 출고까지의 커밋(개발 기록)
   *  그 밖: 커밋 기록의 버전 구간, 없으면 이전 릴리스 태그와 비교(첫 릴리스면 최근 커밋) */
  async changes(repo: string, tag: string) {
    const r = (await this.list()).find((x) => x.repo === repo);
    const ti = r?.tests.findIndex((x) => x.tag === tag) ?? -1;
    if (r && ti >= 0) return this.testChanges(r, ti);
    if (!r || !r.releases.length) throw new Error('없는 앱, 버전입니다');
    const h = await this.history(repo, r.releases[0].tag).catch(() => ({ segs: [] as ReturnType<typeof splitVersions>, commits: [] as { sha: string; message: string; date: string }[] }));
    const segs = h.segs;
    const list = this.shippedOf(repo);
    const sh = list.find((x) => normVersion(x.version) === normVersion(tag)) ?? null;
    const si = segs.findIndex((g) => g.version === normVersion(tag));
    const i = r.releases.findIndex((x) => x.tag === tag);
    if (i < 0 && si < 0 && !sh) throw new Error('없는 앱, 버전입니다');
    const note = i >= 0 ? this.knox.get().apps[repo]?.versions[tag]?.note ?? null : null;
    const base = { repo, tag, release: i >= 0, note, issueUrl: `${repoUrl(repo)}/issues/` };
    if (sh) {
      const prev = prevShipped(list, sh);
      const dev = summarize(windowCommits(h.commits, prev?.at ?? null, sh.at));
      return { ...base, changes: sh.items.map((x) => ({ ...x, sha: '' })), dev, base: prev ? `v${prev.version}` : null, count: sh.items.length,
        shipped: { at: sh.at, channel: sh.channel, note: sh.note ?? null, by: sh.by ?? null, updatedAt: sh.updatedAt ?? null } };
    }
    const key = `${repo}@${tag}@${r.releases[0].tag}`;
    let hit = this.changeCache.get(key);
    if (!hit && si >= 0) {
      const g = segs[si], prev = segs[si + 1];
      hit = { changes: summarize(g.commits), base: prev ? (r.releases.find((x) => normVersion(x.tag) === prev.version)?.tag ?? `v${prev.version}`) : null, count: g.commits.length };
      this.changeCache.set(key, hit);
    }
    if (!hit) {
      const prev = r.releases[i + 1]?.tag ?? null;
      let commits: any[] = [];
      if (prev) commits = (await ghJson<any>(`repos/${full(repo)}/compare/${encodeURIComponent(prev)}...${encodeURIComponent(tag)}`))?.commits ?? [];
      else commits = (await ghJson<any[]>(`repos/${full(repo)}/commits?sha=${encodeURIComponent(tag)}&per_page=40`)) ?? [];
      const cl = commits.map((c: any) => ({ sha: c.sha, message: c.commit?.message || '' }));
      hit = { changes: summarize(cl), base: prev, count: cl.length };
      this.changeCache.set(key, hit);
    }
    return { ...base, ...hit, dev: [], shipped: null };
  }

  /** 내부 테스트 빌드의 바뀐 점 — 바로 앞 테스트 빌드와 비교(첫 테스트 빌드면 최근 커밋) */
  private async testChanges(r: ApkRepo, i: number) {
    const t = r.tests[i], prev = r.tests[i + 1] ?? null;
    const key = `${r.repo}@${t.tag}`;
    let hit = this.changeCache.get(key);
    if (!hit) {
      const head = t.commit ?? t.tag;
      let commits: any[] = [];
      if (prev) commits = (await ghJson<any>(`repos/${full(r.repo)}/compare/${encodeURIComponent(prev.commit ?? prev.tag)}...${encodeURIComponent(head)}`))?.commits ?? [];
      else commits = (await ghJson<any[]>(`repos/${full(r.repo)}/commits?sha=${encodeURIComponent(head)}&per_page=20`)) ?? [];
      const cl = commits.map((c: any) => ({ sha: c.sha, message: c.commit?.message || '' }));
      hit = { changes: summarize(cl), base: prev?.tag ?? null, count: cl.length };
      this.changeCache.set(key, hit);
    }
    return { repo: r.repo, tag: t.tag, ...hit, release: true, test: true, note: null, dev: [], shipped: null, issueUrl: `${repoUrl(r.repo)}/issues/` };
  }

  // ── 출고 기록(콘솔에서 고친 게 있으면 그것, 없으면 코드의 기본값) ──
  shippedOf(repo: string): Shipped[] { return this.shippedSt.get().apps[repo] ?? SHIPPED[repo] ?? []; }

  async shippedList(repo: string) {
    if (!(await this.list()).some((x) => x.repo === repo && hasReleases(x.kind))) throw new Error('없는 앱입니다');
    const custom = this.shippedSt.get().apps[repo];
    return { list: this.shippedOf(repo), rev: this.shippedSt.get().rev, edited: !!custom };
  }

  /** from 이 있으면 그 기록을 고치고, 없으면 새로 넣는다. rec 가 null 이면 from 을 지운다 */
  async saveShipped(repo: string, from: string | null, input: any | null, by: string, rev?: number) {
    if (!isSafeKey(repo)) throw new Error('없는 앱입니다');
    if (!(await this.list()).some((x) => x.repo === repo && hasReleases(x.kind))) throw new Error('없는 앱입니다');
    const rec = input ? { ...cleanShipped(input), by, updatedAt: new Date().toISOString() } : null;
    if (!rec && !from) throw new Error('지울 버전이 없습니다');
    this.shippedSt.update(rev, (d) => { d.apps[repo] = upsertShipped(d.apps[repo] ?? SHIPPED[repo] ?? [], from, rec); });
    await audit({ login: by, action: rec ? (from ? 'apk.shipped.edit' : 'apk.shipped.add') : 'apk.shipped.delete', target: `${repo} v${rec?.version ?? from}${from && rec && from !== rec.version ? ` (원래 v${from})` : ''}`, ok: true });
    return { ok: true, rev: this.shippedSt.get().rev };
  }

  /** 목록에 있는 앱(기기앱, 부모앱 내부 테스트)의 APK 만 내준다. 주소의 repo, id 를 그대로 믿지 않는다 */
  async find(repo: string, assetId: number) {
    for (const force of [false, true]) {
      const r = (await this.list(force)).find((x) => x.repo === repo);
      if (!r) return null;
      for (const rel of [...r.releases, ...r.tests]) {
        const a = rel.assets.find((x) => x.id === assetId);
        if (a) return { repo, release: rel, asset: a, test: rel.prerelease, url: `${cfg.githubApi}/repos/${full(repo)}/releases/assets/${a.id}` };
      }
    }
    return null;
  }
}
