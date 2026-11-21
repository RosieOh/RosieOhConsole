import { Check, FlaskConical, Globe, Laptop, RefreshCw, Search, Server, Smartphone, Store, Wrench, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, CatalogComponent, CatalogNode, GhRepo, Kind } from '../api';

// 서비스 카탈로그 › 프로젝트에 구성요소 붙이기(#162). 저장소는 쳐 넣지 않고 조직 저장소 목록에서 고른다
const KINDS: { k: Kind; icon: React.ReactNode; label: string; desc: string }[] = [
  { k: 'device-app', icon: <Smartphone size={18} />, label: '기기앱(APK)', desc: '기기에 직접 까는 안드로이드 앱' },
  { k: 'store-app', icon: <Store size={18} />, label: '스토어 앱', desc: '플레이스토어, 앱스토어로 나가는 앱' },
  { k: 'backend', icon: <Server size={18} />, label: '백엔드', desc: '앱이 부르는 서버' },
  { k: 'web', icon: <Globe size={18} />, label: '웹', desc: '브라우저로 여는 화면' },
  { k: 'desktop-app', icon: <Laptop size={18} />, label: '데스크톱 앱', desc: 'Electron 등 컴퓨터에 까는 앱' },
  { k: 'tool', icon: <Wrench size={18} />, label: '도구·라이브러리', desc: 'CLI, MCP 서버, 확장, 라이브러리' },
  { k: 'notebook', icon: <FlaskConical size={18} />, label: '노트북·분석', desc: '데이터 분석, 모델링 노트북' },
];
const AFTER: Record<Kind, string> = {
  'device-app': '저장소에 APK 배포가 설정돼 있으면 APK 보관함과 배포 흐름에 바로 나옵니다.',
  'store-app': '서비스 트리에 나옵니다. 스토어 배포 버튼은 개발자가 배포 설정을 넣어야 생깁니다.',
  backend: '서비스 트리에 나옵니다. 배포 화면의 주소와 배포 버튼은 개발자가 설정을 넣어야 생깁니다.',
  web: '서비스 트리에 나옵니다. 배포 화면의 주소와 배포 버튼은 개발자가 설정을 넣어야 생깁니다.',
  'desktop-app': '서비스 트리에 나옵니다. 릴리스는 저장소의 GitHub Releases 에서 봅니다.',
  tool: '서비스 트리에 나옵니다. 설치 안내가 필요하면 개발 › 도구 목록(api/src/tools/catalog.ts)에 적습니다.',
  notebook: '서비스 트리에 나옵니다.',
};

function ago(iso: string) {
  const t = Date.parse(iso);
  if (!t) return '';
  const d = Math.floor((Date.now() - t) / 86400000);
  if (d < 1) return '오늘 수정';
  if (d < 30) return `${d}일 전 수정`;
  if (d < 365) return `${Math.floor(d / 30)}달 전 수정`;
  return `${Math.floor(d / 365)}년 전 수정`;
}

