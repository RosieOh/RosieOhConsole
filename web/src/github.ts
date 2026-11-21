// GitHub 주소 — 콘솔이 다루는 저장소의 주인. 서버의 GITHUB_OWNER 와 같은 값으로(빌드 때 VITE_GITHUB_OWNER)
export const GITHUB_WEB = 'https://github.com';
export const OWNER: string = (import.meta as any).env?.VITE_GITHUB_OWNER || 'RosieOh';
// 조직 저장소는 이름이 "<조직>/<저장소>" 라 그대로 붙인다
export const ghRepo = (repo: string) => `${GITHUB_WEB}/${repo.includes("/") ? repo : `${OWNER}/${repo}`}`;
