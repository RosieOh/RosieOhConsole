// 로컬 확인용 가짜 콘솔 API. 운영 데이터·GitHub 토큰 없이 화면만 보려고 쓴다.
//   node dev/mock-api.mjs      (8087 — vite.config.ts 의 /dashapi 프록시 대상)
//   npm run dev                (다른 터미널)
// 모르는 경로는 404 + 터미널에 찍는다. 화면이 비면 터미널을 보고 여기에 응답을 추가한다.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 8087);
const now = Date.now();
const iso = (minsAgo = 0) => new Date(now - minsAgo * 60_000).toISOString();
const GB = 1024 ** 3;

const LOGINS = ['RosieOh', 'alice', 'bob', 'carol'];

// ── 카탈로그 ──────────────────────────────────────────────
const COMPS = [
  ['trove', 'Trove', 'trove', 'Trove'],
  ['illinare-api', 'Illinare 백엔드', 'Illinare', 'Illinare'],
  ['illinare-web', 'Illinare 웹', 'Illinare', 'Illinare'],
  ['roundhouse', 'RoundHouse 게이트웨이', 'RoundHouse', 'RoundHouse'],
  ['vecshift', 'VecShift', 'VecShift', 'VecShift'],
  ['toss-api', '토스 결제 서버', 'tossApi', '결제'],
  ['kopring-core', 'Kopring Core', 'Kopring_Core', 'Kopring'],
  ['console', 'Rosie 콘솔', 'mx-console', '콘솔'],
].map(([key, name, repo, project], i) => ({
  key, name, repo, project, order: i, logo: null, ownLogo: null, builtin: true,
  kind: 'backend', deployable: { testbed: true, prod: true },
  prod: { health: `https://${repo.toLowerCase()}.example.com/health`, link: `https://${repo.toLowerCase()}.example.com` },
  testbed: { health: `https://dev.example.com/${repo.toLowerCase()}/health`, link: `https://dev.example.com/${repo.toLowerCase()}` },
}));
const PROJECTS = [...new Set(COMPS.map((c) => c.project))];
const ROOTS = [{
  id: 'g-mx', type: 'group', name: 'RosieOh', parent: null, order: 0, logo: null, ownLogo: null, builtin: true, components: [],
  children: PROJECTS.map((p, i) => ({
    id: 'p-' + p, type: 'project', name: p, parent: 'g-mx', order: i, logo: null, ownLogo: null, builtin: true,
    children: [], components: COMPS.filter((c) => c.project === p),
  })),
}];

// ── 서버 ──────────────────────────────────────────────────
const container = (name, i, running, mem, lim) => ({
  name, image: `ghcr.io/rosieoh/${name.split('-web-')[0]}:latest`,
  state: running ? 'running' : 'exited',
  status: running ? (i === 0 ? 'Up 26 hours (healthy)' : `Up ${7 + i} days`) : `Exited (143) ${26 + i} hours ago`,
  created: iso(60 * 24 * (i + 1)),
  cpu: running ? Number((Math.random() * 0.4).toFixed(2)) : undefined,
  memBytes: running ? mem : undefined, memLimit: running ? lim : undefined,
});

// 7일치 추이 — 스파크라인이 비지 않게
const history = (base) => Array.from({ length: 7 * 24 }, (_, i) => ({
  at: iso((7 * 24 - i) * 60),
  load1: Number((base.load * (0.6 + Math.random() * 0.9)).toFixed(2)),
  memPct: Math.round(base.mem + Math.sin(i / 9) * 6 + Math.random() * 3),
  diskPct: Math.round(base.disk + i / 90),
}));