export function AddComponent({ project, all, nodes, onAdd }: {
  project: CatalogNode;
  all: CatalogComponent[];
  nodes: CatalogNode[];
  onAdd: (c: { name: string; kind: Kind; repo?: string }) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<Kind>('device-app');
  const [repo, setRepo] = useState<string | null>(null);   // null: 아직 안 고름, '': 저장소 없음
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [q, setQ] = useState('');
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const load = async (refresh = false) => {
    setLoadErr('');
    try { setRepos((await api.catalogRepos(refresh)).repos); } catch (e: any) { setLoadErr(String(e?.message || e)); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { setDone(''); }, [project.id]);

  // 저장소마다 이미 붙어 있는 곳
  const usedBy = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of all) {
      if (!c.repo) continue;
      const p = nodes.find((n) => n.id === c.project)?.name ?? '';
      m.set(c.repo, [...(m.get(c.repo) ?? []), p && !c.name.includes(p) ? `${p} ${c.name}` : c.name]);
    }
    return m;
  }, [all, nodes]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = (repos ?? []).filter((r) => !s || r.name.toLowerCase().includes(s) || r.description.toLowerCase().includes(s));
    return list.slice(0, 80);
  }, [repos, q]);

  const pick = (r: GhRepo | null) => {
    setDone('');
    setRepo(r ? r.name : '');
    if (r && !nameTouched) setName(r.description.trim().slice(0, 60) || r.name);
  };
  const chosen = repo ? repos?.find((r) => r.name === repo) : undefined;
  const missing = !name.trim() ? '이름을 적어 주세요' : repo === null ? '저장소를 고르거나 "저장소 없음"을 누르세요' : '';

  async function submit() {
    if (missing || busy) return;
    setBusy(true);
    const ok = await onAdd({ name: name.trim(), kind, repo: repo || undefined });
    setBusy(false);
    if (ok) {
      setDone(`${name.trim()}을(를) ${project.name}에 붙였습니다.`);
      setRepo(null); setName(''); setNameTouched(false); setQ('');
    }
  }

  return (
    <div className="addc">
      <div className="addc-head">
        <div className="addc-title">구성요소 추가</div>
        <div className="muted addc-sub">{project.name}에 앱이나 서버를 하나 더 붙입니다.</div>
      </div>

      <div className="addc-step">
        <div className="addc-num">1</div>
        <div className="addc-body">
          <div className="addc-label">종류<span className="muted">무엇을 붙이나요?</span></div>
          <div className="addc-kinds" role="radiogroup" aria-label="종류">
            {KINDS.map((x) => (
              <button key={x.k} type="button" role="radio" aria-checked={kind === x.k} className={'addc-kind' + (kind === x.k ? ' on' : '')} onClick={() => { setKind(x.k); setDone(''); }}>
                <span className="addc-kind-ic">{x.icon}</span>
                <span className="addc-kind-t">{x.label}</span>
                <span className="addc-kind-d">{x.desc}</span>
              </button>
            ))}
          </div>
          <div className="addc-hint">{AFTER[kind]}</div>
        </div>
      </div>

      <div className="addc-step">
        <div className="addc-num">2</div>
        <div className="addc-body">
          <div className="addc-label">저장소<span className="muted">코드가 있는 GitHub 저장소</span></div>
          {repo !== null ? (
            <div className="addc-picked">
              <Check size={16} className="addc-ok" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="mono addc-repo-n">{repo || '저장소 없음'}</div>
                <div className="muted addc-repo-d">{repo ? (chosen?.description || '설명 없음') : '나중에 코드를 연결하지 않는 항목'}</div>
              </div>
              <button type="button" className="btn ghost" onClick={() => setRepo(null)}>바꾸기</button>
            </div>
          ) : (
            <>
              <div className="addc-search">
                <Search size={15} />
                <input placeholder="저장소 이름이나 설명으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
                <span className="addc-tools">
                  {q && <button type="button" className="addc-x" aria-label="지우기" onClick={() => setQ('')}><X size={14} /></button>}
                  <button type="button" className="addc-x" title="목록 새로 받기" aria-label="목록 새로 받기" onClick={() => { setRepos(null); void load(true); }}><RefreshCw size={14} /></button>
                </span>
              </div>
              <div className="addc-list">
                {loadErr && <div className="err" style={{ padding: 10 }}>저장소 목록을 못 받았습니다: {loadErr}</div>}
                {!repos && !loadErr && <div className="muted" style={{ padding: 10 }}>저장소 목록을 받는 중…</div>}
                {repos && shown.length === 0 && <div className="muted" style={{ padding: 10 }}>"{q}"에 맞는 저장소가 없습니다.</div>}
                {shown.map((r) => {
                  const used = usedBy.get(r.name);
                  return (
                    <button key={r.name} type="button" className="addc-row" onClick={() => pick(r)}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="mono addc-repo-n">{r.name}{r.archived && <span className="tag" style={{ marginLeft: 6 }}>보관됨</span>}</div>
                        <div className="muted addc-repo-d">{r.description || '설명 없음'}</div>
                      </div>
                      <div className="addc-meta">
                        {used ? <span className="tag" title={used.join(', ')}>연결됨: {used[0]}{used.length > 1 ? ` 외 ${used.length - 1}` : ''}</span> : <span className="muted">{ago(r.updated)}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
              <button type="button" className="addc-none" onClick={() => pick(null)}>저장소 없이 추가</button>
            </>
          )}
        </div>
      </div>

      <div className="addc-step">
        <div className="addc-num">3</div>
        <div className="addc-body">
          <div className="addc-label">이름<span className="muted">콘솔에 보일 이름</span></div>
          <input value={name} maxLength={60} placeholder="예: Illinare 웹" onChange={(e) => { setName(e.target.value); setNameTouched(true); setDone(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
          <div className="addc-hint">저장소를 고르면 저장소 설명으로 채워 둡니다. 나중에 바꿀 수 있습니다.</div>
        </div>
      </div>

      <div className="addc-foot">
        <button type="button" className="btn primary" disabled={!!missing || busy} onClick={submit}>{busy ? '붙이는 중…' : '구성요소 추가'}</button>
        <span className={done ? 'addc-done' : 'muted'}>{done || missing}</span>
      </div>
    </div>
  );
}
