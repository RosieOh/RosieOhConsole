import { ListTree, PencilLine } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, CatalogComponent, CatalogNode, CatalogOp, KIND_LABEL, walkNodes } from '../api';
import { useCatalog } from '../catalog';
import { Logo } from './Logo';
import { AddComponent } from './AddComponent';

// 설정 › 서비스 카탈로그 — 끌어다 놓기로 소속·순서, 눌러서 이름·로고. 기술 연결(주소·배포)은 코드(api/src/catalog/defaults.ts)가 정한다
type Sel = { t: 'node'; id: string } | { t: 'comp'; key: string } | null;
type Drag = { t: 'node'; id: string } | { t: 'comp'; key: string } | null;

function readFile(f: File): Promise<string> {
  return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(f); });
}

function LogoPicker({ repo, current, onPick }: { repo?: string; current: string | null; onPick: (file: string | null) => Promise<void> }) {
  const [cands, setCands] = useState<{ file: string; path: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const find = async (refresh = false) => {
    if (!repo) return;
    setBusy(true); setErr('');
    try { setCands((await api.logoCandidates(repo, refresh)).candidates); } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  };
  const upload = async (f?: File) => {
    if (!f) return;
    setErr('');
    try { const { file } = await api.uploadLogo(await readFile(f)); await onPick(file); } catch (e: any) { setErr(String(e?.message || e)); }
  };
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {repo && <button className="btn ghost" disabled={busy} onClick={() => find(!!cands)}>{busy ? '찾는 중…' : cands ? '후보 다시 찾기' : `저장소(${repo})에서 후보 찾기`}</button>}
        <label className="btn ghost" style={{ display: 'inline-block' }}>
          파일 올리기<input type="file" accept="image/png,image/svg+xml,image/webp" style={{ display: 'none' }} onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        {current && <button className="btn ghost" onClick={() => onPick(null)}>로고 지우기</button>}
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>PNG, SVG, WEBP, 1MB 이하. 로고가 없으면 프로젝트(또는 하위) 로고를 물려받습니다.</div>
      {err && <div className="err">{err}</div>}
      {cands && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {cands.length === 0 && <span className="muted">후보 없음. 파일을 올리세요.</span>}
          {cands.map((c) => (
            <button key={c.file} title={c.path} onClick={() => onPick(c.file)} className="logo-cand" style={{ borderColor: current === c.file ? 'var(--green)' : undefined }}>
              <Logo file={c.file} name="" size={44} />
              <span className="muted" style={{ fontSize: 10, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.path.split('/').slice(-2).join('/')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CatalogEditor() {
  const { catalog, reload } = useCatalog();
  const [sel, setSel] = useState<Sel>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<string>('');
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');

  const nodes: CatalogNode[] = [];
  if (catalog) walkNodes(catalog.roots, (n) => nodes.push(n));
  const node = sel?.t === 'node' ? nodes.find((n) => n.id === sel.id) : undefined;
  const comp = sel?.t === 'comp' ? catalog?.components.find((c) => c.key === sel.key) : undefined;
  useEffect(() => { setName(node?.name ?? comp?.name ?? ''); setNote(comp?.note ?? ''); }, [sel, catalog]);   // eslint-disable-line

  async function run(ops: CatalogOp[]) {
    if (!catalog) return;
    setErr('');
    try { const r = await api.catalogOps(catalog.rev, ops); await reload(); return r; }
    catch (e: any) { setErr(String(e?.message || e)); if (e?.status === 409) await reload(); }
  }

  // 끌어다 놓기 — 대상 앞에 놓는다(같은 부모로 옮기고 순서를 다시 매긴다)
  function dropOnNode(target: CatalogNode, into: boolean) {
    if (!drag || !catalog) return;
    if (drag.t === 'comp') {
      if (target.type !== 'project') return setErr('구성요소는 프로젝트 안에만 둘 수 있습니다');
      const list = target.components.filter((c) => c.key !== drag.key);
      return run([{ op: 'comp.update', key: drag.key, parent: target.id, order: (list.length + 1) * 10 }]);
    }
    if (drag.id === target.id) return;
    if (into) {
      if (target.type !== 'group') return setErr('그룹 안에만 넣을 수 있습니다');
      return run([{ op: 'node.update', id: drag.id, parent: target.id, order: (target.children.length + 1) * 10 }]);
    }
    const parentId = target.parent;
    const siblings = (parentId ? nodes.find((n) => n.id === parentId)!.children : catalog.roots).filter((n) => n.id !== drag.id);
    const at = siblings.findIndex((n) => n.id === target.id);
    siblings.splice(at, 0, nodes.find((n) => n.id === drag.id)!);
    return run(siblings.map((n, i) => ({ op: 'node.update' as const, id: n.id, order: (i + 1) * 10, ...(n.id === drag.id ? { parent: parentId } : {}) })));
  }
  function dropOnComp(target: CatalogComponent) {
    if (!drag || drag.t !== 'comp' || drag.key === target.key || !catalog) return;
    const proj = nodes.find((n) => n.id === target.project)!;
    const list = proj.components.filter((c) => c.key !== drag.key);
    list.splice(list.findIndex((c) => c.key === target.key), 0, catalog.components.find((c) => c.key === drag.key)!);
    return run(list.map((c, i) => ({ op: 'comp.update' as const, key: c.key, order: (i + 1) * 10, ...(c.key === drag.key ? { parent: proj.id } : {}) })));
  }

  const dnd = (id: string, onDrop: () => void) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(id); },
    onDragLeave: () => setOver((o) => (o === id ? '' : o)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(''); void onDrop(); setDrag(null); },
  });

  // 컴포넌트가 아니라 함수로 그린다 — 끄는 동안 다시 그려도 끌던 요소가 사라지지 않게
  const tree = (list: CatalogNode[], depth: number): React.ReactNode => {
    return (
      <>
        {list.map((n) => (
          <div key={n.id}>
            <div className={'ed-row' + (sel?.t === 'node' && sel.id === n.id ? ' on' : '') + (over === 'n:' + n.id ? ' over' : '')} style={{ paddingLeft: 8 + depth * 18 }}
              draggable={n.id !== '_unassigned'} onDragStart={() => setDrag({ t: 'node', id: n.id })} onClick={() => setSel({ t: 'node', id: n.id })}
              {...dnd('n:' + n.id, () => dropOnNode(n, n.type === 'group' && drag?.t === 'node' && !(drag.id === n.id)))}>
              <span className="muted" style={{ cursor: 'grab' }}>⠿</span>
              <Logo file={n.logo} name={n.name} size={18} />
              <span style={{ fontWeight: n.type === 'group' ? 600 : 500 }}>{n.name}</span>
              <span className="tag">{n.type === 'group' ? '그룹' : '프로젝트'}</span>
            </div>
            {n.components.map((c) => (
              <div key={c.key} className={'ed-row comp' + (sel?.t === 'comp' && sel.key === c.key ? ' on' : '') + (over === 'c:' + c.key ? ' over' : '')} style={{ paddingLeft: 8 + (depth + 1) * 18 }}
                draggable onDragStart={() => setDrag({ t: 'comp', key: c.key })} onClick={() => setSel({ t: 'comp', key: c.key })} {...dnd('c:' + c.key, () => dropOnComp(c))}>
                <span className="muted" style={{ cursor: 'grab' }}>⠿</span>
                <Logo file={c.logo} name={c.name} size={16} />
                <span>{c.name}</span>
                <span className="muted mono" style={{ fontSize: 11 }}>{c.repo}</span>
                <span className="tag">{KIND_LABEL[c.kind]}</span>
              </div>
            ))}
            {tree(n.children, depth + 1)}
          </div>
        ))}
      </>
    );
  };

  if (!catalog) return <div className="panel muted">loading…</div>;
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className="scard" style={{ flex: '1 1 460px', cursor: 'default' }}>
        <header className="scard-head"><span className="scard-icon"><ListTree size={17} /></span><div style={{ flex: 1 }}><div className="scard-title">서비스 트리</div><div className="scard-sub">끌어서 순서와 소속을 바꿉니다</div></div></header>
        <div style={{ padding: 8 }}>
        <div style={{ display: 'flex', gap: 8, padding: '4px 4px 10px', flexWrap: 'wrap' }}>
          <button className="btn ghost" onClick={() => run([{ op: 'node.add', type: 'group', name: '새 그룹', parent: node?.type === 'group' ? node.id : null }])}>+ 그룹</button>
          <button className="btn ghost" onClick={() => run([{ op: 'node.add', type: 'project', name: '새 프로젝트', parent: node?.type === 'group' ? node.id : null }])}>+ 프로젝트</button>
        </div>
        <div {...dnd('root', () => (drag?.t === 'node' ? run([{ op: 'node.update', id: drag.id, parent: null, order: 9999 }]) : undefined))}
          className={over === 'root' ? 'ed-root over' : 'ed-root'}>
          {tree(catalog.roots, 0)}
          <div className="muted" style={{ fontSize: 11, padding: 8 }}>여기에 놓으면 맨 위 단계로</div>
        </div>
        {err && <div className="err" style={{ padding: 6 }}>{err}</div>}
        </div>
      </div>

      <div className="scard" style={{ flex: '1 1 340px', position: 'sticky', top: 12, cursor: 'default' }}>
        <header className="scard-head"><span className="scard-icon"><PencilLine size={17} /></span><div className="scard-title">선택한 항목</div></header>
        <div className="scard-body">
        {!node && !comp && <div className="muted">왼쪽에서 항목을 고르세요.</div>}
        {(node || comp) && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Logo file={(node ?? comp)!.logo} name={name || '?'} size={40} />
              <div>
                <div style={{ fontWeight: 600 }}>{(node ?? comp)!.name}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>{node ? (node.type === 'group' ? '그룹' : '프로젝트') : `${KIND_LABEL[comp!.kind]}, ${comp!.repo || '저장소 없음'}`}{!(node ?? comp)!.builtin && ', 직접 만든 항목'}</div>
              </div>
            </div>
            <div className="fld"><span className="muted" style={{ fontSize: 11.5, display: 'block', marginBottom: 5 }}>이름</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
                <button className="btn primary" disabled={!name.trim() || name === (node ?? comp)!.name}
                  onClick={() => run([node ? { op: 'node.update', id: node.id, name } : { op: 'comp.update', key: comp!.key, name }])}>저장</button>
              </div>
            </div>
            {comp && (
              <div className="fld"><span className="muted" style={{ fontSize: 11.5, display: 'block', marginBottom: 5 }}>메모</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
                  <button className="btn ghost" disabled={note === (comp.note ?? '')} onClick={() => run([{ op: 'comp.update', key: comp.key, note }])}>저장</button>
                </div>
              </div>
            )}
            <div className="fld"><span className="muted" style={{ fontSize: 11.5, display: 'block', marginBottom: 5 }}>로고</span>
              <LogoPicker key={sel?.t === 'node' ? sel.id : sel?.key} repo={comp?.repo || node?.components.find((c) => c.repo && c.kind !== 'backend')?.repo}
                current={(node ?? comp)!.ownLogo}
                onPick={async (file) => { await run([node ? { op: 'node.update', id: node.id, logo: file } : { op: 'comp.update', key: comp!.key, logo: file }]); }} />
            </div>
            {node?.type === 'project' && (
              <AddComponent project={node} all={catalog.components} nodes={nodes}
                onAdd={async (c) => !!(await run([{ op: 'comp.add', name: c.name, kind: c.kind, repo: c.repo, parent: node.id }]))} />
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              {(node ?? comp)!.builtin && <button className="btn ghost" onClick={() => run([node ? { op: 'reset', node: node.id } : { op: 'reset', key: comp!.key }])}>기본값으로</button>}
              <button className="btn ghost" style={{ color: 'var(--red)' }} onClick={async () => {
                const r = await run([node ? { op: 'node.delete', id: node.id } : { op: 'comp.delete', key: comp!.key }]);
                if (r) setSel(null);
              }}>{(node ?? comp)!.builtin ? '숨기기' : '삭제'}</button>
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
