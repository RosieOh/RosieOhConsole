import { Package as Package2 } from 'lucide-react';
import { Wrench as WrenchIcon, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { RefreshBar, usePoll } from '../poll';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, ToolRepo } from '../api';
import { copyText } from '../copy';

function Cmds({ title, lines }: { title: string; lines?: string[] }) {
  const [done, setDone] = useState(false);
  if (!lines?.length) return null;
  const text = lines.join('\n');
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="muted" style={{ fontSize: 12 }}>{title}</span>
        <button className="btn ghost" style={{ padding: '2px 10px' }} onClick={() => copyText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
          {done ? '복사됨' : '복사'}
        </button>
      </div>
      <div className="out" style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  );
}

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '');

function Repo({ r }: { r: ToolRepo }) {
  const [tab, setTab] = useState<'install' | 'changes' | 'readme'>('install');
  const [md, setMd] = useState<string | null>(null);
  useEffect(() => {
    if (tab === 'readme' && md === null) api.toolReadme(r.name).then((x) => setMd(x.markdown || '(README 없음)')).catch(() => setMd('(README 를 읽지 못했습니다)'));
  }, [tab]);
  const m = r.meta;
  return (
    <article className="scard" style={{ marginBottom: 12, cursor: 'default' }}>
      <header className="scard-head" style={{ alignItems: 'flex-start' }}>
        <span className="scard-icon"><Package2 size={18} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <a href={r.url} target="_blank" rel="noreferrer" className="scard-title">{r.name}</a>
            {m?.required && <span className="tag" style={{ color: 'var(--amber)', borderColor: 'var(--amber)' }}>필수 설치</span>}
            {m && <span className="tag">{m.kind}</span>}
          </div>
          <div className="scard-sub" style={{ fontSize: 13, marginTop: 2 }}>{r.description}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="mono" style={{ fontWeight: 700, fontSize: 14 }}>{r.version ?? (r.last ? r.last.sha : '')}</div>
          <div className="muted" style={{ fontSize: 12 }}>{r.version ? '최신 버전' : `${r.branch} 최신 커밋`}, {day(r.last?.date)}</div>
        </div>
      </header>
      <div className="scard-body">
      <div className="seg">
        <button className={'segbtn' + (tab === 'install' ? ' on' : '')} onClick={() => setTab('install')}>설치</button>
        <button className={'segbtn' + (tab === 'changes' ? ' on' : '')} onClick={() => setTab('changes')}>변경 내역</button>
        <button className={'segbtn' + (tab === 'readme' ? ' on' : '')} onClick={() => setTab('readme')}>README</button>
      </div>
      {tab === 'install' && (
        <div>
          {m?.note && <div style={{ marginTop: 10 }}>{m.note}</div>}
          {!m && <div className="muted" style={{ marginTop: 10 }}>설치 안내가 아직 없습니다. README 를 보세요.</div>}
          {!!m?.links?.length && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {m.links.map((l) => (
                <a key={l.url} className="btn ghost" href={l.url} target="_blank" rel="noreferrer"
                   style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <ExternalLink size={14} />{l.label}
                </a>
              ))}
            </div>
          )}
          <Cmds title="설치 (한 번)" lines={m?.install} />
          <Cmds title="업데이트" lines={m?.update} />
          <Cmds title="확인" lines={m?.check ? [m.check] : undefined} />
        </div>
      )}
      {tab === 'changes' && (
        <table className="tbl" style={{ marginTop: 10 }}>
          <tbody>
            {r.changes.map((c) => (
              <tr key={c.sha}>
                <td className="mono" style={{ width: 70 }}><a href={c.url} target="_blank" rel="noreferrer">{c.sha}</a></td>
                <td className="muted" style={{ width: 100 }}>{day(c.date)}</td>
                <td>{c.message}</td>
                <td className="muted" style={{ width: 90 }}>{c.author}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === 'readme' && (
        <div className="markdown" style={{ marginTop: 10 }}>
          {md === null ? <span className="muted">loading…</span> : <Markdown remarkPlugins={[remarkGfm]}>{md}</Markdown>}
        </div>
      )}
      </div>
    </article>
  );
}

export function MxTools() {
  const [repos, setRepos] = useState<ToolRepo[] | null>(null);
  const [err, setErr] = useState('');
  const load = (refresh = false) => { setErr(''); return api.tools(refresh).then((r) => setRepos(r.repos)).catch((e) => { setErr(String(e?.message || e)); throw e; }); };
  const poll = usePoll(load, 300000);
  const required = repos?.filter((r) => r.meta?.required) ?? [];
  return (
    <div>
      <div className="topbar">
        <div>
          <h1><WrenchIcon size={22} />MX 도구</h1>
          <div className="sub">팀 도구 버전, 설치 방법, 변경 내역</div>
        </div>
        <RefreshBar poll={poll} />
      </div>
      {err && <div className="panel err">{err}</div>}
      {required.length > 0 && (
        <div className="panel code" style={{ marginBottom: 14 }}>
          필수 설치: {required.map((r) => r.name).join(', ')}
        </div>
      )}
      {repos === null && !err && <div className="panel"><span className="muted">loading…</span></div>}
      {repos?.map((r) => <Repo key={r.name} r={r} />)}
    </div>
  );
}
