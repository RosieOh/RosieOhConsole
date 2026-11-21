import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

process.env.DATA_DIR = mkdtempSync(tmpdir() + '/mxc-servers-');
process.env.PROBE_TOKEN = 't'.repeat(40);
const { parseProbe, mask, alertsOf, bytes } = await import('../dist/servers/parse.js');
const { ServersService } = await import('../dist/servers/servers.service.js');

const SAMPLE = [
  '=== mx:meta ===', 'host=web1', 'now=2026-10-12T04:49:31Z', 'uptime_s=3600', 'cpus=4', 'load=0.50 7.10 0.30',
  '=== mx:mem ===', 'MemTotal:       8000000 kB', 'MemAvailable:   400000 kB', 'SwapTotal:       0 kB', 'SwapFree:         0 kB',
  '=== mx:disk ===', '/dev/sda1       100000000000  90000000000  10000000000      90% /', '/dev/sdb1 500000 100 100 1% /boot',
  '=== mx:ps ===', 'demo-web-prod-abc123def456\tlocalhost:5555/demo:abc123def456\trunning\tUp 2 hours (unhealthy)\t2026-10-12', 'kamal-proxy\tbasecamp/kamal-proxy\trunning\tUp 3 days\t2026-10-09',
  '=== mx:stats ===', 'demo-web-prod-abc123def456\t12.50%\t512MiB / 2GiB\t25.00%\t1.2MB / 3.4MB\t0B / 0B',
  '=== mx:logs:demo-web-prod-abc123def456 ===', '2026-10-12T04:00:00Z login ok user=kim01@example.com phone=010-1234-5678', '2026-10-12T04:00:01Z Authorization: Bearer abcdefghijklmnop token=zzz123',
  '=== mx:end ===',
].join('\n');

test('점검 결과 읽기', () => {
  const p = parseProbe(SAMPLE);
  assert.equal(p.host, 'web1');
  assert.equal(p.cpus, 4);
  assert.deepEqual(p.load, [0.5, 7.1, 0.3]);
  assert.equal(p.mem.total, 8000000 * 1024);
  assert.equal(p.disks.length, 1);                  // 작은 /boot 는 뺀다
  assert.equal(p.disks[0].pct, 90);
  const c = p.containers.find((x) => x.name.startsWith('demo'));
  assert.equal(c.cpu, 12.5); assert.equal(c.memBytes, 512 * 1024 ** 2); assert.equal(c.memLimit, 2 * 1024 ** 3);
  assert.equal(p.logs.container, 'demo-web-prod-abc123def456');
  assert.equal(bytes('1.5GB'), 1.5e9);
});

test('로그 가리기 — 이메일·전화·토큰', () => {
  const p = parseProbe(SAMPLE);
  const all = p.logs.lines.join('\n');
  assert.ok(!all.includes('kim01@') && all.includes('ki***@example.com'));
  assert.ok(!all.includes('1234-5678') && all.includes('010-****-5678'));
  assert.ok(!all.includes('abcdefghijklmnop') && !all.includes('zzz123'));
  assert.equal(mask('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdEFGH'), '[JWT]');
});

test('경고 — 디스크·메모리·부하·컨테이너·끊김', () => {
  const p = parseProbe(SAMPLE);
  const now = Date.parse('2026-10-12T05:00:00Z');
  const a = alertsOf(p, now - 60_000, ['demo', 'auth'], now).map((x) => x.text).join(' | ');
  assert.match(a, /디스크 \/ 90%/); assert.match(a, /메모리 95%/); assert.match(a, /부하/); assert.match(a, /unhealthy/); assert.match(a, /auth 컨테이너가 떠 있지 않습니다/);
  assert.match(alertsOf(p, now - 3 * 3600_000, [], now).map((x) => x.text).join(), /점검이 180분째/);
});

test('받는 쪽 — 토큰이 틀리면 없는 척, 로그는 저장 파일에 안 남는다', async () => {
  const s = new ServersService();
  // 기본 인프라엔 점검 서버가 없다 — 시험용 서버 하나를 끼운다
  s.defs.push({ id: 'prod-demo', name: 'Demo 운영 서버', ip: null, domains: [], note: '', node: null, repo: 'demo-api', key: 'prod', services: [{ kamal: 'demo', comp: 'demo-api' }] });
  assert.throws(() => s.ingest(`Bearer ${'t'.repeat(40)}`, { server: 'nowhere', action: 'probe', ok: '1' }, SAMPLE), /모르는 서버/);
  assert.throws(() => s.ingest('Bearer nope', { server: 'prod-demo', action: 'probe', ok: '1' }, SAMPLE));
  s.ingest(`Bearer ${'t'.repeat(40)}`, { server: 'prod-demo', action: 'logs', target: 'demo', ok: '1', run: '9' }, SAMPLE);
  const l = s.list().servers.find((x) => x.id === 'prod-demo');
  assert.equal(l.probe.host, 'web1');
  assert.equal(l.probe.logs, undefined);
  assert.equal(s.logsOf('prod-demo', 'demo').lines.length, 2);
  const { readFileSync } = await import('node:fs');
  assert.ok(!readFileSync(process.env.DATA_DIR + '/servers.json', 'utf8').includes('login ok'));
});

test('서버 이름 — 바꾼 이름 > 카탈로그 프로젝트 이름 > 기본, IP·도메인 뽑기', async () => {
  const { infraName, addrOf } = await import('../dist/infra/names.js');
  const proj = (id) => ({ alpha: 'Alpha' })[id];
  assert.deepEqual(infraName({ name: 'A 운영 서버', of: { project: 'alpha' } }, undefined, proj), { name: 'Alpha 운영 서버', short: 'Alpha' });
  assert.deepEqual(infraName({ name: 'A 관리자 운영 서버', of: { project: 'alpha', role: '관리자' } }, undefined, proj), { name: 'Alpha 관리자 운영 서버', short: 'Alpha 관리자' });
  assert.equal(infraName({ name: 'A 운영 서버', of: { project: 'alpha' } }, 'Alpha WAS', proj).name, 'Alpha WAS');
  assert.deepEqual(infraName({ name: '집 서버 (사내)' }, undefined, proj), { name: '집 서버 (사내)', short: '집 서버' });
  assert.deepEqual(addrOf('203.0.113.10, api.example.net, 인증서버, 관리자, 웹뷰'), { ip: '203.0.113.10', domains: ['api.example.net'], note: '인증서버, 관리자, 웹뷰' });
  assert.deepEqual(addrOf('10.0.0.24, 콘솔 :8087, 업무보드'), { ip: '10.0.0.24', domains: [], note: '콘솔 :8087, 업무보드' });
});
