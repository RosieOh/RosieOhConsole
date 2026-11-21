// 배포 갈래와 단계 — 실행 중인 작업의 단계 이름으로 "지금 어디까지 왔나"를 읽는다(전체 도식 애니메이션).
// apptest(#182): 자녀앱, 부모앱의 테스트 빌드(testbed-apk.yml, 개발 서버 연동 APK, 부모앱은 TestFlight 까지)
export type LaneKind = 'testbed' | 'prod' | 'apk' | 'store' | 'apptest';

export interface StageDef { id: string; label: string; re?: RegExp }
export const STAGES: Record<LaneKind, StageDef[]> = {
  testbed: [
    { id: 'trigger', label: 'dev 머지' },
    { id: 'test', label: '테스트', re: /테스트|^test/i },
    { id: 'build', label: '이미지 빌드', re: /SSH|빌드|bootJar|docker CLI|pre-build|Java|Kamal 준비/ },
    { id: 'deploy', label: 'Kamal 배포', re: /Kamal 배포|pre-deploy|post-deploy|^Kamal$/ },
    { id: 'verify', label: '바깥 확인', re: /외부 확인|바깥|레지스트리 로그아웃/ },
  ],
  prod: [
    { id: 'trigger', label: 'main 머지, 운영 실행' },
    { id: 'prepare', label: '준비, 환경변수', re: /입력 확인|SSH|환경변수|서버 준비|Firebase|^테스트$/ },
    { id: 'build', label: '이미지 빌드', re: /pre-build|Java|bootJar|docker CLI/ },
    { id: 'deploy', label: 'Kamal 교체', re: /^Kamal|nginx|서버 설정/ },
    { id: 'verify', label: '바깥 확인, 60초 감시', re: /바깥|외부|감시|상태 남기기|로그아웃/ },
  ],
  apk: [
    { id: 'trigger', label: 'main 머지, 릴리스 실행' },
    { id: 'version', label: '버전 올림', re: /도구|버전 올림/ },
    { id: 'build', label: '서명 APK 빌드', re: /의존성|APK 빌드/ },
    { id: 'tag', label: '커밋, 태그', re: /커밋|태그/ },
    { id: 'release', label: 'APK 릴리스', re: /릴리스/ },
  ],
  store: [
    { id: 'trigger', label: 'main 머지' },
    { id: 'prepare', label: '준비, 의존성', re: /실행 조건|도구|서명|의존성|codegen|checkout/i },
    { id: 'decide', label: 'OTA, 스토어 판정', re: /판정|dry-run/ },
    { id: 'ship', label: 'OTA 배포 / 스토어 업로드', re: /OTA 배포|스토어 빌드/ },
    { id: 'tag', label: '태그, 버전 커밋', re: /태그 push/ },
  ],
  // 단계 이름은 앱 테스트 빌드 워크플로(APK·스토어 APK·iOS)의 단계 이름 규칙을 따른다.
  // 앞 단계부터 맞춰 보므로 "TestFlight 올리기 (그 버전에 운영 빌드가 ...)"처럼 낱말이 겹치는 이름은 넓은 말로 잡지 않는다
  apptest: [
    { id: 'trigger', label: 'dev 머지, 테스트 빌드' },
    { id: 'prepare', label: '준비, 테스트 버전', re: /도구|서명 설정|버전 올림|버전 읽기|버전 정하기|테스트배드 서버로|의존성|codegen/ },
    { id: 'build', label: 'APK, iOS 빌드', re: /APK 빌드|iOS 테스트배드 빌드|서명 확인/ },
    { id: 'upload', label: '보관함, TestFlight 올림', re: /프리릴리스|TestFlight 올리기|릴리스 기록/ },
  ],
};

export interface Step { name: string; status: string; conclusion?: string | null; started_at?: string | null; completed_at?: string | null }

/** 단계 목록 → 지금 단계(가장 늦게 시작했거나 진행 중인 단계가 속한 갈래 단계) */
export function stageOf(lane: LaneKind, steps: Step[]): { index: number; current: string | null; done: number; total: number; failedStep: string | null; branch?: 'ota' | 'store' } {
  const defs = STAGES[lane];
  const real = steps.filter((s) => !/^(Set up|Complete|Post |Run Post)/.test(s.name));
  let index = 0; let current: string | null = null;
  for (const s of real) {
    const started = s.status === 'in_progress' || s.status === 'running' || (s.status === 'completed' && s.conclusion !== 'skipped');
    if (!started) continue;
    const at = defs.findIndex((d) => d.re?.test(s.name));
    if (at > index) index = at;
    if (s.status === 'in_progress' || s.status === 'running') current = s.name;
  }
  if (index === 0 && real.some((s) => s.status !== 'waiting' && s.status !== 'queued' && s.status !== 'pending')) index = Math.min(1, defs.length - 1);
  const failed = real.find((s) => s.conclusion === 'failure');
  let branch: 'ota' | 'store' | undefined;
  if (lane === 'store') {
    const ok = (re: RegExp) => real.some((s) => re.test(s.name) && (s.status === 'in_progress' || s.conclusion === 'success'));
    branch = ok(/스토어 빌드/) ? 'store' : ok(/OTA 배포/) ? 'ota' : undefined;
  }
  return { index, current, done: real.filter((s) => s.status === 'completed').length, total: real.length, failedStep: failed?.name ?? null, branch };
}

/** 단계 시각으로 로그 자르기 — 로그 줄은 "2026-10-08T08:17:04.7064534Z 내용" */
export function sliceLog(log: string, from?: string | null, to?: string | null, maxLines = 400): string {
  const a = from ? Date.parse(from) - 1000 : -Infinity;
  const b = to ? Date.parse(to) + 1000 : Infinity;
  const out: string[] = [];
  for (const line of log.split('\n')) {
    const t = Date.parse(line.slice(0, 28));
    if (Number.isNaN(t) ? out.length > 0 : t >= a && t <= b) out.push(line.replace(/^\S+Z /, ''));
  }
  return out.slice(-maxLines).join('\n');
}

/** 진행 중 로그 끝부분 — 사람이 읽을 줄만(러너 내부 잡음 제거), 시각 떼고 */
const NOISE = /^(\s*🐳|\s*☁|Writing entry|Extracting content|evaluating expression|expression '|Exec command|Working directory|\[command\]|Temporarily overriding|Adding repository directory|Cleaning up|Removed container|Wrote command|.*docker (pull|volume|exec)|##\[(add-matcher|group|endgroup)\]|::(group|endgroup|add-mask)|\s*$)/;
export function tailLog(log: string, n = 12): string[] {
  const out: string[] = [];
  for (const raw of log.split('\n')) {
    const line = raw.replace(/^\S+Z /, '').replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
    if (!line || NOISE.test(line)) continue;
    out.push(line.length > 220 ? line.slice(0, 220) + '…' : line);
  }
  return out.slice(-n);
}
