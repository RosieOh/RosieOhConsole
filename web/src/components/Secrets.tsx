import { UsersRound } from 'lucide-react';
import { ghRepo } from '../github';
import { User, Users } from '../users';
import { KeyRound as KeyRoundIcon } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshBar, usePoll } from '../poll';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { api, SecretItem, SecretPerson, SecretRepo, SecretUsage, SecretsOverview } from '../api';
import { useCatalog } from '../catalog';
import { defaultColDef, gridTheme, localeKo, when } from '../grid';
import { Drawer } from './Drawer';
import { Logo } from './Logo';
import { Picker } from './Picker';

// 시크릿·변수(#21) — 이름·사용처·권한. 값은 GitHub 이 돌려주지 않는다(변수만 값이 보인다). 바꾸기는 관리자만
const STATUS: Record<SecretItem['status'], [string, string, string]> = {
  used: ['사용 중', 'green', '워크플로가 이 값을 쓴다'],
  unused: ['정리 후보', 'amber', '정의돼 있지만 어떤 워크플로도 쓰지 않는다'],
  missing: ['정의 없음', 'red', '워크플로에서 쓰지만 정의되지 않음'],
  optional: ['선택(없음)', 'muted', '정의 없지만 쓰는 곳이 모두 "없으면 빈 값"으로 돌도록 돼 있다'],
};
const KIND = { secret: '시크릿', variable: '변수' } as const;
const PERM: Record<string, string> = { owner: '소유자', admin: '관리', write: '쓰기', read: '읽기', none: '없음' };
type Filter = 'all' | SecretItem['status'] | 'override';

const usageText = (u: SecretUsage) => `${u.repo}, ${u.workflow}${u.via ? ` (템플릿 ${u.via})` : ''}${u.optional ? ', 선택' : ''}`;
const settingsUrl = (scope: string) => `${ghRepo(scope)}/settings/secrets/actions`;

function useRepoFace() {
  const { catalog } = useCatalog();
  return useCallback((repo: string) => {
    const c = catalog?.components.find((x) => x.repo === repo);
    return c ? { name: c.name, logo: c.logo } : null;
  }, [catalog]);
}

function ScopeCell({ scope, org }: { scope: string; org: string }) {
  const face = useRepoFace();
  if (scope === 'org') return <span style={{ display: 'flex', alignItems: 'center', gap: 7, height: '100%' }}><Logo name={org} size={20} /><b>{org}</b><span className="muted">조직 전체</span></span>;
  const f = face(scope);
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 7, height: '100%' }}>
      <Logo file={f?.logo} name={f?.name ?? scope} size={20} />
      <span className="mono">{scope}</span>{f && <span className="muted">{f.name}</span>}
    </span>
  );
}

function People({ list, empty }: { list: SecretPerson[]; empty: string }) {
  if (!list.length) return <div className="muted">{empty}</div>;
  return <>{list.map((p) => <div key={p.login} className="kv"><span className="k"><User login={p.login} /></span><span className="v">{PERM[p.perm]}<span className="muted">, {p.why.join(', ') || ''}</span></span></div>)}</>;
}

