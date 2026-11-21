// APK 보관함에 나오는 앱 (#175). 기기앱(device-app)은 운영 릴리스와 내부 테스트를, 부모앱(store-app)은 내부 테스트만 보인다.
// 부모앱 운영 배포는 스토어(TestFlight, Play)로 나가므로 보관함의 "운영" 칸, 녹스, 출고 기록은 기기앱 것이다.
// 부모앱 내부 테스트 빌드는 기기앱과 같은 태그(testbed-<버전>-<번호>), 본문으로 만든다.
export type ApkKind = 'device-app' | 'store-app';

export function isApkKind(kind: string): kind is ApkKind {
  return kind === 'device-app' || kind === 'store-app';
}

/** 카탈로그 구성 요소 중 보관함에 나오는 것(저장소가 있는 기기앱, 부모앱), 카탈로그 순서 그대로 */
export function apkApps<T extends { kind: string; repo?: string | null }>(components: T[]): T[] {
  return components.filter((c) => isApkKind(c.kind) && !!c.repo);
}

/** 운영 릴리스(녹스, 출고 기록)를 읽고 보이는 종류 */
export const hasReleases = (kind: string) => kind === 'device-app';