const SPEC = [
  ['prod-1', '운영 서버 1', '203.0.113.10', ['trove.example.com'], 2, 4.1, 58, 69, [['trove', 'trove']]],
  ['prod-2', '운영 서버 2', '203.0.113.11', ['illinare.example.com'], 2, 4.1, 45, 39, [['illinare-api', 'illinare-api'], ['illinare-web', 'illinare-web']]],
  ['gateway', 'LLM 게이트웨이', '203.0.113.20', ['roundhouse.example.com'], 4, 8.2, 62, 51, [['roundhouse', 'roundhouse']]],
  ['home', '집 서버', '192.0.2.24', [], 4, 8.2, 47, 31, [['console', 'console']]],
  ['testbed', '테스트배드', '203.0.113.30', ['dev.example.com'], 2, 4.1, 64, 44, []],
];

const SERVERS = SPEC.map(([id, short, ip, domains, cpus, memGb, memPct, diskPct, svcs], si) => {
  const total = memGb * GB;
  const size = 51.8 * GB;
  const kamal = svcs[0]?.[0];
  const containers = kamal ? [
    container(`${kamal}-web-prod-2632831303a2`, 0, true, 0.38 * GB, Math.min(total, 2.1 * GB)),
    container(`${kamal}-web-prod-1cf655adbb60`, 1, false),
    container(`${kamal}-web-prod-c315ea3069f1`, 2, false),
    container('kamal-proxy', 3, true, 0.015 * GB, Math.min(total, 2.1 * GB)),
    container(`${kamal}-promtail`, 4, true, 0.036 * GB, Math.min(total, 2.1 * GB)),
  ] : [container('node-exporter', 0, true, 0.02 * GB, total), container('promtail', 1, true, 0.03 * GB, total)];
  const alerts = diskPct >= 85 ? [{ level: 'bad', text: `디스크 / ${diskPct}% — 85% 를 넘었습니다` }]
    : diskPct >= 65 ? [{ level: 'warn', text: `디스크 / ${diskPct}% — 곧 찹니다` }] : [];
  return {
    id, name: `${short} 운영 서버`, short, ip, domains, note: kamal ? 'kamal-proxy TLS' : '',
    node: 'p-' + (COMPS.find((c) => c.key === svcs[0]?.[1])?.project ?? 'RosieOh'),
    repo: kamal ?? 'mx-console', key: id,
    services: svcs.map(([k, comp]) => ({ kamal: k, comp })),
    at: iso(8 + si), run: 'https://github.com/RosieOh/x/actions/runs/1', reachable: true,
    probe: {
      host: short, now: iso(8 + si), uptimeSec: 86400 * (120 + si), cpus,
      load: [0.08, 0.02, 0], mem: { total, available: total * (1 - memPct / 100), swapTotal: 0, swapFree: 0 },
      disks: [{ fs: '/dev/vda1', size, used: size * diskPct / 100, avail: size * (1 - diskPct / 100), pct: diskPct, mount: '/' }],
      containers,
    },
    alerts, history: history({ load: 0.2 + si / 10, mem: memPct, disk: diskPct }), pending: [],
  };
});

// ── 배포 ──────────────────────────────────────────────────
const run = (i, key, env, state) => ({
  id: 1000 + i, number: 40 - i, url: 'https://github.com/RosieOh/x/actions/runs/' + (1000 + i),
  workflow: 'deploy.yml', branch: env === 'prod' ? 'main' : 'dev', sha: Math.random().toString(16).slice(2, 10),
  event: 'push', actor: LOGINS[i % LOGINS.length], at: iso(45 + i * 70), state,
  action: 'deploy', version: Math.random().toString(16).slice(2, 9),
});
const DEPLOY = {
  services: COMPS.map((c, i) => ({
    key: c.key, name: c.name, repo: c.repo, repoUrl: `https://github.com/RosieOh/${c.repo}`,
    tracks: {
      prod: { env: 'prod', kamal: c.repo, dest: 'prod', current: run(i, c.key, 'prod', 'success'), last: run(i, c.key, 'prod', 'success'),
        running: [], history: [run(i, c.key, 'prod', 'success'), run(i + 9, c.key, 'prod', i === 2 ? 'failure' : 'success')],
        candidates: [], rollback: { workflow: 'rollback.yml' }, floor: null, blocked: {} },
      testbed: { env: 'testbed', kamal: c.repo, dest: 'dev', current: run(i + 3, c.key, 'testbed', 'success'), last: run(i + 3, c.key, 'testbed', 'success'),
        running: [], history: [run(i + 3, c.key, 'testbed', 'success'), run(i + 12, c.key, 'testbed', 'success')],
        candidates: [], rollback: null, floor: null, blocked: {} },
    },
  })),
  runners: [{ name: 'lan24-1', status: 'idle', busy: false, labels: ['self-hosted'] }],
  failures: [], canRollback: true, updatedAt: iso(1),
};

