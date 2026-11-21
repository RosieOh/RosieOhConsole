#!/usr/bin/env node
// 생성 스크립트가 부르는 소스 고치기 — 기준 줄(앵커)을 찾아 그 자리에 끼운다.
// 앵커를 하나라도 못 찾으면 파일을 건드리지 않고 실패한다(반쯤 고친 상태를 남기지 않는다).
//
//   node patch.mjs <명령> --key=value ...
//     app-module  --file --name --pascal                         api/src/app.module.ts 에 컨트롤러·서비스 등록
//     web-app     --file --name --pascal --title --group --icon [--guard --store]  web/src/App.tsx 에 화면·메뉴 등록
//     web-api     --file --name --pascal --camel [--store]       web/src/api.ts 에 클라이언트 함수·타입
//     mock        --file --name                                  web/dev/mock-api.mjs 에 가짜 응답
//     catalog     --file --group --project --key --name --kind --repo [--group-name --project-name --note --prod]
//     infra       --file --id --name --repo [--ip --domains --note --key]   api/src/infra/defaults.ts 에 점검할 서버
import { readFileSync, writeFileSync } from 'node:fs';

const [cmd, ...rest] = process.argv.slice(2);
const a = {};
for (const s of rest) {
  const m = /^--([a-z-]+)(?:=(.*))?$/s.exec(s);
  if (!m) fail(`인자 형식이 아닙니다: ${s}`);
  a[m[1]] = m[2] ?? 'true';
}

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }
const need = (...keys) => { for (const k of keys) if (!a[k]) fail(`--${k} 가 필요합니다`); };
/** 작은따옴표 문자열 안에 넣을 값 */
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lastIndex = (L, re) => { for (let i = L.length - 1; i >= 0; i--) if (re.test(L[i])) return i; return -1; };
const indexOr = (L, re, what, from = 0) => {
  for (let i = from; i < L.length; i++) if (re.test(L[i])) return i;
  return fail(`${a.file} 에서 ${what} 를 찾지 못했습니다 — 파일 모양이 바뀌었으면 scripts/function/patch.mjs 를 고치세요`);
};

function edit(fn) {
  need('file');
  const src = readFileSync(a.file, 'utf8');
  const L = src.split('\n');
  fn(L);
  writeFileSync(a.file, L.join('\n'));
  console.log(`✓ 고침  ${a.file.replace(process.cwd() + '/', '')}`);
}

