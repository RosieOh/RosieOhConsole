// 인프라 — 서버·DB·Redis·레지스트리·러너·스토어·외부 서비스. 전체 도식(Architecture·배포 흐름)의 오른쪽 절반.
// 이름은 화면(설정 › 연관 관계)에서 바꿀 수 있다. 서버·DB·외부 서비스는 RosieOh 프로젝트 기준으로 다시 채울 자리.
export type InfraKind = 'github' | 'runner' | 'registry' | 'server' | 'db' | 'redis' | 'store' | 'ota' | 'release' | 'external' | 'device';

export interface InfraDef {
  id: string; kind: InfraKind; name: string; sub?: string;
  hosts?: string[];             // 연관 수집이 이 호스트를 만나면 이 인프라로 본다(접미사 일치)
  probe?: { repo: string; key: 'prod' | 'dev' };   // 서버 점검(D) — 이 저장소의 probe.yml 이 그 저장소 배포 키로 접속
  of?: { project: string; role?: string };          // 이름·로고·순서를 카탈로그 노드(프로젝트·그룹)에서 — "<노드> [역할 ]운영 서버"
  note?: string;
}

export const DEFAULT_INFRA: InfraDef[] = [
  { id: 'github', kind: 'github', name: 'GitHub', sub: 'github.com, 코드, PR, Actions', hosts: ['github.com', 'api.github.com'] },
  { id: 'runner-hosted', kind: 'runner', name: 'GitHub 호스티드 러너', sub: 'ubuntu-latest 등, GitHub 이 돌리는 러너' },
  { id: 'ghcr', kind: 'registry', name: 'GitHub Container Registry', sub: 'ghcr.io', hosts: ['ghcr.io'] },
  { id: 'gh-release', kind: 'release', name: 'GitHub Releases', sub: '릴리스 산출물(APK·바이너리)' },
  { id: 'gh-pages', kind: 'server', name: 'GitHub Pages', sub: '<owner>.github.io, 정적 사이트', hosts: ['github.io'] },
];

// 구성요소가 어디로 배포되나 — 전체 도식의 배포 갈래. 없는 쪽은 비운다
export interface Placement {
  runner: string;               // 빌드하는 러너
  artifact: string;             // 산출물이 가는 곳(이미지 저장소·APK 릴리스·OTA/스토어)
  testbed?: string;             // dev 머지 → 여기(인프라 id)
  prod?: string;                // main 머지(+운영 배포 실행) → 여기
}

export const PLACEMENT: Record<string, Placement> = {};

// 같은 저장소를 나눠 쓰는 구성요소 — 어느 경로의 설정이 누구 것인가(연관 수집)
export const SCAN_PATHS: Record<string, { only?: string[]; skip?: string[] }> = {};