const STATUS = COMPS.map((c) => ({
  key: c.key, name: c.name, repo: c.repo, kind: 'backend',
  prod: { up: true, db_status: 'ok', redis_status: 'ok', latency_ms: 40 + Math.round(Math.random() * 90), checked_at: iso(1), link: c.prod.link },
  testbed: { up: true, db_status: 'ok', redis_status: 'ok', latency_ms: 50 + Math.round(Math.random() * 90), checked_at: iso(1), link: c.testbed.link },
}));

const APKS = ['데모 기기앱', 'DriverCare', 'Pok-Log 앱', '키오스크'].map((name, i) => ({
  key: 'apk-' + i, repo: 'app-' + i, name, logo: null, project: 'RosieOh', path: ['RosieOh'], description: '',
  url: '#', history: [], tests: [],
  knox: i === 0 ? { tag: `v1.${i}.0`, at: iso(1500), by: 'RosieOh' } : null,
  releases: [{ id: i, tag: `v1.${i}.0`, name, date: iso(60 * (i + 1)), prerelease: false, url: '#',
    versionCode: 100 + i, sha256: 'a'.repeat(64), buildUrl: null, branch: 'main',
    assets: [{ id: 900 + i, name: `app-${i}-v1.${i}.0.apk`, size: (40 + i * 9) * 1024 * 1024, downloads: 3 + i }],
    status: i === 0 ? 'knox' : i === 1 ? 'qa' : 'new',
    state: { downloads: 3 + i, lastDownload: { at: iso(300), who: 'RosieOh' } } }],
}));

// ── 라우팅 ────────────────────────────────────────────────
const LOGS = [
  '[info] boot: listening on 0.0.0.0:3000',
  '[info] db: pool ready (10)',
  '[warn] WARN slow query 1.2s  SELECT * FROM lessons',
  '[info] GET /health 200 3ms',
  '[error] ERROR Unhandled rejection: Timeout connecting to redis',
  '[info] redis: reconnected',
  ...Array.from({ length: 20 }, (_, i) => `[info] GET /api/v1/items?page=${i} 200 ${8 + i}ms`),
];

