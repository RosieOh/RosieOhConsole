import type { CatalogNode, FlowGraph, LaneKind } from '../api';

// 전체 도식 배치 — 왼쪽부터: 프로젝트(구성요소) → 러너 → 산출물 → 배포 대상 → 사람·사용자 → 데이터·외부(연관 관계)
export const COL = { comp: 0, github: 420, runner: 640, artifact: 930, target: 1220, human: 1510, data: 1800 };
export const COMP_W = 300, COMP_H = 46, FRAME_PAD = 34, ROW_GAP = 8, FRAME_GAP = 26, GROUP_GAP = 34, NODE_W = 230;

export interface Placed { id: string; x: number; y: number; w: number; h: number; kind: string; label: string; sub?: string; parent?: string; data?: any }

const COL_OF: Record<string, keyof typeof COL> = {
  runner: 'runner', github: 'github', registry: 'artifact', release: 'artifact', decide: 'artifact',
  server: 'target', ota: 'target', store: 'target', human: 'human', device: 'human',
  db: 'data', redis: 'data', external: 'data',
};

export function layout(g: FlowGraph, opts: { compact?: boolean } = {}) {
  if (opts.compact) return compactLayout(g);
  const placed: Placed[] = [];
  const compY = new Map<string, number>();
  let y = 0;
  // 1) 왼쪽 — 그룹 제목 + 프로젝트 틀 + 구성요소
  const walk = (list: CatalogNode[], depth: number, path: string[]) => {
    for (const n of list) {
      if (n.type === 'group') {
        placed.push({ id: `grp:${n.id}`, x: depth * 14, y, w: COMP_W, h: 24, kind: 'grouplabel', label: [...path, n.name].join(' › '), data: { logo: n.logo, name: n.name } });
        y += 30;
        walk(n.children, depth + 1, [...path, n.name]);
        y += GROUP_GAP - FRAME_GAP;
        continue;
      }
      const comps = g.components.filter((c) => c.project === n.id);
      const h = FRAME_PAD + Math.max(1, comps.length) * (COMP_H + ROW_GAP) + 6;
      placed.push({ id: `proj:${n.id}`, x: depth * 14, y, w: COMP_W + 24 - depth * 14 + 14, h, kind: 'project', label: n.name, data: { logo: n.logo } });
      comps.forEach((c, i) => {
        const cy = y + FRAME_PAD + i * (COMP_H + ROW_GAP);
        placed.push({ id: `comp:${c.key}`, x: depth * 14 + 12, y: cy, w: COMP_W - depth * 14 + 14, h: COMP_H, kind: 'comp', label: c.name, data: { comp: c } });
        compY.set(`comp:${c.key}`, cy + COMP_H / 2);
      });
      y += h + FRAME_GAP;
    }
  };
  walk(g.projects, 0, []);
  const leftHeight = y;

  // 2) 오른쪽 — 연결된 구성요소의 평균 높이에 맞추고 겹치지 않게 민다
  const users = new Map<string, number[]>();
  const use = (id: string, ys: number | undefined) => { if (ys === undefined) return; users.set(id, [...(users.get(id) || []), ys]); };
  for (const l of g.lanes) for (const step of l.path) for (const id of step.split('|')) use(id, compY.get(`comp:${l.comp}`));
  for (const r of g.relations) if (!r.to.startsWith('comp:')) use(r.to, compY.get(r.from));
  const nodes = [...g.infra, ...g.virtual].filter((n) => users.has(n.id) || n.kind === 'github');
  const byCol = new Map<string, typeof nodes>();
  for (const n of nodes) { const c = COL_OF[n.kind] ?? 'data'; byCol.set(c, [...(byCol.get(c) || []), n]); }
  for (const [col, list] of byCol) {
    const want = list.map((n) => {
      const ys = users.get(n.id) || [0];
      return { n, y: ys.reduce((a, b) => a + b, 0) / ys.length };
    }).sort((a, b) => a.y - b.y);
    const h = 62, gap = 14;
    let floor = -Infinity;
    for (const w of want) {
      const top = Math.max(w.y - h / 2, floor);
      placed.push({ id: w.n.id, x: COL[col as keyof typeof COL], y: top, w: col === 'github' ? 170 : NODE_W, h, kind: w.n.kind, label: w.n.name, sub: w.n.sub, data: { discovered: w.n.discovered } });
      floor = top + h + gap;
    }
  }
  return { placed, height: Math.max(leftHeight, ...placed.map((p) => p.y + p.h)) };
}

/**
 * 구성도용 촘촘한 배치 — 서비스 한 줄마다 그 서비스만 쓰는 것(자기 DB·Redis)을 바로 옆에 두고,
 * 여럿이 같이 쓰는 것(S3·GitHub·GitHub Pages·Vercel)만 오른쪽 열에 모은다. 프로젝트 틀은 그리지 않는다(그룹 제목만)
 */
