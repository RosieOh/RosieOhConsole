import { BadRequestException, ConflictException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { audit } from '../audit.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { cfg } from '../config.js';
import { ghJson, ghRaw } from '../github.js';
import { DEFAULT_INFRA, InfraKind, SCAN_PATHS } from '../infra/defaults.js';
import { infraName } from '../infra/names.js';
import { JsonStore, RevConflict, Versioned } from '../json-store.js';
import { Clue, Known, extractClues, hostOf, matchClues, wantFile } from './scan.js';

// 연관 관계(A2) — 저장소 설정 파일에서 자동으로 찾고(/data/relations-scan.json), 사람이 확정·거절·추가(/data/relations.json)
export interface Evidence { path: string; line: number; text: string }
export interface AutoEdge { target: string; via: string; evidence: Evidence[]; firstSeen: string }
export interface CompScan { at: string; ref: string; files: number; hits: AutoEdge[]; unknown: { host: string; evidence: Evidence[] }[]; error?: string }
interface ScanFile { at: string; comps: Record<string, CompScan> }

export interface Decisions extends Versioned {
  confirmed: Record<string, { by: string; at: string }>;
  rejected: Record<string, { by: string; at: string }>;
  manual: Record<string, { from: string; to: string; note?: string; by: string; at: string }>;
  names: Record<string, string>;                 // 노드 이름 바꾸기(인프라·자동으로 생긴 DB·외부)
  hosts: Record<string, string>;                 // 모르는 호스트에 붙인 이름 → ext:<host> 노드
}

export type EdgeState = 'auto' | 'confirmed' | 'rejected' | 'manual';
export interface GraphNode { id: string; kind: InfraKind | 'component'; name: string; sub?: string; discovered?: boolean }
export interface GraphEdge { id: string; from: string; to: string; via: string; state: EdgeState; evidence: Evidence[]; firstSeen?: string; note?: string }

const SCAN_EVERY = 6 * 3600 * 1000;
const MAX_FILES = 80;
const MAX_BYTES = 300 * 1024;
const edgeId = (from: string, to: string) => `${from}->${to}`;
const ID_RE = /^(comp|infra|db|redis|ext):[A-Za-z0-9._:-]{1,120}$/;

@Injectable()
export class RelationsService implements OnModuleInit, OnModuleDestroy {
  readonly decisions = new JsonStore<Decisions>(`${cfg.dataDir}/relations.json`,
    () => ({ rev: 0, confirmed: {}, rejected: {}, manual: {}, names: {}, hosts: {} }));
  private scan: ScanFile = { at: '', comps: {} };
  private loaded = false;
  private running: Promise<void> | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly catalog: CatalogService) {}

  private get scanFile() { return `${cfg.dataDir}/relations-scan.json`; }

  async onModuleInit() {
    await this.load();
    if (process.env.RELATIONS_SCAN === 'off') return;
    const t1 = setTimeout(() => void this.rescan().catch(() => {}), this.scan.at ? 5 * 60 * 1000 : 45 * 1000);
    const t2 = setInterval(() => void this.rescan().catch(() => {}), SCAN_EVERY);
    t1.unref?.(); t2.unref?.();
    this.timers.push(t1, t2);
  }
  onModuleDestroy() { for (const t of this.timers) { clearTimeout(t); clearInterval(t); } }

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try { this.scan = JSON.parse(await readFile(this.scanFile, 'utf8')); } catch { /* 처음 */ }
  }
  private async save() {
    await mkdir(cfg.dataDir, { recursive: true });
    await writeFile(this.scanFile + '.tmp', JSON.stringify(this.scan), 'utf8');
    await rename(this.scanFile + '.tmp', this.scanFile);
  }

  /** 단서를 짝지을 기준 — 카탈로그의 운영·테스트배드 주소 + 인프라 호스트 */
  known(): Known {
    const hostToComp: Known['hostToComp'] = [];
    for (const c of this.catalog.view().components) for (const ep of [c.prod, c.testbed]) {
      const h = ep && hostOf(ep.link);
      if (!h) continue;
      const shared = this.catalog.view().components.filter((x) => [x.prod, x.testbed].some((e) => e && hostOf(e.link)?.host === h.host)).length > 1;
      hostToComp.push({ host: h.host, path: shared && h.path ? h.path : undefined, comp: c.key });
    }
    const infraHosts = DEFAULT_INFRA.flatMap((i) => (i.hosts || []).map((host) => ({ host, id: i.id })));
    return { hostToComp, infraHosts };   // 공유 Redis 를 인프라로 등록하면 defaultRedis 로 준다
  }

  /** 저장소 파일 목록(GitHub 은 쪽 나눔 없이 한 번에, 아주 크면 truncated 로 잘린다) */
  private async tree(repo: string, ref: string): Promise<{ path: string; size: number }[]> {
    const t = await ghJson<any>(`repos/${cfg.owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    if (t?.truncated) console.warn(`[연관] ${repo} 파일이 많아 목록이 잘렸다`);
    return (t?.tree || []).filter((e: any) => e.type === 'blob').map((e: any) => ({ path: e.path, size: e.size ?? 0 }));
  }

  async scanComponent(key: string): Promise<CompScan> {
    const c = this.catalog.view().components.find((x) => x.key === key);
    if (!c?.repo) throw new BadRequestException('저장소가 없는 구성요소입니다');
    const prev = this.scan.comps[key];
    const at = new Date().toISOString();
    try {
      const info = await ghJson<any>(`repos/${cfg.owner}/${c.repo}`);
      if (!info) throw new Error('저장소를 찾지 못했다');
      const ref = info.default_branch || 'main';
      const rule = SCAN_PATHS[key] || {};
      const files = (await this.tree(c.repo, ref))
        .filter((f) => f.size <= MAX_BYTES && wantFile(f.path))
        .filter((f) => (!rule.only || rule.only.some((p) => f.path.startsWith(p))) && !(rule.skip || []).some((p) => f.path.startsWith(p)))
        .slice(0, MAX_FILES);
      const clues: { clue: Clue; path: string; lineText?: string }[] = [];
      for (const f of files) {
        const buf = await ghRaw(c.repo, f.path, ref, MAX_BYTES).catch(() => null);
        if (!buf) continue;
        const text = buf.toString('utf8');
        const lines = text.split(/\r?\n/);
        for (const clue of extractClues(text)) clues.push({ clue, path: f.path, lineText: lines[clue.line - 1] });
      }
      const { hits, unknown } = matchClues(clues, this.known(), [key]);
      const result: CompScan = {
        at, ref, files: files.length,
        hits: hits.map((h) => ({ ...h, firstSeen: prev?.hits.find((p) => p.target === h.target)?.firstSeen ?? at })),
        unknown,
      };
      this.scan.comps[key] = result;
      return result;
    } catch (e: any) {
      const r = { ...(prev ?? { ref: '', files: 0, hits: [], unknown: [] }), at, error: String(e?.message || e) };
      this.scan.comps[key] = r;
      return r;
    }
  }

  async rescan(keys?: string[]) {
    if (this.running) return this.running;
    this.running = (async () => {
      const comps = this.catalog.view().components.filter((c) => c.repo && (!keys || keys.includes(c.key)));
      for (const c of comps) await this.scanComponent(c.key);
      this.scan.at = new Date().toISOString();
      await this.save();
      console.log(`[연관] 저장소 설정 읽기, 구성요소 ${comps.length}개, 연결 ${this.graph().edges.length}개`);
    })().finally(() => { this.running = null; });
    return this.running;
  }

  get scanning() { return !!this.running; }

  /** 인프라 이름 — 연관 관계에서 바꾼 이름 > 카탈로그 프로젝트 이름 > 기본 이름 */
  infraNames() {
    const d = this.decisions.get();
    const names = new Map<string, string>();
    const walk = (l: { id: string; name: string; children: any[] }[]) => { for (const n of l) { names.set(n.id, n.name); walk(n.children); } };
    walk(this.catalog.view().roots);
    return new Map(DEFAULT_INFRA.map((i) => [i.id, infraName(i, d.names[`infra:${i.id}`], (id) => names.get(id))]));
  }

  // ── 그래프 ── 자동(확인 필요)·확정·거절·직접 추가
  graph() {
    const d = this.decisions.get();
    const comps = this.catalog.view().components;
    const nodes = new Map<string, GraphNode>();
    const named = this.infraNames();
    for (const i of DEFAULT_INFRA) nodes.set(`infra:${i.id}`, { id: `infra:${i.id}`, kind: i.kind, name: named.get(i.id)!.name, sub: i.sub });
    const ensure = (id: string) => {
      if (nodes.has(id) || id.startsWith('comp:')) return;
      const [kind, rest] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
      const owner = comps.find((c) => c.key === rest);
      const name = d.names[id] ?? (kind === 'db' ? (owner ? `${owner.name} DB` : rest) : kind === 'redis' ? (owner ? `${owner.name} Redis` : rest) : d.hosts[rest] ?? rest);
      nodes.set(id, { id, kind: kind === 'db' ? 'db' : kind === 'redis' ? 'redis' : 'external', name, sub: owner ? '주소는 서버 env' : rest, discovered: true });
    };
    const edges = new Map<string, GraphEdge>();
    for (const [key, s] of Object.entries(this.scan.comps)) {
      if (!comps.some((c) => c.key === key)) continue;
      for (const h of s.hits) {
        const from = `comp:${key}`;
        const to = h.target;
        if (to.startsWith('comp:') && !comps.some((c) => `comp:${c.key}` === to)) continue;
        const id = edgeId(from, to);
        const state: EdgeState = d.rejected[id] ? 'rejected' : d.confirmed[id] ? 'confirmed' : 'auto';
        edges.set(id, { id, from, to, via: h.via, state, evidence: h.evidence, firstSeen: h.firstSeen });
        ensure(to);
      }
      // 이름 붙인 모르는 호스트 → 외부 노드
      for (const u of s.unknown) if (d.hosts[u.host]) {
        const to = `ext:${u.host}`; const id = edgeId(`comp:${key}`, to);
        const state: EdgeState = d.rejected[id] ? 'rejected' : d.confirmed[id] ? 'confirmed' : 'auto';
        edges.set(id, { id, from: `comp:${key}`, to, via: `주소 ${u.host}`, state, evidence: u.evidence });
        ensure(to);
      }
    }
    for (const [id, m] of Object.entries(d.manual)) {
      edges.set(id, { id, from: m.from, to: m.to, via: '직접 추가', state: 'manual', evidence: [], note: m.note });
      ensure(m.to); ensure(m.from);
    }
    const unknown = Object.entries(this.scan.comps).flatMap(([key, s]) => s.unknown.filter((u) => !d.hosts[u.host]).map((u) => ({ comp: key, ...u })));
    const scans = Object.fromEntries(Object.entries(this.scan.comps).map(([k, s]) => [k, { at: s.at, files: s.files, error: s.error }]));
    return { rev: d.rev, scannedAt: this.scan.at, scanning: this.scanning, nodes: [...nodes.values()], edges: [...edges.values()], unknown, scans };
  }

  /** 확정된 것 + 확인 필요(자동) — 거절 뺀 연결. 배포 흐름·Architecture 가 쓴다 */
  liveEdges() { return this.graph().edges.filter((e) => e.state !== 'rejected'); }

  decide(login: string, rev: number, b: { op: 'confirm' | 'reject' | 'reset' | 'add' | 'remove' | 'name' | 'host'; id?: string; from?: string; to?: string; note?: string; name?: string; host?: string }) {
    const g = this.graph();
    try {
      this.decisions.update(rev, (d) => {
        const now = { by: login, at: new Date().toISOString() };
        switch (b.op) {
          case 'confirm': case 'reject': case 'reset': {
            if (!b.id || !g.edges.some((e) => e.id === b.id)) throw new BadRequestException('없는 연결입니다');
            delete d.confirmed[b.id]; delete d.rejected[b.id];
            if (b.op === 'confirm') d.confirmed[b.id] = now;
            if (b.op === 'reject') d.rejected[b.id] = now;
            break;
          }
          case 'add': {
            if (!b.from || !b.to || !ID_RE.test(b.from) || !ID_RE.test(b.to) || b.from === b.to) throw new BadRequestException('연결 양 끝이 올바르지 않습니다');
            const ok = (id: string) => id.startsWith('comp:') ? this.catalog.view().components.some((c) => `comp:${c.key}` === id) : g.nodes.some((n) => n.id === id) || /^(db|redis|ext):/.test(id);
            if (!ok(b.from) || !ok(b.to)) throw new BadRequestException('없는 서비스, 인프라입니다');
            d.manual[edgeId(b.from, b.to)] = { from: b.from, to: b.to, note: b.note ? String(b.note).slice(0, 200) : undefined, ...now };
            break;
          }
          case 'remove': {
            if (!b.id || !d.manual[b.id]) throw new BadRequestException('직접 추가한 연결만 지울 수 있습니다');
            delete d.manual[b.id];
            break;
          }
          case 'name': {
            if (!b.id || !ID_RE.test(b.id) || b.id.startsWith('comp:')) throw new BadRequestException('이름을 바꿀 수 없는 항목입니다(서비스 이름은 카탈로그에서)');
            const name = String(b.name ?? '').trim();
            if (!name) delete d.names[b.id]; else if (name.length > 60) throw new BadRequestException('이름은 60자까지'); else d.names[b.id] = name;
            break;
          }
          case 'host': {
            const host = String(b.host ?? '').toLowerCase();
            if (!/^[a-z0-9.-]{3,200}$/.test(host)) throw new BadRequestException('호스트가 올바르지 않습니다');
            const name = String(b.name ?? '').trim();
            if (!name) delete d.hosts[host]; else d.hosts[host] = name.slice(0, 60);
            break;
          }
          default: throw new BadRequestException('알 수 없는 동작입니다');
        }
      });
    } catch (e) {
      if (e instanceof RevConflict) throw new ConflictException(e.message);
      throw e;
    }
    void audit({ login, action: `relations.${b.op}`, target: b.id ?? b.host ?? `${b.from}->${b.to}`, detail: b.name ?? b.note, ok: true });
    return { ok: true, rev: this.decisions.get().rev };
  }
}
