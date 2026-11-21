import { BookMarked, Code2 } from 'lucide-react';
import { BookOpen as BookOpenIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, DocMeta, TESTBED } from '../api';
import { ApiExplorer } from './ApiExplorer';

// API 문서(OpenAPI try-it-out)가 있는 테스트배드 백엔드. 콘솔 API 의 /mxtest 를 거쳐 테스트배드(TESTBED_URL)로 간다.
// 테스트배드의 경로 접두사를 여기 적는다(예: ['my-api'] → /my-api/v3/api-docs)
const API_SERVICES = ([] as string[]).map((k) => ({ key: k, name: k, spec: `${TESTBED}/${k}/v3/api-docs`, prefix: `/${k}` }));

type Sel = { type: 'api'; key: string } | { type: 'guide'; id: string };

export function Docs({ initial }: { initial?: string }) {
  const [guides, setGuides] = useState<DocMeta[]>([]);
  const [sel, setSel] = useState<Sel>(
    initial && API_SERVICES.some((s) => s.key === initial) ? { type: 'api', key: initial } : { type: 'guide', id: 'getting-started' },
  );

  useEffect(() => { api.docsList().then((r) => setGuides(r.docs)).catch(() => {}); }, []);

  const apiSvc = sel.type === 'api' ? API_SERVICES.find((s) => s.key === sel.key)! : null;

  return (
    <div>
      <div className="topbar"><div><h1><BookOpenIcon size={22} />API 문서</h1><div className="sub">테스트배드 API 문서와 개발 가이드</div></div></div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ width: 230, flexShrink: 0 }}>
          <div className="scard" style={{ marginBottom: 12, cursor: 'default' }}>
            <header className="scard-head"><span className="scard-icon"><Code2 size={16} /></span><div className="scard-title" style={{ fontSize: 14 }}>API 호출</div></header>
            <div style={{ padding: 6 }}>
              {API_SERVICES.map((s) => (
                <div key={s.key} className={'nav-item' + (sel.type === 'api' && sel.key === s.key ? ' active' : '')}
                     onClick={() => setSel({ type: 'api', key: s.key })}>{s.name}</div>
              ))}
            </div>
          </div>
          <div className="scard" style={{ cursor: 'default' }}>
            <header className="scard-head"><span className="scard-icon"><BookMarked size={16} /></span><div className="scard-title" style={{ fontSize: 14 }}>가이드</div></header>
            <div style={{ padding: 6 }}>
              {guides.map((g) => (
                <div key={g.id} className={'nav-item' + (sel.type === 'guide' && sel.id === g.id ? ' active' : '')}
                     onClick={() => setSel({ type: 'guide', id: g.id })}>{g.title}</div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {apiSvc
            ? <ApiExplorer key={apiSvc.key} specUrl={apiSvc.spec} prefix={apiSvc.prefix} />
            : sel.type === 'guide' && <Guide key={sel.id} id={sel.id} />}
        </div>
      </div>
    </div>
  );
}

function Guide({ id }: { id: string }) {
  const [md, setMd] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { setMd(''); setErr(''); api.doc(id).then((r) => setMd(r.markdown)).catch((e) => setErr(String(e?.message || e))); }, [id]);
  if (err) return <div className="panel err">{err}</div>;
  return <div className="scard" style={{ cursor: 'default' }}><div className="scard-body markdown" style={{ padding: '6px 22px 20px' }}>{md ? <Markdown remarkPlugins={[remarkGfm]}>{md}</Markdown> : <div className="skeleton" style={{ height: 300, marginTop: 14 }} />}</div></div>;
}
