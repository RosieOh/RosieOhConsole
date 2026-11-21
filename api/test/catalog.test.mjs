// npm run build 뒤 실행 (dist 를 시험한다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

process.env.DATA_DIR = mkdtempSync(tmpdir() + '/mxc-catalog-');
process.env.CATALOG_AUTO_LOGO = 'off';
const { buildCatalog, emptyOverrides, pathOf, UNASSIGNED } = await import('../dist/catalog/merge.js');
const { DEFAULT_STORE } = await import('../dist/catalog/types.js');
const { logoScore, pickCandidates, sniff, sanitizeSvg, prepareLogo } = await import('../dist/catalog/logos.js');
const { JsonStore } = await import('../dist/json-store.js');
const { CatalogService } = await import('../dist/catalog/catalog.service.js');

// 중립 fixture — 그룹 → 그룹 → 프로젝트 → 구성요소
const NODES = [
  { id: 'demo', type: 'group', name: 'Demo', order: 10 },
  { id: 'demo-sub', type: 'group', name: 'Demo Sub', parent: 'demo', order: 10 },
  { id: 'alpha', type: 'project', name: 'Alpha', parent: 'demo-sub', order: 10 },
  { id: 'beta', type: 'project', name: 'Beta', parent: 'demo', order: 20 },
  { id: 'misc', type: 'group', name: 'Misc', order: 20 },
];
const COMPONENTS = [
  { key: 'demo-api', name: 'Demo API', kind: 'backend', repo: 'demo-api', parent: 'alpha', order: 10 },
  { key: 'demo-app', name: 'Demo App', kind: 'device-app', repo: 'demo-app', parent: 'alpha', order: 20 },
  { key: 'demo-parents', name: 'Demo Parents', kind: 'store-app', repo: 'demo-parents', parent: 'alpha', order: 30, store: DEFAULT_STORE },
  { key: 'beta-web', name: 'Beta Web', kind: 'web', repo: 'beta-web', parent: 'beta', order: 10 },
];
const build = (o = emptyOverrides()) => buildCatalog(NODES, COMPONENTS, o);
const find = (roots, id) => { for (const n of roots) { if (n.id === id) return n; const h = find(n.children, id); if (h) return h; } return null; };

test('편집값이 이긴다 — 이름·소속·순서·삭제·추가', () => {
  const o = emptyOverrides();
  o.nodes.alpha = { name: 'Alpha!', order: 1 };
  o.nodes.beta = { parent: null };                 // 맨 위로
  o.components['beta-web'] = { name: '베타 웹', parent: 'alpha', order: 0 };
  o.components['demo-parents'] = { deleted: true };
  o.nodes['n-1'] = { added: true, type: 'project', name: '새 프로젝트', parent: 'misc', order: 5 };
  o.components['c-1'] = { added: true, name: '새 앱', kind: 'store-app', repo: 'x', parent: 'n-1', order: 1 };
  const { roots, components } = build(o);
  assert.equal(find(roots, 'alpha').name, 'Alpha!');
  assert.ok(roots.some((r) => r.id === 'beta'));
  assert.equal(find(roots, 'alpha').components[0].name, '베타 웹');
  assert.ok(!components.some((c) => c.key === 'demo-parents'));
  assert.equal(components.find((c) => c.key === 'demo-api').builtin, true);
  assert.equal(find(roots, 'n-1').components[0].name, '새 앱');
  assert.equal(components.find((c) => c.key === 'c-1').builtin, false);
});

test('화면에서 추가한 스토어 앱도 store 기본값(release.yml, store/)을 갖는다 — 배포 탭·플로우에 나와야 한다 (#165)', () => {
  const o = emptyOverrides();
  o.nodes['n-r2s'] = { added: true, type: 'project', name: '새 프로젝트', parent: null, order: 5 };
  o.components['c-r2s'] = { added: true, name: '새 부모앱', kind: 'store-app', repo: 'new-parents', parent: 'n-r2s', order: 1 };
  o.components['c-web'] = { added: true, name: '새 웹', kind: 'web', repo: 'x', parent: 'n-r2s', order: 2 };
  const { components } = build(o);
  const r2s = components.find((c) => c.key === 'c-r2s');
  assert.deepEqual(r2s.store, { workflow: 'release.yml', tagPrefix: 'store/' });
  assert.equal(r2s.builtin, false);
  assert.equal(components.find((c) => c.key === 'c-web').store, undefined);           // 스토어 앱만
  assert.deepEqual(components.find((c) => c.key === 'demo-parents').store, { workflow: 'release.yml', tagPrefix: 'store/' }); // 기본값 부모앱은 그대로
});

