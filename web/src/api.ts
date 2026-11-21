// 콘솔 자체 API (/dashapi) 클라이언트. 같은 출처.
async function j(method: string, path: string, body?: unknown) {
  const res = await fetch('/dashapi' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(data?.message || res.statusText), { status: res.status, data });
  return data;
}

export const api = {
  me: () => j('GET', '/me') as Promise<Me>,
  logout: () => j('POST', '/logout'),
  status: () => j('GET', '/status') as Promise<{ services: ServiceStatus[] }>,
  token: (b: { sub?: string; role?: string; ttl?: number }) => j('POST', '/token', b),
  docsList: () => j('GET', '/docs') as Promise<{ docs: DocMeta[] }>,
  doc: (id: string) => j('GET', '/docs/' + id) as Promise<{ id: string; title: string; markdown: string }>,
  tools: (refresh = false) => j('GET', '/tools' + (refresh ? '?refresh=1' : '')) as Promise<{ repos: ToolRepo[] }>,
  apks: (refresh = false) => j('GET', '/apks' + (refresh ? '?refresh=1' : '')) as Promise<{ apps: ApkRepo[] }>,
  deploy: (refresh = false) => j('GET', '/deploy' + (refresh ? '?refresh=1' : '')) as Promise<DeployOverview>,
  deployAudit: () => j('GET', '/deploy/audit') as Promise<{ entries: AuditEntry[] }>,
  rollback: (b: { service: string; env: string; version: string; confirm?: string }) => j('POST', '/deploy/rollback', b) as Promise<{ ok: boolean; url: string; from: string | null; to: string }>,
  versions: (service: string, env: string) => j('GET', `/deploy/versions?service=${encodeURIComponent(service)}&env=${encodeURIComponent(env)}`) as Promise<VersionNotes>,
  rollbackFloor: (b: { service: string; env: string; version?: string; reason?: string; clear?: boolean }) => j('POST', '/deploy/floor', b) as Promise<{ ok: boolean; floor: RollbackFloor | null }>,
  flags: (refresh = false) => j('GET', '/flags' + (refresh ? '?refresh=1' : '')) as Promise<FlagsOverview>,
  flagSummary: () => j('GET', '/flags/summary') as Promise<FlagSummary>,
  setFlag: (b: { comp: string; env: FlagEnv; key: string; enabled: boolean; confirm?: string }) => j('POST', '/flags', b) as Promise<{ ok: boolean; flag: FlagView }>,
  catalog: () => j('GET', '/catalog') as Promise<Catalog>,
  catalogOps: (rev: number, ops: CatalogOp[]) => j('POST', '/catalog/ops', { rev, ops }) as Promise<{ rev: number; added: string[] }>,
  catalogRepos: (refresh = false) => j('GET', '/catalog/repos' + (refresh ? '?refresh=1' : '')) as Promise<{ repos: GhRepo[] }>,
  logoCandidates: (repo: string, refresh = false) => j('GET', `/catalog/logo-candidates?repo=${encodeURIComponent(repo)}${refresh ? '&refresh=1' : ''}`) as Promise<{ candidates: { file: string; path: string }[] }>,
  uploadLogo: (data: string) => j('POST', '/catalog/logo', { data }) as Promise<{ file: string }>,
  pubCatalog: () => j('GET', '/pub/catalog') as Promise<{ roots: PubNode[] }>,
  users: () => j('GET', '/users') as Promise<{ users: { login: string; fullName: string; avatar: string }[] }>,
  access: () => j('GET', '/access') as Promise<AccessList>,
  setAccess: (login: string, b: { role?: Role | 'none'; rev?: number }) => j('PUT', `/access/${encodeURIComponent(login)}`, b) as Promise<{ ok: boolean; rev: number; role: Role; board: boolean | null }>,
  buildNotify: () => j('GET', '/build-notify') as Promise<BuildNotify>,
  setBuildNotify: (b: { rev?: number; on?: boolean; add?: string; remove?: string }) => j('PUT', '/build-notify', b) as Promise<BuildNotify>,
  storeApps: (refresh = false) => j('GET', '/deploy/store-apps' + (refresh ? '?refresh=1' : '')) as Promise<{ apps: StoreAppView[] }>,
  runners: (refresh = false) => j('GET', '/runners' + (refresh ? '?refresh=1' : '')) as Promise<RunnersView>,
  runnerAlerts: () => j('GET', '/runners/alerts') as Promise<{ alerts: RunnerAlert[]; updatedAt: string }>,
  secrets: (refresh = false) => j('GET', '/secrets' + (refresh ? '?refresh=1' : '')) as Promise<SecretsOverview>,
  secretSet: (b: SecretWrite & { value: string; description?: string }) => j('POST', '/secrets/set', b) as Promise<{ ok: boolean; created: boolean; usedBy: SecretUsage[] }>,
  secretDelete: (b: SecretWrite) => j('POST', '/secrets/delete', b) as Promise<{ ok: boolean; usedBy: SecretUsage[] }>,
  toolReadme: (name: string) => j('GET', `/tools/${encodeURIComponent(name)}/readme`) as Promise<{ markdown: string }>,
};

