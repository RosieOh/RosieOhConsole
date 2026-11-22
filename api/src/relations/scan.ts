// 연관 관계 자동 수집 — 설정 파일의 "단서"(호스트·키 이름)를 뽑아 서비스·인프라와 짝짓는다.
// 값은 보지 않는다: 근거에는 키 이름과 호스트만 남긴다(비밀번호·토큰이 섞여도 밖으로 나가지 않게).

export interface Clue { kind: 'host' | 'key'; value: string; key?: string; line: number }
export interface Target { id: string; via: string }        // 짝지은 대상(구성요소 key 또는 인프라 id) + 무엇으로 짝지었나

/** 어떤 파일을 읽나 — 설정·주소가 있을 만한 파일만(빌드 산출물·시험·node_modules 제외) */
const SCAN_RE = /(^|\/)(application[^/]*\.(ya?ml|properties)|\.env[^/]*\.(example|sample|template|dev|prod|test|local)|\.env\.(example|sample)|config\/deploy[^/]*\.ya?ml|docker-compose[^/]*\.ya?ml|build\.config\.json|app\.json|build\.gradle(\.kts)?|network_security_config\.xml|[^/]*(Const|const|Config|config|Api|api|Url|url|Server|server|Env|env)[^/]*\.(kt|java|ts|tsx|js|mjs))$/;
const SKIP_RE = /(^|\/)(node_modules|build|dist|bin|out|\.next|Pods|vendor|coverage|__tests__|test|tests|androidTest|e2e)\//;
export function wantFile(path: string) { return SCAN_RE.test(path) && !SKIP_RE.test(path) && !/\.(test|spec)\./.test(path); }

