import { useState } from 'react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { AlertTriangle, FlaskConical, Plug, Rocket, ToggleRight } from 'lucide-react';
import { api, FlagEnv, FlagRow, FlagsOverview, FlagView } from '../api';
import { useCatalog } from '../catalog';
import { when } from '../grid';
import { RefreshBar, usePoll } from '../poll';
import { User } from '../users';
import { Logo } from './Logo';
import { MiniGrid } from './MiniGrid';
import { Modal } from './Modal';

const ENV_LABEL: Record<FlagEnv, string> = { testbed: '테스트배드', prod: '운영' };
type Pending = { comp: string; name: string; env: FlagEnv; row: FlagRow; next: boolean };

function Toggle({ on, disabled, onClick, title }: { on: boolean; disabled?: boolean; onClick?: () => void; title?: string }) {
  return (
    <button className={'tgl' + (on ? ' on' : '')} role="switch" aria-checked={on} disabled={disabled} onClick={onClick} title={title}>
      <span className="tgl-track"><span className="tgl-knob" /></span>
      <span className="tgl-label">{on ? '켜짐' : '꺼짐'}</span>
    </button>
  );
}

function EnvCell({ v, env, connected, deployer, onToggle }: { v: FlagView | null | undefined; env: FlagEnv; connected: boolean; deployer: boolean; onToggle: () => void }) {
  if (!connected) return <span className="muted flag-na"><Plug size={13} />연결 안 됨</span>;
  if (v === null || v === undefined) return <span className="muted flag-na">아직 배포 안 됨</span>;
  return (
    <div className="flag-cell">
      <Toggle on={v.enabled} disabled={!deployer} onClick={onToggle} title={deployer ? `${ENV_LABEL[env]}에서 ${v.enabled ? '끄기' : '켜기'}` : '관리자, 배포 담당만 바꿀 수 있습니다'} />
      {v.overridden && v.updatedBy
        ? <span className="flag-who"><User login={v.updatedBy} size={16} />{when(v.updatedAt)}</span>
        : <span className="flag-who muted">기본값</span>}
    </div>
  );
}

export function Flags({ deployer }: { deployer: boolean }) {
  const { comp } = useCatalog();
  const [d, setD] = useState<FlagsOverview | null>(null);
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = async (force: boolean) => {
    try { setD(await api.flags(force)); setErr(''); } catch (e: any) { setErr(String(e?.message || e)); throw e; }
  };
  const poll = usePoll(load, 15000);

  async function apply() {
    if (!pending) return;
    setBusy(true); setErr('');
    try {
      await api.setFlag({ comp: pending.comp, env: pending.env, key: pending.row.key, enabled: pending.next, confirm: pending.env === 'prod' ? confirm : undefined });
      setMsg(`${pending.name} ${ENV_LABEL[pending.env]}, ${pending.row.key} 를 ${pending.next ? '켰' : '껐'}습니다`);
      setPending(null); setConfirm('');
      await load(true);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  const total = d?.services.reduce((n, s) => n + s.rows.length, 0) ?? 0;
  return (
    <div>
      <div className="topbar">
        <div>
          <h1><ToggleRight size={22} />기능 스위치</h1>
          <div className="sub">{d ? `서비스 ${d.services.length}개, 스위치 ${total}개` : ' '}</div>
        </div>
        <RefreshBar poll={poll} />
      </div>
      {msg && <div className="panel ok-note" style={{ marginBottom: 12 }}>{msg}</div>}
      {err && !pending && <div className="panel err" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="flag-grid">
        {d?.services.map((s) => {
          const c = comp(s.comp);
          const name = c?.name ?? s.comp;
          const envOk = (e: FlagEnv) => !!s.envs.find((x) => x.env === e && x.ok);
          const cols: ColDef<FlagRow>[] = [
            { headerName: '스위치', flex: 1, minWidth: 220, field: 'key', cellRenderer: (p: ICellRendererParams<FlagRow>) => (
              <div className="flag-name"><b className="mono">{p.data!.key}</b><small>{p.data!.description}</small></div>) },
            ...(['testbed', 'prod'] as FlagEnv[]).map((e): ColDef<FlagRow> => ({
              headerName: ENV_LABEL[e], width: 270, sortable: false,
              cellRenderer: (p: ICellRendererParams<FlagRow>) => (
                <EnvCell v={p.data!.envs[e]} env={e} connected={envOk(e)} deployer={deployer}
                  onToggle={() => { setConfirm(''); setErr(''); setPending({ comp: s.comp, name, env: e, row: p.data!, next: !p.data!.envs[e]!.enabled }); }} />),
            })),
          ];
          return (
            <article key={s.comp} className="scard static">
              <header className="scard-head">
                <Logo file={c?.logo ?? null} name={name} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="scard-title">{name}</div>
                  <div className="scard-sub">스위치 {s.rows.length}개</div>
                </div>
                <div className="flag-envs">
                  {s.envs.map((e) => (
                    <span key={e.env} className={'flag-env ' + (e.ok ? 'ok' : e.configured ? 'bad' : 'off')} title={e.error || (e.configured ? '' : '콘솔에 토큰이 없어 연결하지 않음')}>
                      {e.env === 'prod' ? <Rocket size={13} /> : <FlaskConical size={13} />}{ENV_LABEL[e.env]} {e.ok ? '연결됨' : e.configured ? '응답 없음' : '연결 안 됨'}
                    </span>
                  ))}
                </div>
              </header>
              <div className="scard-body">
                {s.envs.filter((e) => e.configured && !e.ok).map((e) => (
                  <div key={e.env} className="scard-alert bad" style={{ marginTop: 0, marginBottom: 10 }}><div><AlertTriangle size={14} />{ENV_LABEL[e.env]}: {e.error}</div></div>
                ))}
                {s.envs.some((e) => e.ok)
                  ? <MiniGrid rows={s.rows} cols={cols} rowId={(r) => r.key} rowHeight={56} />
                  : <div className="flag-none"><Plug size={14} />연결된 환경이 없어 스위치를 읽지 못했습니다</div>}
              </div>
            </article>
          );
        })}
      </div>

      {pending && (
        <Modal title={`${pending.next ? '켜기' : '끄기'}, ${pending.row.key}`} icon={<ToggleRight size={18} />} onClose={() => setPending(null)} width={480}
          footer={<>
            <button className="btn ghost" onClick={() => setPending(null)}>취소</button>
            <button className={'btn ' + (pending.env === 'prod' ? 'danger' : 'primary')} disabled={busy || (pending.env === 'prod' && confirm !== pending.comp)} onClick={apply}>
              {busy ? '바꾸는 중…' : `${ENV_LABEL[pending.env]}에서 ${pending.next ? '켜기' : '끄기'}`}
            </button>
          </>}>
          <dl className="lv">
            <dt>서비스</dt><dd>{pending.name}</dd>
            <dt>환경</dt><dd>{ENV_LABEL[pending.env]}</dd>
            <dt>스위치</dt><dd><span className="mono">{pending.row.key}</span><div className="muted" style={{ fontWeight: 500, fontSize: 12.5 }}>{pending.row.description}</div></dd>
            <dt>바뀜</dt><dd>{pending.next ? '꺼짐 → 켜짐' : '켜짐 → 꺼짐'}, 재배포 없이 5초 안에 반영</dd>
          </dl>
          {pending.env === 'prod' && <input style={{ width: '100%' }} placeholder={`확인을 위해 ${pending.comp} 입력`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
          {err && <div className="err">{err}</div>}
        </Modal>
      )}
    </div>
  );
}