const ROUTES = [
  // MOCK_ANON=1 이면 로그인 전 화면(로그인·회원가입)을 본다
  ['GET', /^\/me$/, () => (process.env.MOCK_ANON === '1' ? { authenticated: false } : { authenticated: true, login: 'RosieOh', name: 'Rosie Oh', role: 'admin', admin: true, deployer: true })],
  ['POST', /^\/logout$/, () => ({ ok: true })],
  ['GET', /^\/users$/, () => ({ users: LOGINS.map((l) => ({ login: l, fullName: l, avatar: '' })) })],
  ['GET', /^\/catalog$/, () => ({ rev: 1, roots: ROOTS, components: COMPS, warning: null })],
  ['GET', /^\/pub\/catalog$/, () => ({ roots: ROOTS })],
  ['GET', /^\/servers$/, () => ({ servers: SERVERS, canRun: true,
    restarts: [{ at: iso(120), server: 'prod-1', target: 'trove', by: 'RosieOh', status: '성공' }] })],
  ['POST', /^\/servers\/[^/]+\/probe$/, () => ({ ok: true })],
  ['POST', /^\/servers\/[^/]+\/logs$/, () => ({ ok: true })],
  ['GET', /^\/servers\/[^/]+\/logs$/, (u) => ({ at: iso(0), container: u.searchParams.get('target'), lines: LOGS, pending: false })],
  ['POST', /^\/servers\/[^/]+\/restart$/, () => ({ ok: true })],
  ['GET', /^\/status$/, () => ({ services: STATUS })],
  ['GET', /^\/deploy$/, () => DEPLOY],
  ['GET', /^\/deploy\/audit$/, () => ({ entries: [] })],
  ['GET', /^\/deploy\/history$/, () => ({ rows: [], audit: [], updatedAt: iso(1) })],
  ['GET', /^\/deploy\/store-apps$/, () => ({ apps: [] })],
  ['GET', /^\/deploy\/versions$/, () => ({ current: null, versions: [], issueUrl: '#' })],
  ['GET', /^\/apks$/, () => ({ apps: APKS })],
  ['GET', /^\/promote$/, () => ({ items: [], schedules: [], canRun: true })],
  // 도식·시크릿은 모양이 까다롭다 — 빈 배열만 주면 화면이 터진다(walk/find)
  ['GET', /^\/flow$/, () => ({
    projects: ROOTS[0].children, components: COMPS, infra: [], virtual: [],
    lanes: COMPS.flatMap((c) => [
      { id: `${c.key}:testbed`, comp: c.key, lane: 'testbed', path: [] },
      { id: `${c.key}:prod`, comp: c.key, lane: 'prod', path: [] },
    ]),
    relations: [],
    stages: {
      testbed: [{ id: 'build', label: '빌드' }, { id: 'deploy', label: '배포' }, { id: 'health', label: '헬스' }],
      prod: [{ id: 'build', label: '빌드' }, { id: 'deploy', label: '배포' }, { id: 'health', label: '헬스' }],
      apk: [{ id: 'build', label: '빌드' }, { id: 'release', label: '릴리스' }],
      store: [{ id: 'build', label: '빌드' }, { id: 'review', label: '심사' }, { id: 'live', label: '출시' }],
    },
  })],
  ['GET', /^\/flow\/live$/, () => ({ at: iso(0), runs: [] })],
  ['GET', /^\/relations$/, () => ({ rev: 1, scannedAt: iso(30), scanning: false,
    nodes: [], edges: [], unknown: [], scans: {} })],
  ['GET', /^\/runners$/, () => ({ runners: [], alerts: [], updatedAt: iso(1) })],
  ['GET', /^\/runners\/alerts$/, () => ({ alerts: [], updatedAt: iso(1) })],
  ['GET', /^\/flags$/, () => ({ services: [], updatedAt: iso(1) })],
  ['GET', /^\/flags\/summary$/, () => ({})],
  ['GET', /^\/access$/, () => ({ rev: 1, boardEnabled: true, warning: null,
    people: [...LOGINS, 'jspark', 'jwchae', 'kimjin', 'sjryu', 'vrsoft'].map((login, i) => ({
      login, fullName: login, avatar: '', email: `${login}@example.com`, member: true,
      role: i === 0 ? 'admin' : i === 1 ? 'admin' : i % 3 === 0 ? 'deployer' : 'viewer',
      root: i === 1, board: i % 4 !== 3, by: i === 0 ? null : 'RosieOh', at: i === 0 ? null : iso(3000),
    })) })],
  ['GET', /^\/secrets$/, () => ({
    updatedAt: iso(1), org: 'RosieOh', orgOwners: ['RosieOh'], warnings: [],
    write: { repo: true, org: false, reason: '쓰기 토큰에 조직 권한이 없습니다' },
    teams: [{ name: 'RosieOh', permission: 'write', allRepos: true, members: LOGINS }],
    repos: [...new Set(COMPS.map((c) => c.repo))].map((repo) => ({
      repo, archived: false, defaultBranch: 'main',
      workflows: ['deploy.yml', 'probe.yml'], templates: ['RosieOh/workflows/deploy.yml'], templateFiles: [],
      people: LOGINS.map((login) => ({ login, perm: login === 'RosieOh' ? 'admin' : 'write',
        why: ['저장소 협업자'], manage: login === 'RosieOh', use: true })),
    })),
    items: [
      { scope: 'org', kind: 'secret', name: 'DEPLOY_TOKEN', created: iso(9000), status: 'used',
        usedBy: [{ repo: 'mx-console', workflow: 'deploy.yml' }] },
      { scope: 'org', kind: 'secret', name: 'PROBE_TOKEN', created: iso(9000), status: 'used',
        usedBy: [{ repo: 'Illinare', workflow: 'probe.yml', via: null }] },
      { scope: 'mx-console', kind: 'secret', name: 'DEV_SSH_KEY', created: iso(400), status: 'used',
        overrides: true, overriddenIn: ['Illinare'], usedBy: [{ repo: 'mx-console', workflow: 'deploy.yml' }] },
      { scope: 'org', kind: 'variable', name: 'REGISTRY_HOST', created: iso(5000), status: 'unused', usedBy: [] },
    ],
  })],
  ['GET', /^\/tools$/, () => ({ repos: [] })],
  // 개발 가이드 — 문장 속 코드 조각(`code`)이 어떻게 보이는지 확인할 거리가 필요하다
  ['GET', /^\/docs$/, () => ({ docs: [
    { id: 'getting-started', service: '가이드', title: '개발 환경 시작하기' },
    { id: 'auth', service: '가이드', title: '인증 / 토큰 사용법' },
  ] })],
  ['GET', /^\/docs\/[^/]+$/, (u) => {
    const id = u.pathname.split('/').pop();
    const md = id === 'auth'
      ? `## 인증 / 토큰 사용법\n\n- 보호 API 는 \`Authorization: Bearer <JWT>\` 헤더가 필요합니다.\n- 성공 응답 대부분은 \`{ "success": true, "data": ... }\` 이고, 오류는 \`{ "success": false, "message": ... }\` 입니다.\n- Spring 서비스는 \`/<svc>/actuator/health\` (db·redis 상태 포함).\n- 원본: \`/<svc>/v3/api-docs\` (JSON).\n`
      : `## 개발 환경 시작하기\n\n테스트배드(TESTBED_URL)에 백엔드를 경로별로 띄워 둔 **개발기**입니다.\n\n- 헬스: \`/<svc>/actuator/health\`\n- API 문서: \`/<svc>/v3/api-docs\`\n`;
    return { id, title: id === 'auth' ? '인증 / 토큰 사용법' : '개발 환경 시작하기', markdown: md };
  }],
];

createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const path = u.pathname.replace(/^\/dashapi/, '');
  const hit = ROUTES.find(([m, re]) => m === req.method && re.test(path));
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
    console.log(`${code === 200 ? ' ' : '!'} ${req.method} ${u.pathname}${u.search}`);
  };
  if (!hit) return send(404, { message: `mock: ${req.method} ${path} 응답이 없습니다 — dev/mock-api.mjs 의 ROUTES 에 추가하세요` });
  send(200, hit[2](u));
}).listen(PORT, () => console.log(`가짜 콘솔 API → http://localhost:${PORT}/dashapi  (다른 터미널에서 npm run dev)`));

// ── 업무보드(/board/api) ──────────────────────────────────
// 한 서버가 콘솔과 보드를 같이 서빙한다(운영과 같은 모양). 보드는 #148 로 콘솔
// 안에 들어왔고, 화면은 /#board 다. API 경로는 그대로 /board/api/… 를 쓴다.
const CARD_TITLES = [
  ['mx-console', '사이드 패널 글자가 뒤 카드와 겹쳐 안 읽힘', 'RosieOh', 'review'],
  ['mx-console', '다크에서 데스크 카드 아이콘이 안 보인다', 'RosieOh', 'ready_to_merge'],
  ['Illinare', '알림이 자정에 한 번 더 간다', 'alice', 'started'],
  ['trove', '검색 결과 캐시가 안 지워짐', 'carol', 'started'],
  ['tossApi', '결제 취소 웹훅이 두 번 들어온다', 'bob', 'review'],
  ['RoundHouse', '게이트웨이 디스크 85% 경보', 'alice', 'awaiting_deploy'],
  ['VecShift', '임베딩 교체 중 검색 지연', 'carol', 'deployed'],
  ['Kopring_Core', '공통 응답 포맷 정리', 'bob', 'planned'],
  ['mx-console', 'APK 보관함 다운로드 수가 안 올라감', 'alice', 'intake'],
  ['DevShiplog', '글 목록 그래프 범례 겹침', 'RosieOh', 'planned'],
  ['RoundHouse', '요청 중 새로고침하면 스트림이 끊긴다', 'bob', 'done'],
  ['VecShift', '컬렉션 별칭 전환 실패 대응', 'carol', 'done'],
  ['tossApi', '실패 로그에 이메일이 남는다', 'alice', 'cancelled'],
  ['Illinare', '이미지 지연 로딩', 'RosieOh', 'unstaged'],
];
const FLAGS_BY = { RoundHouse: ['overdue'], tossApi: ['ci_failed'], Illinare: ['blocked'] };
const BOARD_CARDS = CARD_TITLES.map(([repo, title, who, stage], i) => ({
  repo, number: 100 + i, title, url: `https://github.com/RosieOh/${repo}/issues/${100 + i}`,
  assignees: [who], milestone: '', due: i % 5 === 0 ? iso(-60 * 24 * 3) : null,
  overdue: i % 7 === 0, stale: i % 9 === 0,
  flags: i % 4 === 0 ? (FLAGS_BY[repo] ?? []) : [],
  stage, human: i % 3 === 0 ? stage : null, manual: i % 3 === 0,
  derivedStage: stage, prevStage: null, evidence: [`라벨 단계/${stage}`], disagree: false, dupStage: false,
}));
// 칸 이름은 서버가 준다 — 화면의 STAGE_KO 와 같은 값이어야 한다
const COLS = [['intake', '접수'], ['planned', '계획'], ['started', '착수'], ['review', '리뷰 중'],
  ['ready_to_merge', '머지 대기'], ['awaiting_deploy', '배포 대기'], ['deployed', '운영 반영'],
  ['done', '완료'], ['cancelled', '취소']];
