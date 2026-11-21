import { DEFAULT_COMPONENTS } from './catalog/defaults.js';

// 서비스 기술 연결 — 헬스 주소·배포 워크플로·되돌리기. 무엇이 어느 프로젝트에 속하고 이름·로고가 무엇인지는
// 카탈로그(catalog/)가 정한다. 여기 값은 코드에서 바꾸고 시험한다(사람이 화면에서 바꾸지 않는다).
// testbed: 테스트배드, prod: 운영. 없는 쪽은 비운다.
export interface Endpoint { health: string; link: string }
export interface ServiceDef {
  key: string;
  name: string;
  repo: string;                 // GITHUB_OWNER 의 저장소
  kind: string;                 // backend·web (상태·배포가 붙는 것)
  testbed?: Endpoint;
  prod?: Endpoint;
  docs?: string;                // 테스트배드 OpenAPI 경로 접두사(/grand 등) — Docs 메뉴
  db?: string;                  // 테스트배드 DB(host/schema) — 비밀번호 없음
  profile?: string;
  deploy?: { testbed?: DeployTrack; prod?: DeployTrack };   // 배포 탭(6c)
}

// 배포 탭 — 어느 워크플로 실행 기록에서 이 서비스·환경의 배포를 찾고, 되돌리기는 어떻게 부르나
export interface DeployTrack {
  kamal: string;                // Kamal service 이름 — 로그의 컨테이너 이름 <kamal>-web-<dest>-<버전> 으로 찾는다
  dest: string;                 // Kamal destination(testbed·prod)
  compose?: boolean;            // Kamal 이 아닌 docker compose 운영(채점 서버) — 로그의 이름 규칙만 같고 <kamal>-web- 컨테이너는 없다.
                                //   서버 화면의 컨테이너 경고, 로그, 재시작 대상에서 뺀다
  workflows: string[];          // 배포·되돌리기 워크플로 파일(.github/workflows/…)
  rollback?: {
    workflow: string; ref: string;
    inputs: Record<string, string>;   // {version}·{confirm} 를 채운다
    confirm?: string;                 // 화면에서 직접 입력해야 하는 이름(운영). 템플릿의 confirm 과 같은 값
  };
}

/** 상태 확인·배포 탭이 다루는 구성요소(카탈로그 기본값 중 주소나 배포가 있는 것) */
export function loadRegistry(): ServiceDef[] {
  return DEFAULT_COMPONENTS.filter((c) => c.testbed || c.prod || c.deploy) as ServiceDef[];
}
export const DEFAULT_REGISTRY = loadRegistry();
