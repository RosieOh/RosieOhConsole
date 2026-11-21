import type { DeployTrack, Endpoint } from '../registry.js';

// 카탈로그 — 그룹 → (그룹 …) → 프로젝트 → 구성요소
export type NodeType = 'group' | 'project';
export type ComponentKind = 'backend' | 'web' | 'device-app' | 'store-app';
export const KINDS: ComponentKind[] = ['backend', 'web', 'device-app', 'store-app'];

export interface NodeDef { id: string; type: NodeType; name: string; parent?: string; order: number }

export interface StoreDef {
  workflow: string;             // .github/workflows/<파일> — main 머지로 도는 릴리스(OTA·스토어 판정)
  tagPrefix: string;            // 스토어 릴리스 태그 접두사(store/)
}
// 부모앱 릴리스는 전부 공용 템플릿(release.yml, store/<버전> 태그)이라 스토어 앱의 기본값은 하나다.
// 코드 기본값(defaults.ts)도, 화면에서 추가한 스토어 앱(merge.ts)도 이 값을 쓴다 (#165).
export const DEFAULT_STORE: StoreDef = { workflow: 'release.yml', tagPrefix: 'store/' };

export interface ComponentDef {
  key: string; name: string; kind: ComponentKind; repo: string; parent: string; order: number;
  note?: string;
  testbed?: Endpoint; prod?: Endpoint; docs?: string; db?: string; profile?: string;
  deploy?: { testbed?: DeployTrack; prod?: DeployTrack };
  store?: StoreDef;
}

// 사람이 화면에서 바꾼 값 — 코드 기본값 위에 덮는다(/data/catalog.json)
export interface NodePatch { name?: string; logo?: string | null; parent?: string | null; order?: number; type?: NodeType; added?: boolean; deleted?: boolean }
export interface ComponentPatch { name?: string; logo?: string | null; parent?: string; order?: number; added?: boolean; deleted?: boolean; kind?: ComponentKind; repo?: string; note?: string }
export interface CatalogOverrides {
  rev: number;
  nodes: Record<string, NodePatch>;
  components: Record<string, ComponentPatch>;
  auto: Record<string, string>;          // 자동으로 고른 로고(구성요소 key → 파일). 사람이 고른 값이 이긴다
}

// 화면에 내주는 모양
export interface CatalogComponent {
  key: string; name: string; kind: ComponentKind; repo: string; project: string; order: number;
  logo: string | null; ownLogo: string | null; note?: string;
  testbed?: Endpoint; prod?: Endpoint; docs?: string; db?: string;
  deployable: { testbed: boolean; prod: boolean };
  store?: StoreDef;
  builtin: boolean;
}
export interface CatalogNode {
  id: string; type: NodeType; name: string; parent: string | null; order: number; logo: string | null; ownLogo: string | null; builtin: boolean;
  children: CatalogNode[]; components: CatalogComponent[];
}
