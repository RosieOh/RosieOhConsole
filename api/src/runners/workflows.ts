import { parse } from 'yaml';

// 워크플로 파일에서 "이 작업은 어느 러너 라벨에서 도나"를 뽑는다.
// - runs-on: 문자열·목록·${{ inputs.x }}(호출 입력·기본값으로 푼다)
// - uses: <owner>/<repo>/.github/workflows/x.yml@ref → 템플릿 파일의 작업으로 따라간다(with 가 입력)
export interface TemplateRef { owner: string; repo: string; path: string; ref: string }
export interface WfJob { id: string; name: string; runsOn: string[] | null; uses: TemplateRef | null; with: Record<string, string> }
export interface WfFile { name: string; triggers: string[]; jobs: WfJob[]; inputDefaults: Record<string, string> }

const asStr = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function parseUses(s: string): TemplateRef | null {
  const m = /^([^/\s]+)\/([^/\s]+)\/(\.github\/workflows\/[^@\s]+)@(\S+)$/.exec(s.trim());
  return m ? { owner: m[1], repo: m[2], path: m[3], ref: m[4] } : null;
}

export function parseWorkflow(text: string): WfFile {
  let doc: any;
  try { doc = parse(text) ?? {}; } catch { return { name: '', triggers: [], jobs: [], inputDefaults: {} }; }
  // YAML 에서 on 은 키 그대로("on") — 1.1 해석이면 true 가 될 수 있다
  const on = doc.on ?? doc[true as any] ?? {};
  const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on.map(asStr) : Object.keys(on || {});
  const inputDefaults: Record<string, string> = {};
  const call = on?.workflow_call?.inputs || {};
  for (const [k, v] of Object.entries<any>(call)) if (v && v.default !== undefined) inputDefaults[k] = asStr(v.default);
  const jobs: WfJob[] = Object.entries<any>(doc.jobs || {}).map(([id, j]) => {
    const ro = j?.['runs-on'];
    const runsOn = ro === undefined ? null : (Array.isArray(ro) ? ro.map(asStr) : [asStr(ro)]).filter(Boolean);
    const w: Record<string, string> = {};
    for (const [k, v] of Object.entries<any>(j?.with || {})) w[k] = asStr(v);
    return { id, name: asStr(j?.name) || id, runsOn, uses: typeof j?.uses === 'string' ? parseUses(j.uses) : null, with: w };
  });
  return { name: asStr(doc.name), triggers, jobs, inputDefaults };
}

/** ${{ inputs.x }} · ${{ github.event.inputs.x }} 를 값으로. 풀 수 없는 표현식이면 null */
export function resolveLabel(label: string, inputs: Record<string, string>): string | null {
  const m = /^\$\{\{\s*(?:github\.event\.)?inputs\.([\w-]+)\s*\}\}$/.exec(label.trim());
  if (m) return inputs[m[1]] ?? null;
  if (label.includes('${{')) return null;
  return label.trim();
}

/** 러너가 작업을 받을 수 있나 — 요청 라벨을 모두 가진 러너(act_runner 규칙) */
export function runnerMatches(runnerLabels: string[], want: string[]) {
  const have = new Set(runnerLabels.map((l) => l.split(':')[0].toLowerCase()));
  return want.length > 0 && want.every((l) => have.has(l.toLowerCase()));
}