export const CX = { own: COMP_W + 90, shared: COMP_W + 90 + NODE_W + 150 };
const IH = 62, IGAP = 10, ROW_PAD = 14;
export function compactLayout(g: FlowGraph) {
  const placed: Placed[] = [];
  const compY = new Map<string, number>();
  const nodeById = new Map([...g.infra, ...g.virtual].map((n) => [n.id, n]));
  const usersOf = new Map<string, Set<string>>();
  for (const r of g.relations) if (!r.to.startsWith('comp:') && nodeById.has(r.to)) usersOf.set(r.to, new Set([...(usersOf.get(r.to) || []), r.from]));
  // 배포 대상(v:host-*)은 하나만 써도 오른쪽 열 — 어디에 올라가 있는지 한곳에서 보이게
  const shared = (id: string) => (usersOf.get(id)?.size ?? 0) > 1 || id.startsWith('v:host-');
  const ownOf = new Map<string, string[]>();
  for (const [id, us] of usersOf) if (!shared(id)) { const c = [...us][0]; ownOf.set(c, [...(ownOf.get(c) || []), id]); }

  const comps = new Map<string, typeof g.components>();
  for (const c of g.components) comps.set(c.project, [...(comps.get(c.project) || []), c]);
  let y = 0;
  const walk = (list: CatalogNode[], depth: number, path: string[]) => {
    for (const n of list) {
      if (n.type === 'group') {
        placed.push({ id: `grp:${n.id}`, x: 0, y, w: COMP_W, h: 24, kind: 'grouplabel', label: [...path, n.name].join(' › '), data: { logo: n.logo, name: n.name } });
        y += 30;
        walk(n.children, depth + 1, [...path, n.name]);
        y += 12;
        continue;
      }
      for (const c of comps.get(n.id) ?? []) {
        const id = `comp:${c.key}`;
        const own = ownOf.get(id) ?? [];
        const rowH = Math.max(COMP_H, own.length * (IH + IGAP) - IGAP);
        const cy = y + (rowH - COMP_H) / 2;
        placed.push({ id, x: 12, y: cy, w: COMP_W, h: COMP_H, kind: 'comp', label: c.name, data: { comp: c } });
        compY.set(id, cy + COMP_H / 2);
        own.forEach((t, i) => {
          const node = nodeById.get(t)!;
          placed.push({ id: t, x: CX.own, y: y + i * (IH + IGAP), w: NODE_W, h: IH, kind: node.kind, label: node.name, sub: node.sub, data: { discovered: node.discovered } });
        });
        y += rowH + ROW_PAD;
      }
    }
  };
  walk(g.projects, 0, []);

  // 같이 쓰는 것 — 쓰는 서비스들 높이의 가운데에, 겹치지 않게 민다
  const want = [...usersOf.keys()].filter(shared).map((id) => {
    const ys = [...usersOf.get(id)!].map((c) => compY.get(c)).filter((v): v is number => v !== undefined);
    return { id, y: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0 };
  }).sort((a, b) => a.y - b.y);
  let floor = -Infinity;
  for (const w of want) {
    const node = nodeById.get(w.id)!;
    const top = Math.max(w.y - IH / 2, floor);
    placed.push({ id: w.id, x: CX.shared, y: top, w: NODE_W, h: IH, kind: node.kind, label: node.name, sub: node.sub, data: { discovered: node.discovered } });
    floor = top + IH + 14;
  }
  return { placed, height: Math.max(y, ...placed.map((p) => p.y + p.h)) };
}

/** 배포 갈래를 선분으로 — path 의 a|b 는 갈림길(부모앱 OTA·스토어) */
export function segments(path: string[]): [string, string, number][] {
  const out: [string, string, number][] = [];
  for (let i = 0; i < path.length - 1; i++) {
    for (const a of path[i].split('|')) for (const b of path[i + 1].split('|')) {
      if (a === b) continue;
      // 부모앱: OTA 는 바로 사용자 폰으로, 스토어는 사람 출시를 거친다
      if (a === 'infra:ota' && b === 'v:human-release') continue;
      if (a === 'infra:stores' && b === 'v:users') continue;
      if (a === 'v:users' || (a === 'v:human-release' && b === 'v:human-release')) continue;
      out.push([a, b, i]);
    }
  }
  return out;
}

/** 단계 → 몇 번째 선분이 지금 움직이나(갈래마다) */
// 선분: 0 서비스→GitHub, 1 GitHub→러너, 2 러너→산출물, 3 산출물→대상(부모앱: 3 판정→OTA/스토어, 4 → 사람·사용자)
// 갈래를 더하면 여기도 채운다(LaneKind 로 묶어 빠뜨리면 타입 검사에서 걸린다, #182). 앱 테스트 빌드: 준비와 빌드는 GitHub에서 러너, 올림은 러너에서 산출물
export const SEG_OF_STAGE: Record<LaneKind, number[]> = {
  testbed: [0, 1, 2, 3, 3], prod: [0, 1, 2, 3, 3], apk: [0, 1, 1, 2, 3], store: [0, 1, 2, 3, 4], apptest: [0, 1, 1, 2],
};