const BOARD = {
  columns: COLS.map(([key, title]) => ({ key, title, cards: BOARD_CARDS.filter((c) => c.stage === key) })),
  batchAt: iso(35), counts: {}, warning: '', readonly: false,
  unlinkedAt: iso(35),
  unlinked: [
    { kind: 'pr', repo: 'Illinare', number: 77, title: '알림 중복 수정', author: 'alice', updated: iso(120), url: '#', draft: false },
    { kind: 'branch', repo: 'trove', branch: 'carol/search-cache', title: 'carol/search-cache', author: 'carol', updated: iso(400), url: '#' },
  ],
};
const REPORT_REPOS = [['Illinare'], ['trove'], ['RoundHouse']];
const REPORT = {
  ok: true, week: '2026-W42', weekFound: true, legacyRemoved: 0,
  projects: ['Illinare', 'Trove', 'RoundHouse'].map((name, i) => ({
    name, repos: REPORT_REPOS[i], milestone: '',
    tasks: BOARD_CARDS.filter((c) => REPORT_REPOS[i].includes(c.repo))
      .map((c) => ({ repo: c.repo, number: c.number, title: c.title, stage: c.stage, prevStage: null,
        assignees: c.assignees, overdue: c.overdue, stale: c.stale, flags: c.flags, url: c.url })),
    auto: `${name} — 이번 주 진행 상황입니다.`, text: i === 1 ? 'Trove 검색 속도 개선은 운영 반영까지 끝났습니다.' : '',
    edited: i === 1, editedBy: i === 1 ? 'RosieOh' : null, editedAt: i === 1 ? iso(300) : null,
    reflectedAt: null, reflectedBy: null, sheetText: '', warnings: [], status: i === 1 ? 'edited' : 'auto',
  })),
};
ROUTES.push(
  ['GET', /^\/board\/api\/board$/, () => BOARD],
  ['GET', /^\/board\/api\/me$/, () => ({ login: 'RosieOh', admin: true, viewer: true })],
  ['GET', /^\/board\/api\/report$/, () => REPORT],
  ['GET', /^\/board\/api\/viewers$/, () => ({ viewers: LOGINS, admins: ['RosieOh'], candidates: [...LOGINS, 'dave', 'erin'] })],
  ['GET', /^\/board\/api\/repos$/, () => ({ tracked: [...new Set(CARD_TITLES.map((c) => c[0]))].map((repo) => ({ repo, type: 'backend' })),
    results: [], types: { backend: '백엔드', web: '웹', app: '기기앱' }, org: 'RosieOh' })],
  ['POST', /^\/board\/api\/(move|blocked|follow|state|viewers|repos|report)$/, () => ({ ok: true, labels: [], blocked: true })],
);

