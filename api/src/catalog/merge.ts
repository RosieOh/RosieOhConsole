import { DEFAULT_STORE, type CatalogComponent, type CatalogNode, type CatalogOverrides, type ComponentDef, type NodeDef } from './types.js';

export const UNASSIGNED = '_unassigned';   // 소속 프로젝트가 사라진 구성요소가 모이는 곳(화면에만 있다)

export const emptyOverrides = (): CatalogOverrides => ({ rev: 0, nodes: {}, components: {}, auto: {} });

const byOrder = <T extends { order: number; name: string }>(a: T, b: T) => a.order - b.order || a.name.localeCompare(b.name, 'ko');

/** 코드 기본값 + 편집값 → 트리. 편집값이 이긴다. 부모가 없거나 순환이면 맨 위로 올린다 */
export function buildCatalog(nodes: NodeDef[], comps: ComponentDef[], o: CatalogOverrides): { roots: CatalogNode[]; components: CatalogComponent[] } {
  const defIds = new Set(nodes.map((n) => n.id));
  const all = new Map<string, CatalogNode>();
  const addNode = (id: string, base: Partial<NodeDef> | undefined, builtin: boolean) => {
    const p = o.nodes[id] || {};
    if (p.deleted) return;
    const type = p.type ?? base?.type ?? 'group';
    const name = p.name ?? base?.name ?? id;
    const own = p.logo !== undefined ? p.logo : null;
    all.set(id, { id, type, name, parent: p.parent !== undefined ? p.parent : (base?.parent ?? null), order: p.order ?? base?.order ?? 999,
      logo: own, ownLogo: own, builtin, children: [], components: [] });
  };
  for (const n of nodes) addNode(n.id, n, true);
  for (const [id, p] of Object.entries(o.nodes)) if (p.added && !defIds.has(id)) addNode(id, undefined, false);

  // 순환·없는 부모·프로젝트 아래 그룹 → 맨 위
  const ok = (id: string) => {
    const seen = new Set<string>();
    let cur = all.get(id)!.parent;
    while (cur) {
      if (seen.has(cur) || cur === id) return false;
      seen.add(cur);
      const n = all.get(cur);
      if (!n || n.type !== 'group') return false;
      cur = n.parent;
    }
    return true;
  };
  for (const n of all.values()) if (n.parent && !ok(n.id)) n.parent = null;

  const defKeys = new Set(comps.map((c) => c.key));
  const components: CatalogComponent[] = [];
  const addComp = (key: string, base: ComponentDef | undefined) => {
    const p = o.components[key] || {};
    if (p.deleted) return;
    const kind = base?.kind ?? p.kind ?? 'web';
    const own = p.logo !== undefined ? p.logo : (o.auto[key] ?? null);
    let project = p.parent ?? base?.parent ?? UNASSIGNED;
    if (all.get(project)?.type !== 'project') project = UNASSIGNED;
    components.push({
      key, name: p.name ?? base?.name ?? key, kind, repo: base?.repo ?? p.repo ?? '', project, order: p.order ?? base?.order ?? 999,
      logo: own, ownLogo: own, note: p.note ?? base?.note,
      testbed: base?.testbed, prod: base?.prod, docs: base?.docs, db: base?.db,
      deployable: { testbed: !!base?.deploy?.testbed, prod: !!base?.deploy?.prod },
      // 화면에서 추가한 스토어 앱(base 없음)도 공용 템플릿을 쓰므로 기본값을 준다 — 없으면 배포 탭·플로우·운영 반영에서 전부 빠진다 (#165)
      store: base?.store ?? (kind === 'store-app' ? DEFAULT_STORE : undefined), builtin: !!base,
    });
  };
  for (const c of comps) addComp(c.key, c);
  for (const [key, p] of Object.entries(o.components)) if (p.added && !defKeys.has(key)) addComp(key, undefined);

  if (components.some((c) => c.project === UNASSIGNED)) {
    all.set(UNASSIGNED, { id: UNASSIGNED, type: 'project', name: '미분류', parent: null, order: 99999, logo: null, ownLogo: null, builtin: true, children: [], components: [] });
  }
  for (const c of components) all.get(c.project)!.components.push(c);
  for (const n of all.values()) {
    n.components.sort(byOrder);
    if (n.type === 'project' && !n.logo) n.logo = n.components.find((c) => c.ownLogo)?.ownLogo ?? null;
  }
  // 로고 물려받기: 구성요소 → 프로젝트
  for (const c of components) if (!c.logo) c.logo = all.get(c.project)?.logo ?? null;

  const roots: CatalogNode[] = [];
  for (const n of all.values()) (n.parent ? all.get(n.parent)!.children : roots).push(n);
  const sortTree = (list: CatalogNode[]) => { list.sort(byOrder); for (const n of list) sortTree(n.children); };
  sortTree(roots);
  // 그룹 로고가 없으면 첫 하위 로고
  const fill = (n: CatalogNode): string | null => {
    const kids = n.children.map(fill);
    if (!n.logo) n.logo = kids.find(Boolean) ?? null;
    return n.logo;
  };
  roots.forEach(fill);
  return { roots, components };
}

/** 트리를 따라 경로 이름(개인 › 사이드 프로젝트 › Illinare) */
export function pathOf(roots: CatalogNode[], id: string): string[] {
  const walk = (list: CatalogNode[], acc: string[]): string[] | null => {
    for (const n of list) {
      const next = [...acc, n.name];
      if (n.id === id) return next;
      const hit = walk(n.children, next);
      if (hit) return hit;
    }
    return null;
  };
  return walk(roots, []) ?? [];
}