export type Role = 'admin' | 'deployer' | 'viewer';
export type Me = { authenticated: false } | { authenticated: true; login: string; role: Role; admin: boolean; deployer: boolean };

export interface EnvStatus {
  up: boolean; db_status?: string | null; redis_status?: string | null; latency_ms?: number; checked_at: string; error?: string; link: string;
}
export interface ServiceStatus { key: string; name: string; repo: string; kind: string; docs?: string; testbed?: EnvStatus; prod?: EnvStatus }
export interface Endpoint { health: string; link: string }
export interface DocMeta { id: string; service: string; title: string }
export interface ToolRepo {
  name: string; description: string; url: string; branch: string; version: string | null;
  last: { sha: string; date: string; message: string; url: string } | null;
  changes: { sha: string; date: string; message: string; author: string; url: string }[];
  meta: {
    kind: string; required?: boolean; install?: string[]; update?: string[]; check?: string; note?: string;
    /** 바로 열어 볼 곳 (문서·릴리스 등) */
    links?: { label: string; url: string }[];
  } | null;
}

export interface ApkAsset { id: number; name: string; size: number; downloads: number }
export interface ApkRelease {
  id: number; tag: string; name: string; date: string; prerelease: boolean; url: string;
  versionCode: number | null; sha256: string | null; buildUrl: string | null; branch: string; assets: ApkAsset[];
  commit?: string | null; server?: string | null;
}
export type ApkStatus = 'knox' | 'qa' | 'new';
export interface ApkVerState { downloads: number; lastDownload?: { at: string; who: string }; knox?: { at: string; by: string }; note?: { text: string; by: string; at: string } }
export interface ApkRepo {
  key: string; repo: string; name: string; logo: string | null; project: string; path: string[]; description: string; url: string;
  /** device-app 은 운영 릴리스와 내부 테스트, store-app(부모앱)은 내부 테스트만(#175). 예전 서버는 보내지 않는다(기기앱) */
  kind?: 'device-app' | 'store-app';
  releases: (ApkRelease & { status: ApkStatus; state: ApkVerState | null })[]; error?: string;
  /** 내부 테스트 빌드(dev 머지마다 테스트배드 서버용으로 빌드, GitHub 프리릴리스) */
  tests?: ApkRelease[];
  knox: { tag: string; at: string; by: string } | null; history: { at: string; by: string; tag: string; action: 'knox' | 'undo' }[];
}
export interface ApkChange { kind: 'feat' | 'fix' | 'perf' | 'other'; title: string; detail?: string; issue?: number; sha: string }
/** 업데이트 내역에서 고를 버전. release 가 false 면 보관함에 파일이 없다. shipped 는 고객에게 출고한 버전(출고 기록), 없으면 내부 빌드 */
export interface ApkVersion { tag: string; date: string; release: boolean; count: number; shipped?: { at: string; channel: string }; label?: string }
export interface ApkShipped { version: string; at: string; channel: string; line?: string; items: { kind: ApkChange['kind']; title: string; detail?: string }[]; note?: string; by?: string; updatedAt?: string }
export const apkApi = {
  changes: (repo: string, tag: string) => j('GET', `/apks/${encodeURIComponent(repo)}/changes?tag=${encodeURIComponent(tag)}`) as Promise<{ tag: string; changes: ApkChange[]; base: string | null; count: number; release: boolean; dev: ApkChange[]; shipped: { at: string; channel: string; note: string | null; by: string | null; updatedAt: string | null } | null; note: { text: string; by: string; at: string } | null; issueUrl: string }>,
  shipped: (repo: string) => j('GET', `/apks/${encodeURIComponent(repo)}/shipped`) as Promise<{ list: ApkShipped[]; rev: number; edited: boolean }>,
  saveShipped: (repo: string, body: { from?: string; rec?: Omit<ApkShipped, 'by' | 'updatedAt'>; remove?: boolean; rev?: number }) => j('POST', `/apks/${encodeURIComponent(repo)}/shipped`, body) as Promise<{ ok: boolean; rev: number }>,
  versions: (repo: string) => j('GET', `/apks/${encodeURIComponent(repo)}/versions`) as Promise<{ versions: ApkVersion[] }>,
  knox: (repo: string, tag: string, by: string, undo = false) => j('POST', `/apks/${encodeURIComponent(repo)}/knox`, { tag, by, undo }) as Promise<{ ok: boolean }>,
  note: (repo: string, tag: string, text: string) => j('POST', `/apks/${encodeURIComponent(repo)}/note`, { tag, text }) as Promise<{ ok: boolean }>,
};
export interface DeployRun {
  id: number; number: number; url: string; workflow: string; branch: string; sha: string; event: string; actor: string;
  at: string; state: string; action?: 'deploy' | 'rollback'; version?: string | null; warn?: string;
}
export interface RollbackFloor { version: string; runId: number; reason: string; by: string; at: string }
export interface TrackView {
  env: 'testbed' | 'prod'; kamal: string; dest: string; current: DeployRun | null; last: DeployRun | null;
  running: DeployRun[]; history: DeployRun[]; candidates: string[]; rollback: { workflow: string; confirm?: string } | null;
  floor: RollbackFloor | null; blocked: Record<string, string>;
}
export interface DeployOverview {
  services: { key: string; name: string; repo: string; repoUrl: string; tracks: Partial<Record<'testbed' | 'prod', TrackView>> }[];
  runners: { name: string; status: string; busy: boolean; labels: string[] }[];
  failures: (DeployRun & { service: string; key: string; env: string })[];
  canRollback: boolean; updatedAt: string;
}
export interface AuditEntry { at: string; login: string; action: string; target: string; detail?: string; ok: boolean; url?: string }
export const apkDownloadUrl = (repo: string, assetId: number) => `/dashapi/apks/${encodeURIComponent(repo)}/${assetId}/download`;

// 테스트배드 API 호출 — 콘솔 API 가 /mxtest/* 를 TESTBED_URL/* 로 대신 부른다(로그인 필요, 비어 있으면 503)
export const TESTBED = '/mxtest';
export async function callTestbed(method: string, path: string, token?: string, body?: string) {
  const started = performance.now();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(TESTBED + (path.startsWith('/') ? path : '/' + path), { method, headers, body: body || undefined, credentials: 'same-origin' });
  const text = await res.text();
  return { status: res.status, ms: Math.round(performance.now() - started), body: text };
}

// ── 카탈로그(#18) ──
export type Kind = 'backend' | 'web' | 'device-app' | 'store-app';
export const KIND_LABEL: Record<Kind, string> = { backend: '백엔드', web: '웹', 'device-app': '기기앱(APK)', 'store-app': '스토어 앱' };
export interface GhRepo { name: string; description: string; updated: string; archived: boolean }
export interface CatalogComponent {
  key: string; name: string; kind: Kind; repo: string; project: string; order: number; logo: string | null; ownLogo: string | null; note?: string;
  testbed?: Endpoint; prod?: Endpoint; docs?: string; db?: string; deployable: { testbed: boolean; prod: boolean };
  store?: { workflow: string; tagPrefix: string }; builtin: boolean;
}
export interface CatalogNode {
  id: string; type: 'group' | 'project'; name: string; parent: string | null; order: number; logo: string | null; ownLogo: string | null; builtin: boolean;
  children: CatalogNode[]; components: CatalogComponent[];
}
export interface Catalog { rev: number; roots: CatalogNode[]; components: CatalogComponent[]; warning: string | null }
export type CatalogOp =
  | { op: 'node.add'; type: 'group' | 'project'; name: string; parent?: string | null }
  | { op: 'node.update'; id: string; name?: string; logo?: string | null; parent?: string | null; order?: number }
  | { op: 'node.delete'; id: string }
  | { op: 'comp.add'; name: string; kind: Kind; repo?: string; parent: string; note?: string }
  | { op: 'comp.update'; key: string; name?: string; logo?: string | null; parent?: string; order?: number; note?: string }
  | { op: 'comp.delete'; key: string }
  | { op: 'reset'; node?: string; key?: string };
export interface PubNode { id: string; type: string; name: string; logo: string | null; children: PubNode[]; components: { key: string; name: string; repo: string; logo: string | null }[] }
export const logoUrl = (file: string) => `/dashapi/pub/logos/${file}`;

export function walkNodes(roots: CatalogNode[], fn: (n: CatalogNode, path: CatalogNode[]) => void, path: CatalogNode[] = []) {
  for (const n of roots) { fn(n, path); walkNodes(n.children, fn, [...path, n]); }
}
export function projectPath(roots: CatalogNode[], id: string): string[] {
  let out: string[] = [];
  walkNodes(roots, (n, path) => { if (n.id === id) out = [...path.map((p) => p.name), n.name]; });
  return out;
}

// ── 권한 ──
export interface AccessPerson {
  login: string; fullName: string; avatar: string; email: string; member: boolean; role: Role; root: boolean; board: boolean | null; by: string | null; at: string | null;
}
export interface AccessList { rev: number; people: AccessPerson[]; boardEnabled: boolean; warning: string | null }
export const ROLE_LABEL: Record<Role, string> = { admin: '관리자', deployer: '배포 담당', viewer: '보기' };

// ── 빌드 알림 받는 사람(#187) ──
export interface BuildNotifyRecipient { email: string; by: string; at: string }
export interface BuildNotify { rev: number; on: boolean; to: BuildNotifyRecipient[]; by: string | null; at: string | null; warning: string | null }

// ── 스토어 앱(부모앱) ──
export type StoreLane = 'ota' | 'store' | 'dry-run' | 'none' | 'failed';
export interface StoreRun { id: number; number: number; url: string; at: string; actor: string; event: string; sha: string; title: string; state: string; lane: StoreLane | null; runner: string | null }
export interface StoreAppView {
  key: string; repo: string; repoUrl: string; workflow: string; storeVersion: string | null; storeTagUrl: string | null; storeAt: string | null;
  lastStore: StoreRun | null; lastOta: StoreRun | null; last: StoreRun | null; running: StoreRun[]; history: StoreRun[]; error?: string;
}
export const LANE_LABEL: Record<StoreLane, string> = { ota: 'OTA', store: '스토어', 'dry-run': '시험(dry-run)', none: '변경 없음', failed: '실패' };

// ── 러너(콘솔 개편 C) ──
export interface RunnerJob { id: number; repo: string; name: string; status: string; conclusion: string | null; runner: string | null; labels: string[]; created: string | null; started: string | null; completed: string | null; url: string }
export interface RunnerUsage { repo: string; file: string; workflow: string; job: string; labels: string[]; via: string | null; triggers: string[]; components: { key: string; name: string; logo: string | null }[] }
export interface RunnerAlert { level: 'red' | 'amber'; text: string }
export interface RunnerInfo {
  id: number; name: string; status: 'online' | 'offline'; busy: boolean; disabled: boolean; labels: string[];
  where: string; kind: string; note?: string; guess?: boolean; capacity?: number;
  uses: RunnerUsage[]; spof: string[]; alerts: string[]; uptime: { ratio: number; since: string } | null;
  stats: { count24h: number; success24h: number; failure24h: number; avgSec24h: number | null; lastAt: string | null; lastJob: RunnerJob | null; active: RunnerJob[] };
}
export interface RunnersView {
  source: 'admin' | 'org'; runners: RunnerInfo[]; orphans: RunnerUsage[]; queue: { count: number; oldestSec: number | null; jobs: RunnerJob[] };
  alerts: RunnerAlert[]; scannedAt: string | null; updatedAt: string; error?: string;
}
// ── 시크릿·변수(#21) ── 값은 오지 않는다(변수만 값이 있다)
export type Perm = 'owner' | 'admin' | 'write' | 'read' | 'none';
export interface SecretUsage { repo: string; workflow: string; via?: string; optional?: boolean }
export interface SecretItem {
  scope: string; kind: 'secret' | 'variable'; name: string; created?: string | null; description?: string; value?: string;
  usedBy: SecretUsage[]; status: 'used' | 'unused' | 'missing' | 'optional'; overrides?: boolean; overriddenIn?: string[];
}
export interface SecretPerson { login: string; perm: Perm; why: string[]; manage: boolean; use: boolean }
export interface SecretRepo { repo: string; archived: boolean; defaultBranch: string; workflows: string[]; templates: string[]; templateFiles: string[]; people: SecretPerson[]; error?: string }
export interface SecretsOverview {
  updatedAt: string; org: string; items: SecretItem[]; repos: SecretRepo[]; orgOwners: string[];
  teams: { name: string; permission: Perm; allRepos: boolean; members: string[] }[];
  write: { repo: boolean; org: boolean; reason: string | null }; warnings: string[];
}
export interface SecretWrite { scope: 'org' | 'repo'; repo?: string; kind: 'secret' | 'variable'; name: string; confirm?: string }

