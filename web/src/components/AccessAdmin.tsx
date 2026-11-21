import { useMemo, useState } from 'react';
import { RefreshBar, usePoll } from '../poll';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { api, AccessList, AccessPerson, ROLE_LABEL, Role } from '../api';
import { defaultColDef, gridTheme, localeKo, when } from '../grid';
import { Picker } from './Picker';

// 설정 › 권한 — 로그인할 수 있는 GitHub 계정과 역할(관리자·배포 담당·보기). 여기 없는 계정은 로그인하지 못한다. 처음 관리자는 못 바꾼다
export function AccessAdmin({ me }: { me: string }) {
  const [data, setData] = useState<AccessList | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const load = () => api.access().then(setData).catch((e) => setErr(String(e?.message || e)));
  const poll = usePoll(load, 60000);

  const [add, setAdd] = useState('');
  async function change(login: string, b: { role?: Role | 'none' }) {
    setErr('');
    try { await api.setAccess(login, { ...b, rev: data?.rev }); } catch (e: any) { setErr(`${login}: ${e?.message || e}`); }
    await load();
  }
  const addOk = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(add.trim());

  const cols: ColDef<AccessPerson>[] = useMemo(() => [
    { headerName: '사람', minWidth: 220, flex: 1.2, valueGetter: (p) => `${p.data?.login} ${p.data?.fullName}`,
      cellRenderer: (p: ICellRendererParams<AccessPerson>) => p.data && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: '100%' }}>
          {p.data.avatar ? <img src={p.data.avatar} alt="" width={22} height={22} style={{ borderRadius: '50%' }} /> : <span className="dot unknown" />}
          <span style={{ fontWeight: 600 }}>{p.data.login}</span><span className="muted">{p.data.fullName}</span>
          {p.data.login === me && <span className="tag">나</span>}
        </div>
      ) },
    { headerName: '역할', minWidth: 170, flex: 0.8, valueGetter: (p) => p.data && ROLE_LABEL[p.data.role],
      cellRenderer: (p: ICellRendererParams<AccessPerson>) => p.data && (p.data.root
        ? <span title="서버 설정에서 지정된 관리자">관리자 <span className="muted">(처음 관리자)</span></span>
        // 폭을 못 박는다 — 알약이 글자 길이대로 늘어나면 줄마다 너비가 달라 들쭉날쭉하다(#148)
        : <Picker label="역할" value={p.data.role} style={{ width: 132 }} onChange={(v) => change(p.data!.login, { role: v as Role })}
            options={(['viewer', 'deployer', 'admin'] as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />) },
    { headerName: '', minWidth: 90, width: 100, sortable: false,
      cellRenderer: (p: ICellRendererParams<AccessPerson>) => p.data && !p.data.root && p.data.login !== me &&
        <button className="btn ghost" style={{ color: 'var(--red)' }} onClick={() => { if (confirm(`${p.data!.login} 를 빼면 로그인하지 못합니다. 뺄까요?`)) void change(p.data!.login, { role: 'none' }); }}>빼기</button> },
    { headerName: '바꾼 사람', minWidth: 160, flex: 0.7, valueGetter: (p) => (p.data?.by ? `${p.data.by}, ${when(p.data.at)}` : '') },
  ], [data, me]);   // eslint-disable-line

  return (
    <div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>관리자: 모든 기능, 배포 담당: 배포, 되돌리기, 예약, 재시작, 보기: 조회만</div>
      {data?.warning && <div className="panel amber" style={{ marginBottom: 12 }}>{data.warning}</div>}
      {err && <div className="panel err" style={{ marginBottom: 12 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
        <input placeholder="GitHub 아이디 추가" value={add} onChange={(e) => setAdd(e.target.value)} style={{ width: 200 }}
          onKeyDown={(e) => { if (e.key === 'Enter' && addOk) { void change(add.trim(), { role: 'viewer' }); setAdd(''); } }} />
        <button className="btn" disabled={!addOk} onClick={() => { void change(add.trim(), { role: 'viewer' }); setAdd(''); }}>추가(보기)</button>
        <span style={{ marginLeft: 'auto' }}><RefreshBar poll={poll} /></span>
      </div>
      <div style={{ height: Math.min(80 + (data?.people.length ?? 5) * 42, 720) }}>
        <AgGridReact<AccessPerson> theme={gridTheme} localeText={localeKo} rowData={data?.people ?? []} columnDefs={cols} defaultColDef={defaultColDef}
          rowHeight={42} quickFilterText={q} getRowId={(p) => p.data.login} loading={!data && !err} suppressCellFocus />
      </div>
    </div>
  );
}