// ── 회원(로그인·가입·마이페이지·회원 관리) ─────────────────
const ACCOUNT = {
  login: 'rosieoh', name: 'Rosie Oh', email: 'rosie@example.com', github: 'RosieOh', status: 'active', createdAt: iso(60 * 24 * 30),
  via: 'github', lastLoginAt: iso(3), sv: 0, hasPassword: false, role: 'admin', root: true,
  history: [
    { at: iso(3), via: 'github', ip: '203.0.113.7', ok: true },
    { at: iso(60 * 26), via: 'github', ip: '203.0.113.7', ok: true },
    { at: iso(60 * 50), via: 'password', ip: '198.51.100.4', ok: false, reason: '비밀번호 틀림' },
  ],
};
const MEMBER = (login, name, status, via, extra = {}) => ({
  login, name, email: `${login}@example.com`, status, createdAt: iso(60 * 24 * (3 + login.length)), via, sv: 0,
  hasPassword: via === 'signup', role: 'viewer', root: false, lastFail: null, ...extra,
});
const ACCOUNTS = [
  { ...ACCOUNT, lastFail: null },
  MEMBER('alice', '앨리스', 'active', 'signup', { lastLoginAt: iso(90), role: 'deployer' }),
  MEMBER('bob', '밥', 'pending', 'signup'),
  MEMBER('carol', 'carol', 'pending', 'github', { github: 'carol', email: '' }),
  MEMBER('dave', '데이브', 'suspended', 'signup', { lastLoginAt: iso(60 * 24 * 4) }),
];
ROUTES.push(
  ['POST', /^\/auth\/login$/, () => ({ ok: true, login: 'rosieoh' })],
  ['POST', /^\/auth\/signup$/, () => ({ ok: true, login: 'newbie', status: 'pending' })],
  ['GET', /^\/account$/, () => ACCOUNT],
  ['PUT', /^\/account$/, () => ACCOUNT],
  ['POST', /^\/account\/(password|logout-others|withdraw)$/, () => ({ ok: true })],
  ['DELETE', /^\/account\/github$/, () => ({ ok: true })],
  ['GET', /^\/accounts$/, () => ({ accounts: ACCOUNTS })],
  ['POST', /^\/accounts\/[^/]+\/reset-password$/, () => ({ ok: true, tempPassword: 'tmpX9q2Lm7a' })],
  ['POST', /^\/accounts\/[^/]+\/[a-z-]+$/, () => ({ ok: true })],
);