// ── 전체 도식·실시간 배포(#23) ──
export type LaneKind = 'testbed' | 'prod' | 'apk' | 'store' | 'apptest';  // apptest: 앱 테스트 빌드(#182)
export interface FlowStep { name: string; status: string; conclusion?: string | null; started_at?: string | null; completed_at?: string | null }
export interface ActiveRun {
  id: number; repo: string; workflow: string; url: string; number: number; title: string; actor: string; event: string; branch: string;
  startedAt: string; endedAt: string | null; state: string; comps: string[]; lane: LaneKind; ambiguous: boolean;
  stage: { index: number; current: string | null; done: number; total: number; failedStep: string | null; branch?: 'ota' | 'store' };
  jobs: { id: number; name: string; status: string; conclusion: string | null; steps: FlowStep[] }[];
}
export interface FlowInfra { id: string; kind: string; name: string; sub?: string; discovered?: boolean }
export interface FlowGraph {
  projects: CatalogNode[]; components: CatalogComponent[]; infra: FlowInfra[]; virtual: FlowInfra[];
  lanes: { id: string; comp: string; lane: LaneKind; path: string[] }[];
  relations: { id: string; from: string; to: string; via: string; state: string }[];
  stages: Record<LaneKind, { id: string; label: string }[]>;
}
export interface RelEdge { id: string; from: string; to: string; via: string; state: 'auto' | 'confirmed' | 'rejected' | 'manual'; evidence: { path: string; line: number; text: string }[]; firstSeen?: string; note?: string }
export interface RelGraph {
  rev: number; scannedAt: string; scanning: boolean; nodes: FlowInfra[]; edges: RelEdge[];
  unknown: { comp: string; host: string; evidence: { path: string; line: number; text: string }[] }[];
  scans: Record<string, { at: string; files: number; error?: string }>;
}
export const flowApi = {
  graph: () => j('GET', '/flow') as Promise<FlowGraph>,
  live: () => j('GET', '/flow/live') as Promise<{ at: string; runs: ActiveRun[] }>,
  stepLog: (repo: string, run: number, step?: string) => j('GET', `/flow/step-log?repo=${encodeURIComponent(repo)}&run=${run}${step ? '&step=' + encodeURIComponent(step) : ''}`) as Promise<{ job: string | null; step: string | null; log: string }>,
  tail: (repo: string, run: number) => j('GET', `/flow/tail?repo=${encodeURIComponent(repo)}&run=${run}`) as Promise<{ job: string | null; step: string | null; stepStarted: string | null; lines: string[] }>,
  relations: () => j('GET', '/relations') as Promise<RelGraph>,
  decide: (b: Record<string, unknown>) => j('POST', '/relations/decide', b) as Promise<{ ok: boolean; rev: number }>,
  rescan: (keys?: string[]) => j('POST', '/relations/rescan', { keys }) as Promise<{ ok: boolean }>,
};
export const LANE_COLOR: Record<LaneKind, string> = { testbed: '#2563eb', prod: '#059669', apk: '#d97706', store: '#7c3aed', apptest: '#0891b2' };
export const LANE_NAME: Record<LaneKind, string> = { testbed: '테스트배드', prod: '운영', apk: '기기앱 APK', store: '부모앱 OTA, 스토어', apptest: '앱 테스트 빌드' };

