// npm run build 뒤 실행 (dist 를 시험한다)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { extractRefs, extractTemplateUses, repoUsage, explainPerm, canManage, canUse, checkName, isTemplate } = await import('../dist/secrets/scan.js');

const caller = `
# 시크릿: DEV_SSH_KEY · KAMAL_REGISTRY_PASSWORD  (주석은 세지 않는다 secrets.COMMENTED)
jobs:
  deploy:
    uses: demo-owner/ci-templates/.github/workflows/backend-kamal-testbed.yml@main
    with:
      token: \${{ secrets.EXTRA_TOKEN }}
      flag: \${{ vars.DEPLOY_FLAG }}
    secrets: inherit
`;
const tpl = `
on: workflow_call
jobs:
  deploy:
    steps:
      - run: echo "\${{ secrets.DEV_SSH_KEY }}" | ssh-add -
      - run: docker login -p "\${{ secrets['KAMAL_REGISTRY_PASSWORD'] }}"
      - run: echo \${{ secrets.GITHUB_TOKEN }}
`;

test('참조 — secrets.X · secrets[\'X\'] · vars.X, 주석·자동 토큰 제외', () => {
  const r = extractRefs(caller).map((x) => `${x.kind}:${x.name}`).sort();
  assert.deepEqual(r, ['secret:EXTRA_TOKEN', 'variable:DEPLOY_FLAG']);
  assert.deepEqual(extractRefs(tpl).map((x) => x.name).sort(), ['DEV_SSH_KEY', 'KAMAL_REGISTRY_PASSWORD']);
});

test('템플릿 부르기 — secrets: inherit 여부', () => {
  const u = extractTemplateUses(caller);
  assert.deepEqual(u, [{ owner: 'demo-owner', repo: 'ci-templates', path: '.github/workflows/backend-kamal-testbed.yml', ref: 'main', inherit: true }]);
  assert.equal(extractTemplateUses(caller.replace('secrets: inherit', 'secrets:\n      A: x'))[0].inherit, false);
});

test('사용처 — 템플릿 안의 참조는 "템플릿 경유"로, inherit 가 없으면 따라가지 않는다', async () => {
  const files = [{ path: '.github/workflows/deploy.yml', text: caller }, { path: '.github/workflows/lint.yml', text: 'run: \${{ secrets.EXTRA_TOKEN }}' }];
  const seen = [];
  const u = await repoUsage(files, async (t) => { seen.push(t.path); return tpl; });
  assert.deepEqual(seen, ['.github/workflows/backend-kamal-testbed.yml']);
  assert.deepEqual(u.refs.get('secret:DEV_SSH_KEY').usages, [{ workflow: 'deploy.yml', via: 'ci-templates/backend-kamal-testbed.yml' }]);
  assert.deepEqual(u.refs.get('secret:EXTRA_TOKEN').usages.map((x) => x.workflow).sort(), ['deploy.yml', 'lint.yml']);
  const n = await repoUsage([{ path: 'x.yml', text: caller.replace('secrets: inherit', '') }], async () => tpl);
  assert.equal(n.refs.get('secret:DEV_SSH_KEY'), undefined);
});

test('템플릿이 템플릿을 불러도 끝난다(순환 방지)', async () => {
  const loop = `uses: demo-owner/ci-templates/.github/workflows/a.yml@main\nsecrets: inherit\nrun: \${{ secrets.DEEP }}`;
  const u = await repoUsage([{ path: 'x.yml', text: loop }], async () => loop);
  assert.ok(u.refs.get('secret:DEEP'));
});

test('권한 — 팀·직접 협업자, 바꾸기는 admin 이상·쓰기는 write 이상', () => {
  const teams = [
    { name: 'Owners', permission: 'owner', allRepos: true, codeUnit: 'owner', members: ['owner1'], repos: [] },
    { name: 'Dev', permission: 'none', allRepos: true, codeUnit: 'write', members: ['dev1', 'owner1'], repos: [] },
    { name: 'ci-registry', permission: 'none', allRepos: true, codeUnit: 'none', members: ['ci-bot'], repos: [] },
    { name: 'app', permission: 'admin', allRepos: false, codeUnit: 'write', members: ['dev2'], repos: ['demo-app'] },
  ];
  assert.equal(explainPerm('owner1', 'x', teams, []).perm, 'owner');
  const h = explainPerm('dev1', 'x', teams, []);
  assert.equal(h.perm, 'write'); assert.ok(canUse(h.perm)); assert.ok(!canManage(h.perm));
  assert.equal(explainPerm('ci-bot', 'x', teams, []).perm, 'none');
  assert.equal(explainPerm('dev2', 'x', teams, []).perm, 'none');
  assert.equal(explainPerm('dev2', 'demo-app', teams, []).perm, 'admin');
  const c = explainPerm('guest', 'x', teams, [{ login: 'guest', perm: 'admin' }]);
  assert.equal(c.perm, 'admin'); assert.deepEqual(c.why, ['직접 협업자(admin)']);
});

test('이름 검사 — GitHub 규칙', () => {
  assert.equal(checkName('DEV_SSH_KEY'), null);
  assert.ok(checkName('1ABC'));
  assert.ok(checkName('A-B'));
  assert.equal(checkName('GITEA_X'), null);   // GitHub 에선 예약어가 아니다
  assert.ok(checkName('GITHUB_X'));
  assert.ok(checkName('github_token'));
  assert.ok(checkName(''));
});

test('파일 이름의 secrets.sh 는 참조가 아니다, 줄 주석은 세지 않는다', () => {
  assert.deepEqual(extractRefs('run: bash scripts/ci-secrets.sh\nrun: ./secrets.sh\nx: 1 # secrets.IN_COMMENT'), []);
  assert.deepEqual(extractRefs('x: "${{secrets.A}}"'), [{ kind: 'secret', name: 'A' }]);
});

test('"없으면 빈 값" 주석이 붙은 참조는 선택 값', () => {
  const r = extractRefs('AGE_KEY: ${{ secrets.AGE_KEY }}   # sops 용(없으면 빈 값, #38)\nK: ${{ secrets.K }}');
  assert.deepEqual(r, [{ kind: 'secret', name: 'AGE_KEY', optional: true }, { kind: 'secret', name: 'K' }]);
  // 한 곳이라도 꼭 필요하면 선택이 아니다
  assert.deepEqual(extractRefs('a: ${{ secrets.X }} # 선택\nb: ${{ secrets.X }}'), [{ kind: 'secret', name: 'X' }]);
});

test('템플릿 저장소(workflow_call)의 참조는 그 저장소 몫이 아니다', async () => {
  assert.ok(isTemplate('on:\n  workflow_call:\n    inputs: {}'));
  assert.ok(!isTemplate('on:\n  push:'));
  const u = await repoUsage([{ path: '.github/workflows/backend.yml', text: 'on:\n  workflow_call:\njobs: { a: { steps: [ { run: "${{ secrets.DEV_SSH_KEY }}" } ] } }' }], async () => null);
  assert.equal(u.refs.size, 0);
  assert.deepEqual(u.templateFiles, ['backend.yml']);
  const o = await repoUsage([{ path: 'x.yml', text: 'uses: demo-owner/ci-templates/.github/workflows/t.yml@main\nsecrets: inherit' }], async () => 'K: ${{ secrets.AGE }} # 없으면 빈 값');
  assert.deepEqual(o.refs.get('secret:AGE').usages, [{ workflow: 'x.yml', via: 'ci-templates/t.yml', optional: true }]);
});
