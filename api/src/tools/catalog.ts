// 도구 — 저장소별 "무엇이고 어떻게 설치하나". 버전·변경 내역은 GitHub 에서 읽고, 설치 방법만 여기 적는다.
// 저장소 이름을 키로 한 줄 추가하면 도구 화면에 나온다(없는 저장소는 보이지 않는다).
export interface ToolMeta {
  kind: string;                    // 사람이 읽는 종류
  required?: boolean;              // 필수 설치
  install?: string[];
  update?: string[];
  check?: string;
  note?: string;
  versionFrom?: 'marketplace' | 'tag';
  links?: { label: string; url: string }[];   // 바로 열어 볼 곳
}

export function catalog(web: string, owner: string): Record<string, ToolMeta> {
  return {
    trove: {
      kind: 'CLI, Claude Code 기록 검색', versionFrom: 'tag',
      note: 'Claude Code 대화 기록을 내 컴퓨터에서 찾고 보관한다.',
      links: [{ label: '릴리스', url: `${web}/${owner}/trove/releases` }],
    },
  };
}