// ── 배포 이력·운영 승격(#23) ──
export interface HistoryRow {
  id: string; comp: string; repo: string; env: 'testbed' | 'prod' | 'release' | 'apk'; kind: string; version: string | null; state: string; actor: string;
  at: string; ended: string | null; sec: number | null; url: string; number: number | null; runId: number | null; workflow: string; event: string; warn: string | null;
  resolved?: string | null;   // 실패 뒤 처음 성공한 시각 — 해결됨
}
export interface PromotePlan { method: 'merge-push' | 'merge-dispatch'; source: 'testbed' | 'dev'; watch: string; confirm: string; lane: 'prod' | 'apk' | 'store'; dispatch?: { workflow: string; ref: string; inputs: Record<string, string> } }
export interface PromoteItem {
  key: string; name: string; repo: string; plan: PromotePlan; error?: string;
  version?: string | null; sha?: string | null; testbedAt?: string | null; testbedHealth?: { up: boolean | null; since: string | null; downs24h: number; tracked: string | null } | null;
  prodVersion?: string | null; prodAt?: string | null; prodRunning?: boolean; mainSha?: string | null;
  ahead?: { sha: string; message: string; author: string }[]; aheadCount?: number; mainOnly?: number;
}
export interface Schedule {
  id: string; comp: string; repo: string; version: string; sha: string; at: string; by: string; createdAt: string;
  state: 'scheduled' | 'running' | 'done' | 'failed' | 'cancelled'; plan: PromotePlan; log: { at: string; msg: string; ok?: boolean }[];
  pr?: { number: number; url: string }; run?: { id: number; url: string }; result?: string;
}
export const promoteApi = {
  history: () => j('GET', '/deploy/history') as Promise<{ rows: HistoryRow[]; audit: AuditEntry[]; updatedAt: string }>,
  candidates: () => j('GET', '/promote') as Promise<{ items: PromoteItem[]; schedules: Schedule[]; canRun: boolean }>,
  schedule: (b: { comp: string; version: string; at: string; confirm: string }) => j('POST', '/promote/schedule', b) as Promise<Schedule>,
  cancel: (id: string) => j('DELETE', `/promote/schedule/${encodeURIComponent(id)}`) as Promise<{ ok: boolean }>,
};

// ── 서버(#28) ──
export interface ProbeContainer { name: string; image: string; state: string; status: string; created: string; cpu?: number; memBytes?: number; memLimit?: number; memPct?: number; net?: string; block?: string }
export interface ServerView {
  id: string; name: string; short: string; sub?: string; ip: string | null; domains: string[]; note: string; node: string | null; repo: string; key: string; services: { kamal: string; comp: string }[];
  at: string | null; run: string | null; reachable: boolean | null;
  probe: null | { host: string; now: string; uptimeSec: number; cpus: number; load: [number, number, number]; mem: { total: number; available: number; swapTotal: number; swapFree: number };
    disks: { fs: string; size: number; used: number; avail: number; pct: number; mount: string }[]; containers: ProbeContainer[] };
  alerts: { level: 'warn' | 'bad'; text: string }[]; history: { at: string; load1: number; memPct: number; diskPct: number }[];
  pending: { at: number; action: string; target: string; by: string }[];
}
export const serversApi = {
  list: () => j('GET', '/servers') as Promise<{ servers: ServerView[]; restarts: { at: string; server: string; target: string; by: string; status: string }[]; canRun: boolean }>,
  probe: (id: string) => j('POST', `/servers/${id}/probe`) as Promise<{ ok: boolean }>,
  requestLogs: (id: string, target: string, lines = 300) => j('POST', `/servers/${id}/logs`, { target, lines }) as Promise<{ ok: boolean }>,
  logs: (id: string, target: string) => j('GET', `/servers/${id}/logs?target=${encodeURIComponent(target)}`) as Promise<{ at: string | null; container: string | null; lines: string[]; pending: boolean }>,
  restart: (id: string, target: string, confirm: string) => j('POST', `/servers/${id}/restart`, { target, confirm }) as Promise<{ ok: boolean }>,
};

/** 되돌리기 목록의 버전 설명 — added: 그 버전에서 들어온 변경, dropped: 그 버전으로 되돌리면 빠지는 변경(null = 읽지 못함) */
export interface VersionNotes { current: string | null; versions: { version: string; added: ApkChange[] | null; dropped: ApkChange[] | null }[]; issueUrl: string }

// 기능 스위치 (#66)
export type FlagEnv = 'testbed' | 'prod';
export interface FlagView { key: string; description: string; defaultValue: boolean; enabled: boolean; overridden: boolean; updatedBy: string | null; updatedAt: string | null }
export interface FlagRow { key: string; description: string; defaultValue: boolean; envs: Partial<Record<FlagEnv, FlagView | null>> }
export type FlagSummary = Record<string, { env: FlagEnv; on: number }[]>;
export interface FlagsOverview {
  services: { comp: string; envs: { env: FlagEnv; configured: boolean; ok: boolean; error?: string; loadedAt?: string | null }[]; rows: FlagRow[] }[];
  updatedAt: string;
}