const commands = {
  'app-module'() {
    need('name', 'pascal');
    const P = a.pascal;
    edit((L) => {
      if (L.some((l) => l.includes(`{ ${P}Controller }`))) fail(`${P}Controller 는 이미 등록돼 있습니다`);
      const li = lastIndex(L, /^import \{ .* \} from '\.\/.*\.js';$/);
      if (li < 0) fail('상대 경로 import 줄을 찾지 못했습니다');
      const ci = indexOr(L, /^\s*controllers: \[.*\],$/, 'controllers: [...]');
      const pi = indexOr(L, /^\s*providers: \[.*\],$/, 'providers: [...]');
      L[ci] = L[ci].replace(/\],$/, `, ${P}Controller],`);
      L[pi] = L[pi].replace(/\],$/, `, ${P}Service],`);
      L.splice(li + 1, 0,
        `import { ${P}Controller } from './${a.name}/${a.name}.controller.js';`,
        `import { ${P}Service } from './${a.name}/${a.name}.service.js';`);
    });
  },

  'web-app'() {
    need('name', 'pascal', 'title', 'group', 'icon');
    const { name, pascal: P, group, icon } = a;
    const navIcon = `${P}NavIcon`;
    edit((L) => {
      // Page 타입
      const ti = indexOr(L, /^type Page = .*;$/, 'type Page = ...');
      if (L[ti].includes(`'${name}'`)) fail(`화면 '${name}' 은 이미 있습니다`);
      // 메뉴 묶음 — 그 묶음의 items: [ ... ] 끝에 붙인다
      // 묶음 정의는 줄 머리에 `{ id: 'x', label:` 또는(여러 줄로 쓴 것) `id: 'x', label:` 로 온다. 화면 항목은 줄 가운데에 있다
      const g0 = indexOr(L, /^const GROUPS: Group\[\] = \[$/, 'const GROUPS: Group[] = [');
      const g1 = indexOr(L, /^\];$/, 'GROUPS 의 끝(];)', g0);
      const head = /^\s*(?:\{ )?id: '([a-z-]+)', label:/;
      const gi = L.findIndex((l, i) => i > g0 && i < g1 && head.exec(l)?.[1] === group);
      if (gi < 0) {
        const ids = L.slice(g0, g1).map((l) => head.exec(l)?.[1]).filter(Boolean);
        fail(`메뉴 묶음 '${group}' 이 없습니다. 있는 것: ${ids.join(', ')}`);
      }
      const ii = indexOr(L, /items: \[.*\}\]/, `'${group}' 묶음의 items`, gi);
      if (ii - gi > 4) fail(`'${group}' 묶음의 items 줄이 너무 멀리 있습니다`);
      const admin = a.guard === 'admin' ? ', admin: true' : '';
      L[ii] = L[ii].replace(/(items: \[.*\})\]/, `$1, { id: '${name}', label: '${q(a.title)}', icon: ${navIcon}${admin} }]`);
      L[ti] = L[ti].replace(/;$/, ` | '${name}';`);
      // lucide 아이콘 — 같은 이름이 이미 있어도 겹치지 않게 별칭으로
      const li = indexOr(L, /^import \{ .* \} from 'lucide-react';$/, "lucide-react import");
      L[li] = L[li].replace(/ \} from 'lucide-react';$/, `, ${icon} as ${navIcon} } from 'lucide-react';`);
      // 그리기 — 설정 화면 바로 위
      const ri = indexOr(L, /\{page === 'settings' && /, "{page === 'settings' && ...}");
      const pad = /^\s*/.exec(L[ri])[0];
      // 쓰기 버튼이 있는 화면(--store)이나 배포 담당 전용이면 deployer 를 넘긴다
      const props = a.store || a.guard === 'deployer' ? ' deployer={me.deployer}' : '';
      const el = `{page === '${name}'${a.guard === 'admin' ? ' && me.admin' : ''} && <${P}${props} />}`;
      L.splice(ri, 0, pad + el);
      // 화면 import — 마지막 ./components/ import 다음
      const ci = lastIndex(L, /^import \{ .* \} from '\.\/components\/.*';$/);
      if (ci < 0) fail("'./components/' import 줄을 찾지 못했습니다");
      L.splice(ci + 1, 0, `import { ${P} } from './components/${P}';`);
    });
  },

  'web-api'() {
    need('name', 'pascal', 'camel');
    const { name, pascal: P, camel } = a;
    edit((L) => {
      if (L.some((l) => new RegExp(`^  ${esc(camel)}: `).test(l))) fail(`api.${camel} 는 이미 있습니다`);
      const ai = indexOr(L, /^export const api = \{$/, 'export const api = {');
      const end = indexOr(L, /^\};$/, 'api 객체의 끝(};)', ai);
      const lines = [`  ${camel}: (refresh = false) => j('GET', '/${name}' + (refresh ? '?refresh=1' : '')) as Promise<${P}View>,`];
      if (a.store) {
        lines.push(`  ${camel}Save: (b: { rev?: number; id: string; name: string; note?: string }) => j('POST', '/${name}', b) as Promise<{ ok: boolean; rev: number }>,`);
        lines.push(`  ${camel}Delete: (id: string, rev?: number) => j('DELETE', \`/${name}/\${encodeURIComponent(id)}\` + (rev !== undefined ? \`?rev=\${rev}\` : '')) as Promise<{ ok: boolean; rev: number }>,`);
      }
      L.splice(end, 0, ...lines);
      while (L.length && L[L.length - 1] === '') L.pop();
      L.push('',
        `// ${a.title || name} — api/src/${name}/model.ts 와 같은 모양`,
        `export interface ${P}Item { id: string; name: string; note?: string; updatedAt?: string }`,
        `export interface ${P}View { items: ${P}Item[]; updatedAt: string${a.store ? '; rev: number; warning: string | null' : ''} }`,
        '');
    });
  },

  mock() {
    need('name');
    edit((L) => {
      if (L.some((l) => l.includes(`/^\\/${a.name}$/`))) fail(`가짜 응답 /${a.name} 은 이미 있습니다`);
      while (L.length && L[L.length - 1] === '') L.pop();
      const body = a.store
        ? `{ rev: 1, warning: null, updatedAt: iso(1), items: [{ id: 'sample', name: '예시 항목', note: '가짜 API' }] }`
        : `{ updatedAt: iso(1), items: [{ id: 'sample', name: '예시 항목', note: '가짜 API' }] }`;
      L.push('', `// ${a.title || a.name} (scripts/new-page.bash 가 추가)`, 'ROUTES.push(',
        `  ['GET', /^\\/${a.name}$/, () => (${body})],`);
      if (a.store) L.push(`  ['POST', /^\\/${a.name}$/, () => ({ ok: true, rev: 2 })],`, `  ['DELETE', /^\\/${a.name}\\/[^/]+$/, () => ({ ok: true, rev: 2 })],`);
      L.push(');', '');
    });
  },

  infra() {
    need('id', 'name', 'repo');
    const { id } = a;
    const sub = [a.ip, ...(a.domains ? a.domains.split(',').map((x) => x.trim()).filter(Boolean) : []), a.note].filter(Boolean).join(', ');
    const hosts = [a.ip, ...(a.domains ? a.domains.split(',').map((x) => x.trim()).filter(Boolean) : [])].filter(Boolean);
    const line = `  { id: '${q(id)}', kind: 'server', name: '${q(a.name)}'${sub ? `, sub: '${q(sub)}'` : ''}${hosts.length ? `, hosts: [${hosts.map((h) => `'${q(h)}'`).join(', ')}]` : ''}, probe: { repo: '${q(a.repo)}', key: '${a.key === 'dev' ? 'dev' : 'prod'}' } },`;
    edit((L) => {
      const i0 = indexOr(L, /^export const DEFAULT_INFRA: InfraDef\[\] = \[$/, 'export const DEFAULT_INFRA: InfraDef[] = [');
      const i1 = indexOr(L, /^\];$/, 'DEFAULT_INFRA 의 끝(];)', i0);
      if (L.slice(i0, i1).some((l) => l.includes(`id: '${id}'`))) fail(`서버 id '${id}' 는 이미 있습니다`);
      L.splice(i1, 0, line);
    });
  },

  catalog() {
    need('group', 'project', 'key', 'name', 'kind', 'repo');
    const { group, project, key } = a;
    const extra = [a.prod && `prod: site('${q(a.prod)}')`, a.note && `note: '${q(a.note)}'`].filter(Boolean);
    const comp = `['${key}', '${q(a.name)}', '${a.kind}', '${q(a.repo)}'${extra.length ? `, { ${extra.join(', ')} }` : ''}]`;
    edit((L) => {
      const src = L.join('\n');
      if (new RegExp(`\\[\\['${esc(key)}', |^\\s{6}\\['${esc(key)}', `, 'm').test(src)) fail(`구성요소 key '${key}' 는 이미 있습니다`);
      const t0 = indexOr(L, /^const TREE: G\[\] = \[$/, 'const TREE: G[] = [');
      const tEnd = indexOr(L, /^\];$/, 'TREE 의 끝(];)', t0);
      const gi = L.findIndex((l, i) => i > t0 && i < tEnd && l.startsWith(`  ['${group}', '`));
      if (gi < 0) {
        if (!a['group-name']) {
          const ids = L.slice(t0, tEnd).filter((l) => /^ {2}\['/.test(l)).map((l) => /^ {2}\['([^']+)'/.exec(l)[1]);
          fail(`그룹 '${group}' 이 없습니다 — 새로 만들려면 --group-name 을 주세요. 있는 것: ${ids.join(', ')}`);
        }
        L.splice(tEnd, 0, `  ['${group}', '${q(a['group-name'])}', [`, `    ['${project}', '${q(a['project-name'] || a.name)}', [${comp}]],`, '  ]],');
        return;
      }
      const gEnd = indexOr(L, /^ {2}\]\],$/, `그룹 '${group}' 의 끝`, gi + 1);
      const other = L.findIndex((l, i) => (i < gi || i > gEnd) && i > t0 && i < tEnd && l.startsWith(`    ['${project}', '`));
      if (other >= 0) fail(`프로젝트 '${project}' 는 다른 그룹에 있습니다(${other + 1}번째 줄)`);
      const pi = L.findIndex((l, i) => i > gi && i < gEnd && l.startsWith(`    ['${project}', '`));
      if (pi < 0) {
        L.splice(gEnd, 0, `    ['${project}', '${q(a['project-name'] || a.name)}', [${comp}]],`);
        return;
      }
      const one = /^( {4}\['[^']+', '(?:[^'\\]|\\.)*', \[)(.*)\]\],\s*$/.exec(L[pi]);
      if (one && one[2]) {
        // 한 줄짜리 프로젝트 → 여러 줄로 펴서 붙인다
        L.splice(pi, 1, one[1], `      ${one[2]},`, `      ${comp},`, '    ]],');
        return;
      }
      if (!/\[$/.test(L[pi])) fail(`프로젝트 '${project}' 줄의 모양을 모릅니다: ${L[pi].trim()}`);
      const pEnd = indexOr(L, /^ {4}\]\],$/, `프로젝트 '${project}' 의 끝`, pi + 1);
      L.splice(pEnd, 0, `      ${comp},`);
    });
  },
};

if (!commands[cmd]) fail(`명령을 모릅니다: ${cmd ?? '(없음)'} — ${Object.keys(commands).join(' | ')}`);
commands[cmd]();
