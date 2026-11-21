// 서버 점검 결과 읽기 — server-probe 템플릿이 보낸 구역(=== mx:이름 ===)들
export interface ProbeContainer { name: string; image: string; state: string; status: string; created: string; cpu?: number; memBytes?: number; memLimit?: number; memPct?: number; net?: string; block?: string }
export interface ProbeResult {
  host: string; now: string; uptimeSec: number; cpus: number; load: [number, number, number];
  mem: { total: number; available: number; swapTotal: number; swapFree: number };
  disks: { fs: string; size: number; used: number; avail: number; pct: number; mount: string }[];
  containers: ProbeContainer[];
  logs?: { container: string; lines: string[] };
  restart?: { container: string; status: string };
}

const UNIT: Record<string, number> = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };
export function bytes(s: string): number {
  const m = String(s).trim().match(/^([\d.]+)\s*([A-Za-z]+)?$/);
  if (!m) return 0;
  return Math.round(Number(m[1]) * (UNIT[m[2] ?? 'B'] ?? 1));
}

export function sections(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^=== mx:(.+) ===$/);
    if (m) { cur = []; out.set(m[1], cur); continue; }
    if (cur && line !== '') cur.push(line);
  }
  return out;
}

export function parseProbe(text: string): ProbeResult | null {
  const s = sections(text);
  if (!s.has('meta')) return null;
  const kv = (lines: string[] = []) => Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const meta = kv(s.get('meta'));
  const mem = Object.fromEntries((s.get('mem') || []).map((l) => { const m = l.match(/^(\w+):\s+(\d+)/); return m ? [m[1], Number(m[2]) * 1024] : ['', 0]; }));
  const disks = (s.get('disk') || []).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 6)
    .map((p) => ({ fs: p[0], size: Number(p[1]), used: Number(p[2]), avail: Number(p[3]), pct: Number(p[4].replace('%', '')), mount: p.slice(5).join(' ') }))
    .filter((d) => d.size > 1e9 && !/^\/(boot|snap)/.test(d.mount));
  const stats = new Map((s.get('stats') || []).map((l) => l.split('\t')).map((p) => [p[0], p]));
  const containers: ProbeContainer[] = (s.get('ps') || []).map((l) => l.split('\t')).filter((p) => p.length >= 4).map((p) => {
    const st = stats.get(p[0]);
    const [used, limit] = st ? st[2].split('/').map((x) => bytes(x)) : [undefined, undefined];
    return { name: p[0], image: p[1], state: p[2], status: p[3], created: p[4] ?? '',
      ...(st ? { cpu: Number(st[1].replace('%', '')) || 0, memBytes: used, memLimit: limit, memPct: Number(st[3].replace('%', '')) || 0, net: st[4], block: st[5] } : {}) };
  });
  const load = String(meta.load || '0 0 0').split(' ').map(Number) as [number, number, number];
  const res: ProbeResult = {
    host: meta.host || '', now: meta.now || new Date().toISOString(), uptimeSec: Number(meta.uptime_s) || 0, cpus: Number(meta.cpus) || 1, load,
    mem: { total: mem.MemTotal || 0, available: mem.MemAvailable || 0, swapTotal: mem.SwapTotal || 0, swapFree: mem.SwapFree || 0 }, disks, containers,
  };
  for (const [k, v] of s) {
    if (k.startsWith('logs:')) res.logs = { container: k.slice(5), lines: v.map(mask) };
    if (k.startsWith('restart:')) res.restart = { container: k.slice(8), status: v.join(' ') };
  }
  return res;
}

/** 로그 가리기 — 토큰·비밀번호·전화번호·이메일(앞 두 글자만) */
export function mask(line: string): string {
  return line
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[JWT]')
    .replace(/((?:password|passwd|pwd|secret|token|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^\s"',&}]+/gi, '$1***')
    .replace(/\b(01[016789])[-. ]?(\d{3,4})[-. ]?(\d{4})\b/g, '$1-****-$3')
    .replace(/\b([A-Za-z0-9._%+-]{2})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '$1***@$2');
}

export interface Alert { level: 'warn' | 'bad'; text: string }
/** 경고 — 디스크·메모리·부하·서비스 컨테이너·점검 끊김 */
export function alertsOf(p: ProbeResult | null, at: number | null, services: string[], now = Date.now()): Alert[] {
  const out: Alert[] = [];
  if (!p || !at) return [{ level: 'warn', text: '아직 점검 결과가 없습니다' }];
  const age = (now - at) / 60000;
  if (age > 30) out.push({ level: age > 120 ? 'bad' : 'warn', text: `점검이 ${Math.round(age)}분째 없습니다` });
  for (const d of p.disks) if (d.pct >= 85) out.push({ level: d.pct >= 93 ? 'bad' : 'warn', text: `디스크 ${d.mount} ${d.pct}%` });
  const memPct = p.mem.total ? 100 - (p.mem.available / p.mem.total) * 100 : 0;
  if (memPct >= 90) out.push({ level: memPct >= 96 ? 'bad' : 'warn', text: `메모리 ${Math.round(memPct)}% 사용` });
  if (p.load[1] / p.cpus >= 1.5) out.push({ level: 'warn', text: `부하 높음(5분 ${p.load[1]} / CPU ${p.cpus})` });
  for (const svc of services) {
    const cur = p.containers.filter((c) => c.name.startsWith(`${svc}-web-`) && c.state === 'running');
    if (!cur.length) out.push({ level: 'bad', text: `${svc} 컨테이너가 떠 있지 않습니다` });
    for (const c of cur) if (/unhealthy|Restarting/i.test(c.status)) out.push({ level: 'bad', text: `${c.name} ${c.status}` });
  }
  return out;
}
