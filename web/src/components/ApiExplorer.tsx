import { useEffect, useMemo, useState } from 'react';
import { callTestbed } from '../api';

const TOKEN_KEY = 'dash_test_token';

interface Op { method: string; path: string; summary: string; tag: string; parameters: any[]; requestBody: any; }

function resolveRef(spec: any, ref: string) {
  const parts = ref.replace('#/', '').split('/');
  let o: any = spec; for (const p of parts) o = o?.[p]; return o;
}
function skeleton(spec: any, schema: any, depth = 0): any {
  if (!schema || depth > 4) return null;
  if (schema.$ref) return skeleton(spec, resolveRef(spec, schema.$ref), depth);
  if (schema.example !== undefined) return schema.example;
  if (schema.type === 'object' || schema.properties) {
    const o: any = {}; for (const [k, v] of Object.entries(schema.properties || {})) o[k] = skeleton(spec, v, depth + 1); return o;
  }
  if (schema.type === 'array') return [skeleton(spec, schema.items, depth + 1)];
  if (schema.type === 'string') return schema.enum ? schema.enum[0] : '';
  if (schema.type === 'integer' || schema.type === 'number') return 0;
  if (schema.type === 'boolean') return false;
  return null;
}

function parseSpec(spec: any): Record<string, Op[]> {
  const groups: Record<string, Op[]> = {};
  const paths = spec?.paths || {};
  for (const [path, item] of Object.entries<any>(paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = item[method];
      if (!op) continue;
      const tag = (op.tags && op.tags[0]) || 'default';
      (groups[tag] ||= []).push({
        method: method.toUpperCase(), path, summary: op.summary || op.operationId || '',
        tag, parameters: [...(item.parameters || []), ...(op.parameters || [])], requestBody: op.requestBody,
      });
    }
  }
  return groups;
}

const METHOD_COLOR: Record<string, string> = { GET: '#3ecf8e', POST: '#5b9dff', PUT: '#f5a623', PATCH: '#c084fc', DELETE: '#f0526d' };

export function ApiExplorer({ specUrl, prefix }: { specUrl: string; prefix: string }) {
  const [spec, setSpec] = useState<any>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    setSpec(null); setErr('');
    fetch(specUrl, { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(setSpec).catch((e) => setErr(String(e?.message || e)));
  }, [specUrl]);

  const groups = useMemo(() => (spec ? parseSpec(spec) : {}), [spec]);
  if (err) return <div className="panel err">API 문서 로드 실패: {err}</div>;
  if (!spec) return <div className="panel"><span className="muted">loading spec…</span></div>;

  const f = filter.trim().toLowerCase();
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <input placeholder="경로/요약 필터…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {Object.entries(groups).sort().map(([tag, ops]) => {
        const visible = ops.filter((o) => !f || o.path.toLowerCase().includes(f) || o.summary.toLowerCase().includes(f));
        if (!visible.length) return null;
        return (
          <div className="section" key={tag}>
            <h2>{tag}</h2>
            <div className="panel" style={{ padding: 0 }}>
              {visible.map((op, i) => <Endpoint key={op.method + op.path + i} op={op} spec={spec} prefix={prefix} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Endpoint({ op, spec, prefix }: { op: Op; spec: any; prefix: string }) {
  const [open, setOpen] = useState(false);
  const pathParams = op.parameters.filter((p) => p.in === 'path');
  const queryParams = op.parameters.filter((p) => p.in === 'query');
  const [pvals, setPvals] = useState<Record<string, string>>({});
  const [qvals, setQvals] = useState<Record<string, string>>({});
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || '');
  const [body, setBody] = useState('');
  const [resp, setResp] = useState<{ status: number; ms: number; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function initBody() {
    if (body || !op.requestBody) return;
    const schema = op.requestBody?.content?.['application/json']?.schema;
    const sk = schema ? skeleton(spec, schema) : null;
    if (sk && typeof sk === 'object') setBody(JSON.stringify(sk, null, 2));
  }

  async function send() {
    setBusy(true); setResp(null);
    let path = op.path;
    for (const p of pathParams) path = path.replace(`{${p.name}}`, encodeURIComponent(pvals[p.name] || ''));
    const qs = queryParams.filter((p) => qvals[p.name]).map((p) => `${p.name}=${encodeURIComponent(qvals[p.name])}`).join('&');
    const url = prefix + path + (qs ? '?' + qs : '');
    try {
      const r = await callTestbed(op.method, url, token || undefined, ['GET', 'HEAD'].includes(op.method) ? undefined : body);
      setResp(r);
    } catch (e: any) { setResp({ status: 0, ms: 0, body: String(e?.message || e) }); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer' }}
           onClick={() => { setOpen(!open); if (!open) initBody(); }}>
        <span className="mono" style={{ color: METHOD_COLOR[op.method], fontWeight: 700, fontSize: 11, width: 52, flexShrink: 0 }}>{op.method}</span>
        <span className="mono" style={{ fontSize: 12.5 }}>{op.path}</span>
        <span className="muted" style={{ fontSize: 12, marginLeft: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{op.summary}</span>
      </div>
      {open && (
        <div style={{ padding: '4px 14px 16px', background: 'var(--bg-2)' }}>
          {pathParams.map((p) => (
            <label className="fld" key={p.name}><span>path, {p.name}{p.required ? ' *' : ''}</span>
              <input className="mono" value={pvals[p.name] || ''} onChange={(e) => setPvals({ ...pvals, [p.name]: e.target.value })} placeholder={p.schema?.type} /></label>
          ))}
          {queryParams.map((p) => (
            <label className="fld" key={p.name}><span>query, {p.name}{p.required ? ' *' : ''}</span>
              <input className="mono" value={qvals[p.name] || ''} onChange={(e) => setQvals({ ...qvals, [p.name]: e.target.value })} placeholder={p.schema?.type} /></label>
          ))}
          <label className="fld"><span>Authorization: Bearer</span>
            <input className="mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="JWT (Tools에서 발급)" /></label>
          {op.requestBody && (
            <label className="fld"><span>body (JSON)</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} /></label>
          )}
          <button className="btn primary" onClick={send} disabled={busy}>{busy ? '호출 중…' : '호출'}</button>
          {resp && (
            <div style={{ marginTop: 12 }}>
              <div className="code" style={{ marginBottom: 6 }}>status <span className={resp.status && resp.status < 400 ? 'v green' : 'v red'}>{resp.status || 'ERR'}</span>, {resp.ms} ms</div>
              <div className="out">{prettify(resp.body)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function prettify(s: string) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } }
