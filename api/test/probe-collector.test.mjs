// 서버 점검 수집기 — 재사용 워크플로(.github/workflows/server-probe.yml)의 수집 구역을 그대로 꺼내 리눅스 컨테이너에서 돌리고,
// 그 출력을 콘솔이 읽을 수 있는지(parseProbe) 본다. docker 가 없으면 건너뛴다 (npm run build 뒤)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const { parseProbe } = await import('../dist/servers/parse.js');
const wf = readFileSync(new URL('../../.github/workflows/server-probe.yml', import.meta.url), 'utf8');
const block = wf.slice(wf.indexOf('# mx:collect:start'), wf.indexOf('# mx:collect:end'));
const indent = /^( *)#/m.exec(wf.slice(wf.lastIndexOf('\n', wf.indexOf('# mx:collect:start')) + 1))[1].length;
const script = block.split('\n').map((l) => l.slice(indent)).join('\n');
const docker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

test('수집기 구역이 워크플로 안에 있다', () => {
  assert.match(script, /=== mx:meta ===/);
  assert.match(script, /=== mx:disk ===/);
  assert.ok(!/^\s{4,}echo "=== mx:meta/m.test(script), '들여쓰기가 벗겨져야 한다');
});

test('리눅스에서 돌린 수집기 출력을 콘솔이 읽는다', { skip: docker ? false : 'docker 없음', timeout: 180_000 }, () => {
  const r = spawnSync('docker', ['run', '--rm', '-i', 'debian:stable-slim', 'bash', '-s', '--', 'probe', '', '50'], { input: script, encoding: 'utf8', timeout: 170_000 });
  assert.equal(r.status, 0, r.stderr);
  const p = parseProbe(r.stdout);
  assert.ok(p, '메타 구역이 있어야 한다');
  assert.ok(p.host.length > 0);
  assert.ok(p.cpus >= 1);
  assert.ok(p.mem.total > 0 && p.mem.available > 0);
  assert.equal(p.load.length, 3);
  assert.ok(p.load.every((x) => Number.isFinite(x)));
  assert.ok(p.uptimeSec > 0);
  assert.deepEqual(p.containers, []);   // 컨테이너 안에는 docker 가 없다
});
