import type { ComponentDef, NodeDef } from './types.js';

// 카탈로그 기본값 — 그룹 → 프로젝트 → 구성요소. 이름·로고·소속·순서는 화면(설정 › 서비스 카탈로그)에서 바꾼다(편집값이 이긴다).
// 기술 연결(헬스 주소·배포 워크플로·되돌리기)이 있는 구성요소는 여기 코드로 적는다.

export const DEFAULT_NODES: NodeDef[] = [];

export const DEFAULT_COMPONENTS: ComponentDef[] = [];