test('부모가 없거나 순환이면 맨 위, 프로젝트가 사라진 구성요소는 미분류', () => {
  const o = emptyOverrides();
  o.nodes.demo = { parent: 'demo-sub' };          // demo → demo-sub → demo 순환
  o.components['demo-api'] = { parent: 'nowhere' };
  const { roots } = build(o);
  assert.ok(roots.some((r) => r.id === 'demo') || roots.some((r) => r.id === 'demo-sub'));
  assert.equal(find(roots, UNASSIGNED).components[0].key, 'demo-api');
});

test('로고 물려받기 — 구성요소 → 프로젝트 → 그룹', () => {
  const o = emptyOverrides();
  o.auto['demo-app'] = 'aaaaaaaaaaaaaaaa.png';
  const { roots, components } = build(o);
  assert.equal(find(roots, 'alpha').logo, 'aaaaaaaaaaaaaaaa.png');
  assert.equal(components.find((c) => c.key === 'demo-api').logo, 'aaaaaaaaaaaaaaaa.png');   // 백엔드는 프로젝트 로고
  assert.equal(components.find((c) => c.key === 'demo-api').ownLogo, null);
  o.components['demo-app'] = { logo: 'bbbbbbbbbbbbbbbb.svg' };                                // 사람이 고른 값이 자동보다 이긴다
  assert.equal(build(o).components.find((c) => c.key === 'demo-app').logo, 'bbbbbbbbbbbbbbbb.svg');
});

test('로고 후보 점수 — 런처 아이콘 > 로고 > 파비콘, 남의 로고·빌드 산출물 제외', () => {
  const paths = [
    'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 'android/app/src/main/res/mipmap-mdpi/ic_launcher.png',
    'assets/images/logos/google.svg', 'assets/images/logo.png', 'public/favicon.png',
    'node_modules/x/logo.png', 'android/app/build/logo.png', 'README.md',
  ];
  const c = pickCandidates(paths);
  assert.equal(c[0], 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png');
  assert.ok(c.indexOf('assets/images/logo.png') < c.indexOf('public/favicon.png'));
  assert.ok(!c.some((p) => p.includes('node_modules') || p.includes('/build/') || p.endsWith('.md')));
  assert.ok(logoScore('assets/images/logos/google.svg') <= 10);
});

test('로고 형식은 내용으로 판단, SVG 는 스크립트를 지운다', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  assert.equal(sniff(png), 'png');
  assert.equal(sniff(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(sniff(Buffer.from('<html><svg></svg></html>')), null);
  assert.equal(sniff(Buffer.from('GIF89a......')), null);
  const dirty = '<svg onload="alert(1)"><script>alert(2)</script><foreignObject><div/></foreignObject><a href="javascript:x()"><rect onclick=\'y()\'/></a><image href="https://evil/x.png"/></svg>';
  const clean = sanitizeSvg(dirty);
  assert.ok(!/script|onload|onclick|javascript:|foreignObject|evil/i.test(clean), clean);
  assert.throws(() => prepareLogo(Buffer.alloc(0)));
  assert.throws(() => prepareLogo(Buffer.alloc(2 * 1024 * 1024, 1)));
  assert.throws(() => prepareLogo(Buffer.from('hello')));
  assert.match(prepareLogo(png).file, /^[0-9a-f]{16}\.png$/);
});

test('저장 파일 — rev 가 다르면 거절, 깨졌으면 옮겨 두고 기본값', () => {
  const dir = mkdtempSync(tmpdir() + '/mxc-store-');
  const s = new JsonStore(dir + '/x.json', () => ({ rev: 0, v: 1 }));
  s.update(0, (d) => { d.v = 2; });
  assert.equal(s.get().rev, 1);
  assert.throws(() => s.update(0, (d) => { d.v = 3; }), /먼저/);
  assert.equal(new JsonStore(dir + '/x.json', () => ({ rev: 0, v: 1 })).get().v, 2);
  writeFileSync(dir + '/y.json', '{깨짐');
  const b = new JsonStore(dir + '/y.json', () => ({ rev: 0, v: 1 }));
  assert.equal(b.get().v, 1);
  assert.ok(b.broken);
  assert.ok(readdirSync(dir).some((f) => f.startsWith('y.json.broken-')));
});

test('카탈로그 편집 — 묶음 동작·검사·감사', () => {
  const svc = new CatalogService();
  const r0 = svc.view().rev;
  // 기본값이 비어 있으니 그룹 → 그룹 → 프로젝트 → 구성요소를 화면 동작으로 만든다
  const g = svc.apply('boss', r0, [{ op: 'node.add', type: 'group', name: 'Demo' }]);
  const gid = g.added[0];
  const g2 = svc.apply('boss', g.rev, [{ op: 'node.add', type: 'group', name: 'Demo Sub', parent: gid }]);
  const subId = g2.added[0];
  const p = svc.apply('boss', g2.rev, [{ op: 'node.add', type: 'project', name: 'Alpha', parent: subId }]);
  const pid = p.added[0];
  const c = svc.apply('boss', p.rev, [
    { op: 'comp.add', name: 'Demo API', kind: 'backend', repo: 'demo-api', parent: pid },
    { op: 'comp.add', name: 'Demo App', kind: 'device-app', repo: 'demo-app', parent: pid },
  ]);
  const [api, app] = c.added;
  const { rev, added } = svc.apply('boss', c.rev, [
    { op: 'node.add', type: 'project', name: '실험', parent: gid },
    { op: 'comp.update', key: api, name: 'Demo API v2', order: 3 },
  ]);
  assert.equal(rev, c.rev + 1);
  const v = svc.view();
  assert.equal(v.components.find((x) => x.key === api).name, 'Demo API v2');
  assert.ok(find(v.roots, added[0]));
  assert.throws(() => svc.apply('boss', c.rev, [{ op: 'comp.update', key: api, name: 'x' }]), /먼저/);
  assert.throws(() => svc.apply('boss', rev, [{ op: 'node.delete', id: pid }]), /비어 있지/);
  assert.throws(() => svc.apply('boss', rev, [{ op: 'node.update', id: gid, parent: subId }]), /자기 아래/);
  assert.throws(() => svc.apply('boss', rev, [{ op: 'comp.update', key: api, parent: gid }]), /프로젝트 아래/);
  assert.throws(() => svc.apply('boss', rev, [{ op: 'comp.update', key: api, logo: '../../etc/passwd' }]), /로고/);
  assert.throws(() => svc.apply('boss', rev, [{ op: 'comp.update', key: api, name: '' }]), /이름/);
  assert.throws(() => svc.apply('boss', rev, [{ op: 'comp.add', name: 'x', kind: 'nope', parent: pid }]), /종류/);
  assert.throws(() => svc.apply('boss', rev, [{ op: 'reset', key: api }]), /기본값이 없습니다/);
  // 실패한 묶음은 아무것도 바꾸지 않는다
  assert.equal(svc.view().rev, rev);
  const r2 = svc.apply('boss', rev, [{ op: 'node.delete', id: added[0] }, { op: 'comp.delete', key: app }]).rev;
  assert.ok(!find(svc.view().roots, added[0]));
  assert.ok(!svc.view().components.some((x) => x.key === app));
  // 로고 올리기 → 고르기(백엔드는 프로젝트 로고를 물려받는다)
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20, 7)]);
  const file = svc.saveLogo(png);
  assert.ok(existsSync(svc.logoDir + '/' + file));
  svc.apply('boss', r2, [{ op: 'node.update', id: pid, logo: file }]);
  assert.equal(find(svc.view().roots, pid).logo, file);
  assert.equal(svc.view().components.find((x) => x.key === api).logo, file);
});