const IGNORE_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|example\.(com|org)|.*\.example\.com|www\.w3\.org|schemas\.android\.com|schemas\.microsoft\.com|xmlns\.com|json-schema\.org|maven\.apache\.org|repo\.maven\.apache\.org|plugins\.gradle\.org|services\.gradle\.org|jitpack\.io|maven\.google\.com|dl\.google\.com|github\.com|raw\.githubusercontent\.com|gitlab\.com|npmjs\.(org|com)|registry\.npmjs\.org|reactnative\.dev|developer\.android\.com|developer\.apple\.com|docs\.[a-z.]+|swagger\.io|springdoc\.org|spring\.io|www\.apache\.org|kotlinlang\.org|fonts\.(googleapis|gstatic)\.com|ghcr\.io|hub\.docker\.com|storybook\.js\.org|(www\.)?jitpack\.io|facebook\.github\.io|vite\.dev|repository\.map\.naver\.com|[a-z0-9.-]*\.github\.io|reactjs\.org|react\.dev|nodejs\.org|typescriptlang\.org|eslint\.org|prettier\.io|tailwindcss\.com|nextjs\.org|vercel\.com|expo\.dev|cocoapods\.org|apple\.com|(xxx+|your-[a-z-]+)\.[a-z.]+|docker\.io|basecamp\.github\.io|kamal-deploy\.org|[a-z0-9-]+\.local|host\.docker\.internal|[a-z0-9_-]+)$/i;
// 호스트는 "주소 자리"에 있을 때만 — 스킴(http:// jdbc:mariadb:// redis:// …) 뒤, 설정 값 자리(host: x / X_HOST=x), <domain>x</domain>.
// 코드 식별자(com.example.app, this.app)를 호스트로 잘못 읽지 않게.
const TLD = '(?:com|net|life|kr|io|co|org|dev|app|cloud|me|xyz|site|ai)';
const NAME = `(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+${TLD}`;
const IP = '(?:\\d{1,3}\\.){3}\\d{1,3}';
const SCHEME_RE = new RegExp(`(?:https?|wss?|jdbc:[a-z]+|redis|rediss|mongodb(?:\\+srv)?|amqp|mysql|postgres(?:ql)?|ftp|smtp)://(?:[^@/\\s]+@)?(${NAME}|${IP})`, 'gi');
const VALUE_RE = new RegExp(`(?:^|[\\s"'])(?:[A-Za-z_][\\w.-]*(?:host|HOST|Host|url|URL|Url|uri|URI|domain|DOMAIN|server|SERVER|address|ADDR|endpoint|ENDPOINT))\\s*[:=]\\s*["']?(${NAME}|${IP})(?::\\d+)?["']?\\s*,?\\s*$`, 'i');
const DOMAIN_TAG_RE = new RegExp(`<domain[^>]*>\\s*(${NAME}|${IP})\\s*</domain>`, 'gi');
const KEY_RE = /(?:^|[\s"'{,(])((?:[A-Z][A-Z0-9]*_)+[A-Z0-9]+|[a-z][a-zA-Z0-9]*(?:[.-][a-zA-Z0-9]+){1,6})\s*[:=]/g;
const ENV_REF_RE = /\$\{([A-Z][A-Z0-9_]+)(?::[^}]*)?\}|process\.env\.([A-Z][A-Z0-9_]+)|ENV\[["']([A-Z][A-Z0-9_]+)["']\]|System\.getenv\(["']([A-Z][A-Z0-9_]+)["']\)/g;

/** 파일 한 개에서 단서 뽑기 — 주석 줄도 본다(꺼 둔 연결도 "확인 필요"로 보이게 하되 표시) */
export function extractClues(text: string): Clue[] {
  const out: Clue[] = [];
  const seen = new Set<string>();
  const add = (c: Clue) => { const k = `${c.kind}:${c.value}:${c.key ?? ''}`; if (!seen.has(k)) { seen.add(k); out.push(c); } };
  text.split(/\r?\n/).slice(0, 5000).forEach((raw, i) => {
    const line = raw.length > 2000 ? raw.slice(0, 2000) : raw;
    const keyHere = line.match(/^\s*#?\s*([A-Za-z_][\w.-]*)\s*[:=]/)?.[1];
    const hosts = [...line.matchAll(SCHEME_RE)].map((m) => m[1]);
    const v = line.match(VALUE_RE)?.[1]; if (v) hosts.push(v);
    for (const m of line.matchAll(DOMAIN_TAG_RE)) hosts.push(m[1]);
    for (const h of hosts) {
      const host = h.toLowerCase();
      if (IGNORE_HOST.test(host)) continue;
      add({ kind: 'host', value: host, key: keyHere, line: i + 1 });
    }
    for (const m of line.matchAll(ENV_REF_RE)) add({ kind: 'key', value: (m[1] || m[2] || m[3] || m[4])!, line: i + 1 });
    for (const m of line.matchAll(KEY_RE)) if (/^[A-Z]/.test(m[1])) add({ kind: 'key', value: m[1], line: i + 1 });
  });
  return out;
}

// 키 이름 규칙 — 이름만으로 상대가 드러나는 것
const KEY_RULES: [RegExp, string][] = [
  [/^(SPRING_)?(DB|DATABASE|DATASOURCE|MYSQL|MARIADB|POSTGRES|JDBC)(_|$)|_DB_URL$|DATASOURCE_URL/, 'kind:db'],
  [/^REDIS_|_REDIS_|^SPRING_(DATA_)?REDIS/, 'kind:redis'],
  [/(^(FCM|FIREBASE)_)|_FCM_|GOOGLE_APPLICATION_CREDENTIALS/, 'infra:firebase'],
  [/^(AWS|S3|SES)_/, 'infra:aws'],
  [/^HOT_UPDATER_|^SUPABASE_/, 'infra:ota'],
];

export interface Known {
  hostToComp: { host: string; path?: string; comp: string }[];   // 운영·테스트배드 주소 → 구성요소
  infraHosts: { host: string; id: string }[];                     // 인프라 호스트(접미사 일치)
  defaultRedis?: string;
}

/** 단서 → 대상. self(자기 자신)는 뺀다. 못 짝지은 호스트는 unknown 으로 */
export function matchClues(clues: { clue: Clue; path: string; lineText?: string }[], known: Known, self: string[]) {
  const hits = new Map<string, { target: string; via: string; evidence: { path: string; line: number; text: string }[] }>();
  const unknown = new Map<string, { path: string; line: number; text: string }[]>();
  const put = (target: string, via: string, ev: { path: string; line: number; text: string }) => {
    if (self.includes(target.replace(/^comp:/, ''))) return;
    const h = hits.get(target) ?? { target, via, evidence: [] };
    if (h.evidence.length < 5 && !h.evidence.some((e) => e.path === ev.path && e.line === ev.line)) h.evidence.push(ev);
    hits.set(target, h);
  };
  for (const { clue, path, lineText } of clues) {
    const ev = { path, line: clue.line, text: clue.kind === 'host' ? `${clue.key ? clue.key + ' → ' : ''}${clue.value}` : clue.value };
    if (clue.kind === 'host') {
      const host = clue.value;
      const comps = known.hostToComp.filter((k) => k.host === host);
      if (comps.length) {
        // 같은 호스트를 여럿이 쓰면(공용 테스트배드의 경로별 서비스 등) 줄의 경로로 가린다
        const withPath = comps.filter((k) => k.path && lineText?.includes(host + k.path));
        const pick = withPath.length ? withPath : comps.filter((k) => !k.path);
        for (const k of (pick.length ? pick : comps).slice(0, 1)) put(`comp:${k.comp}`, `주소 ${host}`, ev);
        continue;
      }
      const inf = known.infraHosts.find((k) => host === k.host || host.endsWith('.' + k.host));
      if (inf) { put(`infra:${inf.id}`, `주소 ${host}`, ev); continue; }
      if (/(^|[.-])(db|mysql|maria|postgres|rds)([.-]|\d|$)/.test(host)) { put(`db:${host}`, `DB 주소 ${host}`, ev); continue; }
      if (/redis/.test(host)) { put(`redis:${host}`, `Redis 주소 ${host}`, ev); continue; }
      const list = unknown.get(host) ?? [];
      if (list.length < 3) list.push(ev);
      unknown.set(host, list);
    } else {
      for (const [re, t] of KEY_RULES) {
        if (!re.test(clue.value)) continue;
        if (t === 'kind:db') put(`db:${self[0]}`, `키 ${clue.value}`, ev);            // 주소는 서버 env — 이 서비스의 DB 로 둔다
        else if (t === 'kind:redis') put(known.defaultRedis ?? `redis:${self[0]}`, `키 ${clue.value}`, ev);
        else put(t, `키 ${clue.value}`, ev);
        break;
      }
    }
  }
  return { hits: [...hits.values()], unknown: [...unknown.entries()].map(([host, evidence]) => ({ host, evidence })) };
}

/** 주소(링크)에서 호스트·경로 */
export function hostOf(url: string): { host: string; path: string } | null {
  try { const u = new URL(url); return { host: u.hostname.toLowerCase(), path: u.pathname.replace(/\/$/, '') }; } catch { return null; }
}
