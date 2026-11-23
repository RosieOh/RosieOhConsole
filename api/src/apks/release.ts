// APK 보관함 — 기기앱 릴리스 읽기. 릴리스는 앱 릴리스 워크플로가 만든다(본문 형식은 아래):
//   기기앱 v1.6.3 (versionCode 16003)
//   SHA-256: <64자>
//   빌드: <실행 결과 주소>
// 내부 테스트 빌드(app-device-apk-testbed, dev 머지마다)는 프리릴리스이고 본문에 몇 줄이 더 있다:
//   커밋: <sha>
//   서버: <테스트배드 주소>
// 어떤 앱이 보관함에 나오는지·이름·로고는 카탈로그(종류 device-app)가 정한다.

export function readReleaseBody(body: string | null | undefined) {
  const b = String(body || '');
  return {
    versionCode: Number(b.match(/versionCode\s+(\d+)/)?.[1]) || null,
    sha256: b.match(/SHA-256:\s*([0-9a-f]{64})/i)?.[1]?.toLowerCase() ?? null,
    buildUrl: b.match(/빌드:\s*(https?:\/\/\S+)/)?.[1] ?? null,
    commit: b.match(/커밋:\s*([0-9a-f]{7,40})/i)?.[1]?.toLowerCase() ?? null,
    server: b.match(/서버:\s*(https?:\/\/\S+)/)?.[1] ?? null,
  };
}

/** 다운로드 파일 이름 — 따옴표·줄바꿈이 헤더를 깨지 않게, 한글 이름은 filename* 로 */
export function contentDisposition(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