test('로그인 없는 카탈로그 — 기기앱만, 주소·저장소 밖 정보 없음', () => {
  const svc = new CatalogService();
  const r = svc.view().rev;
  const g = svc.apply('boss', r, [{ op: 'node.add', type: 'group', name: 'Pub' }]);
  const p = svc.apply('boss', g.rev, [{ op: 'node.add', type: 'project', name: 'PubProj', parent: g.added[0] }]);
  svc.apply('boss', p.rev, [
    { op: 'comp.add', name: '공개 앱', kind: 'device-app', repo: 'public-device-app', parent: p.added[0] },
    { op: 'comp.add', name: '숨은 백엔드', kind: 'backend', repo: 'secret-backend', parent: p.added[0], note: 'internal-note' },
  ]);
  const out = JSON.stringify(svc.publicView());
  assert.ok(out.includes('public-device-app'));
  assert.ok(!out.includes('secret-backend') && !out.includes('internal-note'));
});

test('기본 카탈로그 — 키·저장소가 겹치지 않고, 구성요소는 있는 프로젝트에 붙는다', async () => {
  const { DEFAULT_NODES, DEFAULT_COMPONENTS } = await import('../dist/catalog/defaults.js');
  const dup = (a) => a.filter((x, i) => a.indexOf(x) !== i);
  assert.deepEqual(dup(DEFAULT_NODES.map((n) => n.id)), []);
  assert.deepEqual(dup(DEFAULT_COMPONENTS.map((c) => c.key)), []);
  assert.deepEqual(dup(DEFAULT_COMPONENTS.map((c) => c.repo)), []);
  const projects = new Set(DEFAULT_NODES.filter((n) => n.type === 'project').map((n) => n.id));
  assert.deepEqual(DEFAULT_COMPONENTS.filter((c) => !projects.has(c.parent)).map((c) => c.key), []);
  const { components } = buildCatalog(DEFAULT_NODES, DEFAULT_COMPONENTS, emptyOverrides());
  assert.ok(!components.some((c) => c.project === UNASSIGNED));
});
