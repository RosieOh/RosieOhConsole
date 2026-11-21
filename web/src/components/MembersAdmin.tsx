import { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { UserPlus } from 'lucide-react';
import { ACCOUNT_STATUS, AccountAction, AdminAccount, api, ROLE_LABEL } from '../api';
import { defaultColDef, gridTheme, localeKo, when } from '../grid';
import { RefreshBar, usePoll } from '../poll';
import { Section } from './Section';

const JOINED = { signup: '회원가입', github: 'GitHub', admin: '관리자' } as const;
const ACT: Record<AccountAction, string> = { approve: '승인', reject: '거절', suspend: '정지', activate: '다시 쓰게', 'reset-password': '임시 비밀번호', delete: '지우기' };

// 설정 › 회원 — 가입 승인·거절, 정지·해제, 임시 비밀번호, 지우기. 역할은 권한 탭에서
export function MembersAdmin({ me }: { me: string }) {
  const [list, setList] = useState<AdminAccount[] | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [temp, setTemp] = useState<{ login: string; pw: string } | null>(null);
  const [q, setQ] = useState('');
  const load = () => api.accounts().then((r) => setList(r.accounts)).catch((e) => setErr(String(e?.message || e)));
  const poll = usePoll(load, 60_000);

  async function act(a: AdminAccount, action: AccountAction) {
    const ask: Partial<Record<AccountAction, string>> = {
      suspend: `${a.login} 를 정지할까요? 지금 로그인도 끊깁니다.`,
      delete: `${a.login} 계정을 지울까요? 권한도 함께 지워지고 되돌릴 수 없습니다.`,
      'reset-password': `${a.login} 의 비밀번호를 임시 비밀번호로 바꿀까요? 그 사람의 로그인은 끊깁니다.`,
      reject: `${a.login} 의 가입을 거절할까요?`,
    };
    if (ask[action] && !confirm(ask[action])) return;
    setErr(''); setNote(''); setTemp(null);
    try {
      const r = await api.accountAction(a.login, action);
      if (r.tempPassword) setTemp({ login: a.login, pw: r.tempPassword });
      else setNote(`${a.login}: ${ACT[action]} 했습니다`);
      await load();
    } catch (e: any) { setErr(`${a.login}: ${e?.message || e}`); }
  }

  const pending = (list ?? []).filter((a) => a.status === 'pending');
  const cols: ColDef<AdminAccount>[] = useMemo(() => [
    { headerName: '사람', minWidth: 220, flex: 1.2, valueGetter: (p) => `${p.data?.login} ${p.data?.name} ${p.data?.email}`,
      cellRenderer: (p: ICellRendererParams<AdminAccount>) => p.data && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: '100%' }}>
          <span style={{ fontWeight: 600 }}>{p.data.name}</span><span className="muted mono">@{p.data.login}</span>
          {p.data.login === me && <span className="tag">나</span>}
        </div>) },
    { headerName: '상태', width: 110, valueGetter: (p) => p.data && ACCOUNT_STATUS[p.data.status][0],
      cellRenderer: (p: ICellRendererParams<AdminAccount>) => p.data && <span className={'chip ' + ACCOUNT_STATUS[p.data.status][1]}>{ACCOUNT_STATUS[p.data.status][0]}</span> },
    { headerName: '역할', width: 110, valueGetter: (p) => p.data && (p.data.status === 'active' ? ROLE_LABEL[p.data.role] : '') },
    { headerName: '로그인 방법', width: 150, valueGetter: (p) => p.data && [p.data.hasPassword && '비밀번호', p.data.github && `GitHub @${p.data.github}`].filter(Boolean).join(', ') },
    { headerName: '이메일', minWidth: 150, flex: 0.7, field: 'email' },
    { headerName: '가입', width: 120, valueGetter: (p) => when(p.data?.createdAt), tooltipValueGetter: (p) => p.data && `${JOINED[p.data.via]}으로 가입` },
    { headerName: '마지막 로그인', width: 130, valueGetter: (p) => when(p.data?.lastLoginAt) },
    { headerName: '조치', width: 270, pinned: 'right', sortable: false, filter: false,
      cellRenderer: (p: ICellRendererParams<AdminAccount>) => {
        const a = p.data;
        if (!a) return null;
        if (a.root) return <span className="muted">처음 관리자</span>;
        if (a.login === me) return <span className="muted">본인(마이페이지에서)</span>;
        // 임시 비밀번호는 비밀번호로 로그인하는 계정에만(GitHub 으로만 들어오는 사람에겐 뜻이 없다)
        const acts = ((a.status === 'pending' ? ['approve', 'reject'] : a.status === 'active' ? ['suspend', 'reset-password'] : a.status === 'suspended' ? ['activate'] : ['approve']) as AccountAction[])
          .filter((x) => x !== 'reset-password' || a.hasPassword);
        return (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: '100%' }}>
            {acts.map((x) => <button key={x} className={'btn sm ' + (x === 'approve' || x === 'activate' ? 'primary' : 'ghost')} onClick={() => act(a, x)}>{ACT[x]}</button>)}
            <button className="btn ghost sm" style={{ color: 'var(--red)' }} onClick={() => act(a, 'delete')}>{ACT.delete}</button>
          </div>
        );
      } },
  ], [me, list]);   // eslint-disable-line

  return (
    <div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        회원가입(아이디·비밀번호)이나 처음 보는 GitHub 계정의 로그인은 승인 대기로 들어옵니다. 승인하면 보기 권한으로 시작하고, 역할은 권한 탭에서 바꿉니다.
      </div>
      {err && <div className="panel err" style={{ marginBottom: 12 }}>{err}</div>}
      {note && <div className="panel ok-note" style={{ marginBottom: 12 }}>{note}</div>}
      {temp && (
        <div className="panel amber" style={{ marginBottom: 12 }}>
          <b>{temp.login}</b> 의 임시 비밀번호: <code className="mono" style={{ userSelect: 'all' }}>{temp.pw}</code>
          <div className="muted" style={{ fontSize: 12 }}>지금 한 번만 보입니다. 본인에게 전하고, 로그인 뒤 마이페이지에서 바꾸게 하세요.</div>
        </div>
      )}
      {pending.length > 0 && (
        <Section icon={UserPlus} title={`승인 대기 ${pending.length}명`} tone="warn">
          {pending.map((a) => (
            <div key={a.login} className="members-pending">
              <span><b>{a.name}</b> <span className="muted mono">@{a.login}</span> {a.email && <span className="muted">{a.email}</span>} <span className="muted">· {JOINED[a.via]} · {when(a.createdAt)}</span></span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn primary sm" onClick={() => act(a, 'approve')}>승인</button>
                <button className="btn ghost sm" onClick={() => act(a, 'reject')}>거절</button>
              </span>
            </div>
          ))}
        </Section>
      )}
      <div style={{ display: 'flex', gap: 8, margin: '12px 0 8px' }}>
        <input placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
        <span style={{ marginLeft: 'auto' }}><RefreshBar poll={poll} /></span>
      </div>
      <div style={{ height: Math.min(80 + (list?.length ?? 5) * 42, 720) }}>
        <AgGridReact<AdminAccount> theme={gridTheme} localeText={localeKo} rowData={list ?? []} columnDefs={cols} defaultColDef={defaultColDef}
          rowHeight={42} quickFilterText={q} getRowId={(p) => p.data.login} loading={!list && !err} suppressCellFocus />
      </div>
    </div>
  );
}