function WriteForm({ item, scopeRepo, onDone, needConfirm }: { item: { kind: 'secret' | 'variable'; name: string; scope: string; value?: string }; scopeRepo?: string; needConfirm: boolean; onDone: (m: string) => void }) {
  const [value, setValue] = useState(item.kind === 'variable' ? item.value ?? '' : '');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    setBusy(true); setErr('');
    try {
      const r = await api.secretSet({ scope: item.scope === 'org' ? 'org' : 'repo', repo: scopeRepo, kind: item.kind, name: item.name, value, confirm: needConfirm ? confirm : undefined });
      setValue('');
      onDone(`${item.name} ${r.created ? '만들었습니다' : '값을 바꿨습니다'}. 다음 실행부터 적용됩니다.${r.usedBy.length ? ` 사용처: ${r.usedBy.map(usageText).join(', ')}` : ''}`);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  return (
    <div className="panel" style={{ borderColor: 'var(--amber)' }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{needConfirm ? '새 값으로 바꿉니다. 되돌릴 수 없습니다.' : '새로 만듭니다.'}</div>
      {item.kind === 'secret'
        ? <input type="password" autoComplete="new-password" placeholder="새 값" value={value} onChange={(e) => setValue(e.target.value)} />
        : <textarea placeholder="값" value={value} onChange={(e) => setValue(e.target.value)} style={{ minHeight: 60 }} />}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {needConfirm && <input placeholder={`확인: ${item.name} 입력`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        <button className="btn primary" disabled={busy || !value || (needConfirm && confirm !== item.name)} onClick={go}>{busy ? '요청 중…' : needConfirm ? '값 바꾸기' : '만들기'}</button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

function DeleteForm({ item, onDone }: { item: SecretItem; onDone: (m: string) => void }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    setBusy(true); setErr('');
    try {
      await api.secretDelete({ scope: item.scope === 'org' ? 'org' : 'repo', repo: item.scope === 'org' ? undefined : item.scope, kind: item.kind, name: item.name, confirm });
      onDone(`${item.name} 를 지웠습니다.${item.usedBy.length ? ` 이걸 쓰던 ${item.usedBy.length}곳은 다음 실행부터 빈 값을 받습니다.` : ''}`);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  return (
    <div className="panel" style={{ borderColor: 'var(--red)' }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        지우면 되돌릴 수 없습니다.{item.usedBy.length > 0 && <span className="red"> 아직 {item.usedBy.length}곳에서 씁니다.</span>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input placeholder={`확인: ${item.name} 입력`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button className="btn" style={{ color: 'var(--red)' }} disabled={busy || confirm !== item.name} onClick={go}>{busy ? '요청 중…' : '지우기'}</button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

function Detail({ it, d, admin, onDone }: { it: SecretItem; d: SecretsOverview; admin: boolean; onDone: (m: string) => void }) {
  const repo = it.scope === 'org' ? null : d.repos.find((r) => r.repo === it.scope) ?? null;
  const [label, cls, explain] = STATUS[it.status];
  const canWrite = it.scope === 'org' ? d.write.org : d.write.repo;
  const [mode, setMode] = useState<'' | 'set' | 'delete'>('');
  const orgPeople: SecretPerson[] = d.orgOwners.map((login) => ({ login, perm: 'owner', why: ['조직 소유자(Owners 팀)'], manage: true, use: true }));
  return (
    <div>
      <h2><span className="mono">{it.name}</span><span className="tag">{KIND[it.kind]}</span></h2>
      <div style={{ marginTop: 8 }}><ScopeCell scope={it.scope} org={d.org} /></div>
      <div className="sec">
        <h3>상태</h3>
        <div><span className={'chip ' + cls}>{label}</span> <span className="muted">{explain}</span></div>
        {it.overrides && <div className="amber" style={{ marginTop: 6, fontSize: 12 }}>같은 이름의 조직 값이 있지만 이 저장소에서는 저장소 값이 이깁니다(덮어씀).</div>}
        {!!it.overriddenIn?.length && <div className="amber" style={{ marginTop: 6, fontSize: 12 }}>이 저장소들에서는 저장소 값이 조직 값을 덮습니다: {it.overriddenIn.join(', ')}</div>}
        {it.created && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>만든 날짜 {when(it.created)}</div>}
        {it.description && <div className="muted" style={{ fontSize: 12 }}>{it.description}</div>}
        {it.kind === 'variable' && it.status !== 'missing' && it.status !== 'optional' && <div className="out" style={{ marginTop: 8 }}>{it.value || '(빈 값)'}</div>}
        {it.kind === 'secret' && <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>값은 볼 수 없고 바꾸기만 할 수 있습니다.</div>}
      </div>
      <div className="sec">
        <h3>쓰는 곳 {it.usedBy.length}</h3>
        {it.usedBy.length === 0 ? <div className="muted">없음</div> : it.usedBy.map((u, i) => (
          <div key={i} className="kv">
            <span className="k"><a href={`${ghRepo(u.repo)}/blob/${d.repos.find((r) => r.repo === u.repo)?.defaultBranch ?? 'main'}/.github/workflows/${u.workflow}`} target="_blank" rel="noreferrer">{u.repo}, {u.workflow}</a></span>
            <span className="v muted">{u.via ? `템플릿 ${u.via} 경유` : '직접'}{u.optional ? ', 없어도 됨' : ''}</span>
          </div>
        ))}
      </div>
      <div className="sec">
        <h3>바꿀 수 있는 사람</h3>
        <People list={it.scope === 'org' ? orgPeople : (repo?.people ?? []).filter((p) => p.manage)} empty="없음" />
        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>{it.scope === 'org' ? '조직 시크릿, 변수는 조직 소유자만 바꿉니다.' : '저장소 관리 권한 필요'}</div>
      </div>
      {repo && (
        <div className="sec">
          <h3>쓸 수 있는 사람(워크플로를 올려 값을 꺼낼 수 있음)</h3>
          <People list={repo.people.filter((p) => p.use && !p.manage)} empty="(바꿀 수 있는 사람 말고는) 없음" />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>쓰기 권한이 있으면 워크플로를 바꿔 실행할 수 있어 시크릿 값을 쓸 수 있습니다. 보호 브랜치 규칙이 이걸 막지는 않습니다(작업 브랜치에서도 실행됨).</div>
        </div>
      )}
      <div className="sec">
        <h3>관리</h3>
        {!admin && <div className="muted">바꾸기는 관리자만 할 수 있습니다.</div>}
        {admin && !canWrite && <div className="amber" style={{ fontSize: 12 }}>GitHub 에서 변경: <a href={settingsUrl(it.scope)} target="_blank" rel="noreferrer">설정 열기 ↗</a>{d.write.reason && <div className="muted">{d.write.reason}</div>}</div>}
        {admin && canWrite && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button className={'btn' + (mode === 'set' ? ' primary' : ' ghost')} onClick={() => setMode(mode === 'set' ? '' : 'set')}>{it.status === 'missing' || it.status === 'optional' ? '만들기' : '값 바꾸기'}</button>
              {it.status !== 'missing' && it.status !== 'optional' && <button className="btn ghost" style={{ color: 'var(--red)' }} onClick={() => setMode(mode === 'delete' ? '' : 'delete')}>지우기</button>}
              <a className="btn ghost" href={settingsUrl(it.scope)} target="_blank" rel="noreferrer">GitHub 설정 ↗</a>
            </div>
            {mode === 'set' && <WriteForm item={it} scopeRepo={it.scope === 'org' ? undefined : it.scope} needConfirm={it.status !== 'missing' && it.status !== 'optional'} onDone={onDone} />}
            {mode === 'delete' && <DeleteForm item={it} onDone={onDone} />}
          </>
        )}
      </div>
    </div>
  );
}

function NewForm({ d, onDone }: { d: SecretsOverview; onDone: (m: string) => void }) {
  const [scope, setScope] = useState<string>(d.write.org ? 'org' : d.repos.find((r) => !r.archived)?.repo ?? '');
  const [kind, setKind] = useState<'secret' | 'variable'>('secret');
  const [name, setName] = useState('');
  const exists = d.items.some((i) => i.scope === scope && i.kind === kind && i.name === name && i.status !== 'missing' && i.status !== 'optional');
  const ok = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !/^GITHUB_/i.test(name);
  return (
    <div>
      <h2>새 시크릿, 변수</h2>
      <div className="sec">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Picker label="범위" value={scope} onChange={setScope} style={{ minWidth: 200 }}
            options={[{ value: 'org', label: `${d.org}(조직 전체)${d.write.org ? '' : ' (사용자 계정엔 없음)'}`, disabled: !d.write.org },
              ...d.repos.filter((r) => !r.archived).map((r) => ({ value: r.repo, label: r.repo }))]} />
          <Picker label="종류" value={kind} onChange={(v) => setKind(v as any)} style={{ minWidth: 120 }}
            options={[{ value: 'secret', label: '시크릿' }, { value: 'variable', label: '변수' }]} />
          <input placeholder="이름(영문 대문자, _)" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} style={{ flex: 1, minWidth: 180 }} />
        </div>
        {/* 이름이 들어와야 아래 WriteForm 이 열린다 — 그 전까지는 창이 비어 보여서 한 줄 안내 */}
        {!name && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>이름을 넣으면 값과 설명을 적는 칸이 열립니다</div>}
        {name && !ok && <div className="err">이름은 영문, 숫자, _ 만, 숫자로 시작 X, GITHUB_ 로 시작 X</div>}
        {exists && <div className="amber" style={{ fontSize: 12, marginTop: 6 }}>이미 있는 이름입니다.</div>}
      </div>
      {ok && !exists && scope && (
        <WriteForm key={`${scope}/${kind}/${name}`} item={{ kind, name, scope }} scopeRepo={scope === 'org' ? undefined : scope} needConfirm={false} onDone={onDone} />
      )}
    </div>
  );
}

export function Secrets({ admin }: { admin: boolean }) {
  const [d, setD] = useState<SecretsOverview | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [tab, setTab] = useState<'items' | 'repos'>('items');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState('');
  const grid = useRef<AgGridReact<any>>(null);
  const face = useRepoFace();

  const load = useCallback((refresh = false) => {
    setErr(''); setBusy(true);
    return api.secrets(refresh).then(setD).catch((e) => { setErr(String(e?.message || e)); throw e; }).finally(() => setBusy(false));
  }, []);
  const poll = usePoll(load, 300000);

  const keyOf = (i: SecretItem) => `${i.scope}/${i.kind}/${i.name}/${i.status}`;
  // 표에 넣을 값은 줄 데이터에 미리 담는다(열 정의가 화면 상태를 붙잡지 않게)
  type Row = SecretItem & { managers: string; managerList: string[] };
  type RepoRow = SecretRepo & { count: number; missing: number };
  const rows: Row[] = useMemo(() => (d?.items ?? [])
    .filter((i) => filter === 'all' || (filter === 'override' ? i.overrides || !!i.overriddenIn?.length : i.status === filter))
    .map((i) => { const list = i.scope === 'org' ? d!.orgOwners : (d!.repos.find((r) => r.repo === i.scope)?.people ?? []).filter((p) => p.manage).map((p) => p.login); return { ...i, managerList: list, managers: list.join(', ') }; }), [d, filter]);
  const repoRows: RepoRow[] = useMemo(() => (d?.repos ?? []).map((r) => ({
    ...r, count: d!.items.filter((i) => i.scope === r.repo && (i.status === 'used' || i.status === 'unused')).length,
    missing: d!.items.filter((i) => i.scope === r.repo && i.status === 'missing').length,
  })), [d]);
  const count = (f: Filter) => (d?.items ?? []).filter((i) => (f === 'all' ? true : f === 'override' ? i.overrides || !!i.overriddenIn?.length : i.status === f)).length;

  const cols: ColDef<Row>[] = useMemo(() => [
    { headerName: '이름', pinned: 'left', minWidth: 230, flex: 1.1, field: 'name',
      cellRenderer: (p: ICellRendererParams<Row>) => p.data && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ fontWeight: 600 }}>{p.data.name}</span><span className="tag">{KIND[p.data.kind]}</span>
        </span>) },
    { headerName: '범위', minWidth: 250, flex: 1.2, valueGetter: (p) => (p.data?.scope === 'org' ? `${d?.org} 조직` : `${p.data?.scope} ${face(p.data?.scope ?? '')?.name ?? ''}`),
      cellRenderer: (p: ICellRendererParams<Row>) => p.data && <ScopeCell scope={p.data.scope} org={d?.org ?? ''} /> },
    { headerName: '상태', minWidth: 140, width: 150, valueGetter: (p) => p.data && STATUS[p.data.status][0],
      cellRenderer: (p: ICellRendererParams<Row>) => p.data && (
        <span>
          <span className={'chip ' + STATUS[p.data.status][1]} style={{ lineHeight: 1.5 }} title={STATUS[p.data.status][2]}>{STATUS[p.data.status][0]}</span>
          {(p.data.overrides || !!p.data.overriddenIn?.length) && <span className="chip amber" style={{ marginLeft: 4, lineHeight: 1.5 }} title="조직, 저장소에 같은 이름">덮어씀</span>}
        </span>
      ) },
    { headerName: '쓰는 곳', minWidth: 260, flex: 1.6, valueGetter: (p) => p.data?.usedBy.map(usageText).join(' / ') ?? '',
      cellRenderer: (p: ICellRendererParams<Row>) => p.data && (p.data.usedBy.length === 0 ? <span className="muted"></span>
        : <span title={p.data.usedBy.map(usageText).join('\n')}><b>{p.data.usedBy.length}</b> <span className="muted">{p.data.usedBy.slice(0, 2).map(usageText).join(' / ')}{p.data.usedBy.length > 2 ? ' …' : ''}</span></span>) },
    { headerName: '바꿀 수 있는 사람', minWidth: 170, flex: 0.8, field: 'managers', cellRenderer: (p: ICellRendererParams<Row>) => <Users logins={p.data!.managerList} /> },
    { headerName: '만든 날짜', minWidth: 120, width: 130, valueGetter: (p) => p.data?.created ?? '', valueFormatter: (p) => when(p.value) },
  ], [d, face]);   // eslint-disable-line

  const repoCols: ColDef<RepoRow>[] = useMemo(() => [
    { headerName: '저장소', pinned: 'left', minWidth: 260, flex: 1.2, field: 'repo', cellRenderer: (p: ICellRendererParams<RepoRow>) => p.data && <ScopeCell scope={p.data.repo} org={d?.org ?? ''} /> },
    { headerName: '시크릿, 변수', width: 120, field: 'count' },
    { headerName: '문제', width: 110, field: 'missing',
      cellRenderer: (p: ICellRendererParams<RepoRow>) => (p.value ? <span className="chip red" style={{ lineHeight: 1.5 }}>정의 없음 {p.value}</span> : <span className="muted"></span>) },
    { headerName: '보관', width: 80, hide: true, valueGetter: (p) => (p.data?.archived ? '보관' : '') },
    { headerName: '워크플로', minWidth: 160, flex: 0.8, valueGetter: (p) => p.data?.workflows.join(', ') },
    { headerName: '부르는 공용 템플릿', minWidth: 200, flex: 1, valueGetter: (p) => p.data?.templates.join(', ') },
    { headerName: '이 저장소가 내주는 템플릿', minWidth: 160, flex: 0.7, hide: !(d?.repos.some((r) => r.templateFiles.length)), valueGetter: (p) => p.data?.templateFiles.join(', ') },
    { headerName: '바꿀 수 있는 사람(관리 이상)', minWidth: 200, flex: 1, valueGetter: (p) => p.data?.people.filter((x) => x.manage).map((x) => x.login).join(', '), cellRenderer: (p: ICellRendererParams<RepoRow>) => <Users logins={p.data!.people.filter((x) => x.manage).map((x) => x.login)} /> },
    { headerName: '쓸 수 있는 사람(쓰기)', minWidth: 180, flex: 0.9, valueGetter: (p) => p.data?.people.filter((x) => x.use && !x.manage).map((x) => x.login).join(', '), cellRenderer: (p: ICellRendererParams<RepoRow>) => <Users logins={p.data!.people.filter((x) => x.use && !x.manage).map((x) => x.login)} /> },
  ], [d]);

  const sel = d?.items.find((i) => keyOf(i) === open);
  const done = (m: string) => { setOpen(null); setCreating(false); setMsg(m); load(true); };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1><KeyRoundIcon size={22} />시크릿</h1>
          <div className="sub">저장소별 시크릿, 변수, 사용처와 수정 권한{d && `, 갱신 ${when(d.updatedAt)}`}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          {admin && <button className="btn primary" disabled={!d} onClick={() => setCreating(true)}>새로 만들기</button>}
          <button className="btn ghost" onClick={() => grid.current?.api.exportDataAsCsv({ fileName: `시크릿-${new Date().toISOString().slice(0, 10)}.csv` })}>CSV</button>
          <RefreshBar poll={poll} />
        </div>
      </div>
      {err && <div className="panel err">{err}</div>}
      {msg && <div className="panel" style={{ marginBottom: 12, borderColor: 'var(--green)' }}>{msg}</div>}
      {d?.warnings.map((w) => <div key={w} className="panel amber" style={{ marginBottom: 12 }}>{w}</div>)}
      
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <div className="seg">
          <button className={'segbtn' + (tab === 'items' ? ' on' : '')} onClick={() => setTab('items')}>시크릿, 변수</button>
          <button className={'segbtn' + (tab === 'repos' ? ' on' : '')} onClick={() => setTab('repos')}>저장소별 권한</button>
        </div>
        {tab === 'items' && (
          <div className="seg">
            {([['all', '전체'], ['used', '사용 중'], ['unused', '정리 후보'], ['missing', '정의 없음'], ['optional', '선택(없음)'], ['override', '덮어씀']] as [Filter, string][]).map(([f, l]) => (
              <button key={f} className={'segbtn' + (filter === f ? ' on' : '')} onClick={() => setFilter(f)}>
                {l} <span className={f === 'missing' && count(f) ? 'red' : 'muted'}>{d ? count(f) : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'items' ? (
        <div style={{ height: Math.min(90 + rows.length * 44, 720) }}>
          <AgGridReact<Row> ref={grid} theme={gridTheme} localeText={localeKo} rowData={rows} columnDefs={cols} defaultColDef={defaultColDef}
            rowHeight={44} quickFilterText={q} getRowId={(p) => keyOf(p.data)} loading={!d && !err} suppressCellFocus rowStyle={{ cursor: 'pointer' }}
            onRowClicked={(e) => { if (!(e.event?.target as HTMLElement)?.closest('a')) setOpen(keyOf(e.data!)); }} />
        </div>
      ) : (
        <>
          <div className="team-grid">
            {d?.teams.map((t) => (
              <div key={t.name} className="team-card">
                <div className="team-head"><UsersRound size={15} /><b>{t.name}</b><span className="chip">{PERM[t.permission] ?? t.permission}{t.allRepos ? ', 모든 저장소' : ''}</span></div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>{t.members.length ? t.members.map((m) => <User key={m} login={m} />) : <span className="muted">없음</span>}</div>
              </div>
            ))}
          </div>
          <div style={{ height: Math.min(90 + (d?.repos.length ?? 5) * 44, 720) }}>
            <AgGridReact<RepoRow> theme={gridTheme} localeText={localeKo} rowData={repoRows} columnDefs={repoCols} defaultColDef={defaultColDef}
              rowHeight={44} quickFilterText={q} getRowId={(p) => p.data.repo} loading={!d && !err} suppressCellFocus />
          </div>
        </>
      )}

      {sel && d && <Drawer onClose={() => setOpen(null)}><Detail key={open!} it={sel} d={d} admin={admin} onDone={done} /></Drawer>}
      {creating && d && <Drawer onClose={() => setCreating(false)}><NewForm d={d} onDone={done} /></Drawer>}
    </div>
  );
}
