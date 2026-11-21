import { BadRequestException, ConflictException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { apkApps, isApkKind } from '../apks/apps.js';
import { audit } from '../audit.js';
import { cfg } from '../config.js';
import { ghJson, ghRaw, ownerRepos } from '../github.js';
import { JsonStore, RevConflict } from '../json-store.js';
import { DEFAULT_COMPONENTS, DEFAULT_NODES } from './defaults.js';
import { LOGO_FILE_RE, LOGO_MAX, pickCandidates, prepareLogo } from './logos.js';
import { UNASSIGNED, buildCatalog, emptyOverrides } from './merge.js';
import { CatalogOverrides, KINDS } from './types.js';

export type CatalogOp =
  | { op: 'node.add'; type: 'group' | 'project'; name: string; parent?: string | null }
  | { op: 'node.update'; id: string; name?: string; logo?: string | null; parent?: string | null; order?: number }
  | { op: 'node.delete'; id: string }
  | { op: 'comp.add'; name: string; kind: string; repo?: string; parent: string; note?: string }
  | { op: 'comp.update'; key: string; name?: string; logo?: string | null; parent?: string; order?: number; note?: string }
  | { op: 'comp.delete'; key: string }
  | { op: 'reset'; node?: string; key?: string };

const NAME_MAX = 60;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const CAND_TTL = 10 * 60 * 1000;

@Injectable()
export class CatalogService implements OnModuleInit, OnModuleDestroy {
  readonly store = new JsonStore<CatalogOverrides>(`${cfg.dataDir}/catalog.json`, emptyOverrides);
  private cands = new Map<string, { at: number; list: { file: string; path: string }[] }>();
  private repoList?: { at: number; list: { name: string; description: string; updated: string; archived: boolean }[] };
  private seedTimer?: NodeJS.Timeout;

  get logoDir() { return `${cfg.dataDir}/logos`; }

  onModuleInit() {
    if (process.env.CATALOG_AUTO_LOGO === 'off') return;
    this.seedTimer = setTimeout(() => void this.seedLogos().catch((e) => console.warn('[카탈로그] 로고 자동 지정 실패:', e?.message)), 15000);
    this.seedTimer.unref?.();
  }
  onModuleDestroy() { clearTimeout(this.seedTimer); }

  view() {
    const o = this.store.get();
    const { roots, components } = buildCatalog(DEFAULT_NODES, DEFAULT_COMPONENTS, o);
    return { rev: o.rev, roots, components, warning: this.store.broken };
  }

  /** 로그인 없이 보는 APK 화면용: 보관함 앱(기기앱, 부모앱 #175)과 그 프로젝트 경로, 이름, 로고만 */
  publicView() {
    const { roots, components } = this.view();
    const apps = components.filter((c) => isApkKind(c.kind));
    const keep = new Set(apps.map((c) => c.project));
    const prune = (list: typeof roots): any[] => list.map((n) => {
      const children = prune(n.children);
      const comps = n.components.filter((c) => isApkKind(c.kind)).map((c) => ({ key: c.key, name: c.name, repo: c.repo, logo: c.logo }));
      return (children.length || keep.has(n.id)) ? { id: n.id, type: n.type, name: n.name, logo: n.logo, children, components: comps } : null;
    }).filter(Boolean);
    return { roots: prune(roots) };
  }

  deviceApps() { return this.view().components.filter((c) => c.kind === 'device-app'); }

  /** APK 보관함에 나오는 앱: 기기앱과 부모앱(부모앱은 내부 테스트만, #175) */
  apkApps() { return apkApps(this.view().components); }

  // ── 편집 ── 여러 동작을 한 번에(끌어다 놓기는 순서를 여러 개 바꾼다)
  apply(login: string, rev: number, ops: CatalogOp[]) {
    if (!Array.isArray(ops) || !ops.length || ops.length > 200) throw new BadRequestException('바꿀 내용이 없습니다');
    const cur = this.view();
    const nodeIds = new Set<string>(); const nodeType = new Map<string, string>();
    const walk = (l: typeof cur.roots) => { for (const n of l) { nodeIds.add(n.id); nodeType.set(n.id, n.type); walk(n.children); } };
    walk(cur.roots);
    const compKeys = new Set(cur.components.map((c) => c.key));
    const name = (v: unknown) => {
      const s = String(v ?? '').trim();
      if (!s || s.length > NAME_MAX) throw new BadRequestException(`이름은 1~${NAME_MAX}자입니다`);
      return s;
    };
    const logo = (v: unknown) => {
      if (v === null) return null;
      const s = String(v);
      if (!LOGO_FILE_RE.test(s) || !existsSync(`${this.logoDir}/${s}`)) throw new BadRequestException('로고 파일을 찾지 못했습니다');
      return s;
    };
    const order = (v: unknown) => { const n = Number(v); if (!Number.isFinite(n)) throw new BadRequestException('순서는 숫자입니다'); return Math.round(n); };
    const added: string[] = [];
    let next: CatalogOverrides;
    try {
      next = this.store.update(rev, (d) => {
        for (const op of ops) {
          switch (op?.op) {
            case 'node.add': {
              const id = `n-${randomBytes(4).toString('hex')}`;
              const parent = op.parent ?? null;
              if (parent && nodeType.get(parent) !== 'group') throw new BadRequestException('그룹 아래에만 만들 수 있습니다');
              if (op.type !== 'group' && op.type !== 'project') throw new BadRequestException('종류는 group, project 입니다');
              d.nodes[id] = { added: true, type: op.type, name: name(op.name), parent, order: 900 };
              nodeIds.add(id); nodeType.set(id, op.type); added.push(id);
              break;
            }
            case 'node.update': {
              if (!nodeIds.has(op.id) || op.id === UNASSIGNED) throw new BadRequestException('없는 그룹, 프로젝트입니다');
              const p = (d.nodes[op.id] ||= {});
              if (op.name !== undefined) p.name = name(op.name);
              if (op.logo !== undefined) p.logo = logo(op.logo);
              if (op.order !== undefined) p.order = order(op.order);
              if (op.parent !== undefined) {
                if (op.parent !== null && nodeType.get(op.parent) !== 'group') throw new BadRequestException('그룹 아래로만 옮길 수 있습니다');
                // 자기 아래로 옮기기 금지
                let c: string | null = op.parent;
                const parentOf = (id: string) => (d.nodes[id]?.parent !== undefined ? d.nodes[id].parent : DEFAULT_NODES.find((n) => n.id === id)?.parent) ?? null;
                while (c) { if (c === op.id) throw new BadRequestException('자기 아래로는 옮길 수 없습니다'); c = parentOf(c); }
                p.parent = op.parent;
              }
              break;
            }
            case 'node.delete': {
              if (!nodeIds.has(op.id) || op.id === UNASSIGNED) throw new BadRequestException('없는 그룹, 프로젝트입니다');
              const find = (l: typeof cur.roots): any => { for (const n of l) { if (n.id === op.id) return n; const h = find(n.children); if (h) return h; } return null; };
              const n = find(cur.roots);
              if (n && (n.children.length || n.components.length)) throw new ConflictException('비어 있지 않습니다, 안의 항목을 옮긴 뒤 지우세요');
              if (d.nodes[op.id]?.added) delete d.nodes[op.id]; else d.nodes[op.id] = { ...(d.nodes[op.id] || {}), deleted: true };
              break;
            }
            case 'comp.add': {
              if (!KINDS.includes(op.kind as any)) throw new BadRequestException('종류가 올바르지 않습니다');
              if (nodeType.get(op.parent) !== 'project') throw new BadRequestException('프로젝트 아래에만 둘 수 있습니다');
              const repo = String(op.repo ?? '').trim();
              if (repo && !REPO_RE.test(repo)) throw new BadRequestException('저장소 이름이 올바르지 않습니다');
              const key = `c-${randomBytes(4).toString('hex')}`;
              d.components[key] = { added: true, name: name(op.name), kind: op.kind as any, repo, parent: op.parent, order: 900, note: op.note ? String(op.note).slice(0, 200) : undefined };
              compKeys.add(key); added.push(key);
              break;
            }
            case 'comp.update': {
              if (!compKeys.has(op.key)) throw new BadRequestException('없는 구성요소입니다');
              const p = (d.components[op.key] ||= {});
              if (op.name !== undefined) p.name = name(op.name);
              if (op.logo !== undefined) p.logo = logo(op.logo);
              if (op.order !== undefined) p.order = order(op.order);
              if (op.note !== undefined) p.note = String(op.note).slice(0, 200);
              if (op.parent !== undefined) {
                if (nodeType.get(op.parent) !== 'project') throw new BadRequestException('프로젝트 아래로만 옮길 수 있습니다');
                p.parent = op.parent;
              }
              break;
            }
            case 'comp.delete': {
              if (!compKeys.has(op.key)) throw new BadRequestException('없는 구성요소입니다');
              if (d.components[op.key]?.added) delete d.components[op.key]; else d.components[op.key] = { ...(d.components[op.key] || {}), deleted: true };
              break;
            }
            case 'reset': {
              if (op.node) { if (d.nodes[op.node]?.added) throw new BadRequestException('직접 만든 항목은 기본값이 없습니다'); delete d.nodes[op.node]; }
              if (op.key) { if (d.components[op.key]?.added) throw new BadRequestException('직접 만든 항목은 기본값이 없습니다'); delete d.components[op.key]; }
              break;
            }
            default: throw new BadRequestException('알 수 없는 동작입니다');
          }
        }
      });
    } catch (e) {
      if (e instanceof RevConflict) throw new ConflictException(e.message);
      throw e;
    }
    void audit({ login, action: 'catalog', target: 'catalog', detail: ops.map((o: any) => `${o.op}:${o.id ?? o.key ?? o.node ?? o.name ?? ''}`).join(', ').slice(0, 500), ok: true });
    return { rev: next.rev, added };
  }

  /** 구성요소 추가에서 고를 저장소 목록. 주인(GITHUB_OWNER)의 저장소 전부, 최근 수정 순. 5분 기억한다 */
  async repos(force = false) {
    if (!force && this.repoList && Date.now() - this.repoList.at < 5 * 60 * 1000) return this.repoList.list;
    const raw = (await ownerRepos()).filter((r) => !r.fork);
    const list = raw.map((r) => ({ name: String(r.name), description: String(r.description || ''), updated: String(r.updated_at || ''), archived: !!r.archived }))
      .sort((a, b) => (a.archived === b.archived ? b.updated.localeCompare(a.updated) : a.archived ? 1 : -1));
    this.repoList = { at: Date.now(), list };
    return list;
  }

  // ── 로고 ──
  saveLogo(buf: Buffer) {
    const { file, body } = prepareLogo(buf);
    mkdirSync(this.logoDir, { recursive: true });
    const path = `${this.logoDir}/${file}`;
    if (!existsSync(path)) writeFileSync(path, body);
    return file;
  }

  async candidates(repo: string, force = false) {
    if (!REPO_RE.test(repo)) throw new BadRequestException('저장소 이름이 올바르지 않습니다');
    const hit = this.cands.get(repo);
    if (!force && hit && Date.now() - hit.at < CAND_TTL) return hit.list;
    const info = await ghJson<any>(`repos/${cfg.owner}/${repo}`);
    if (!info) throw new BadRequestException('저장소를 찾지 못했습니다');
    const ref = info.default_branch || 'main';
    const tree = await ghJson<any>(`repos/${cfg.owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    const paths = (tree?.tree || []).filter((e: any) => e.type === 'blob' && (e.size ?? 0) <= LOGO_MAX).map((e: any) => e.path as string);
    const list: { file: string; path: string }[] = [];
    for (const p of pickCandidates(paths)) {
      try {
        const buf = await ghRaw(repo, p, ref, LOGO_MAX);
        if (!buf) continue;
        const file = this.saveLogo(buf);
        if (!list.some((x) => x.file === file)) list.push({ file, path: p });
      } catch { /* 형식이 아니면 건너뛴다 */ }
    }
    this.cands.set(repo, { at: Date.now(), list });
    return list;
  }

  /** 로고가 없는 앱(기기앱·스토어 앱)에 저장소 첫 후보를 자동 지정 — 백엔드·웹 저장소엔 남의 로고가 섞여 있어 하지 않는다 */
  async seedLogos() {
    const { components } = this.view();
    const o = this.store.get();
    const auto: Record<string, string> = {};
    for (const c of components) {
      if (!['device-app', 'store-app'].includes(c.kind) || !c.repo) continue;
      if (o.components[c.key]?.logo !== undefined || o.auto[c.key]) continue;
      try {
        const first = (await this.candidates(c.repo))[0];
        if (first) auto[c.key] = first.file;
      } catch (e: any) { console.warn(`[카탈로그] ${c.repo} 로고 후보 실패:`, e?.message); }
    }
    if (Object.keys(auto).length) {
      this.store.update(undefined, (d) => { for (const [k, f] of Object.entries(auto)) if (d.components[k]?.logo === undefined && !d.auto[k]) d.auto[k] = f; });
      console.log(`[카탈로그] 로고 자동 지정 ${Object.keys(auto).length}개`);
    }
  }
}
