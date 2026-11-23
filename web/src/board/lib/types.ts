/** 서버(/api/board, /api/me, /api/report …)가 주는 자료의 모양 */
export type Stage =
  | 'intake' | 'planned' | 'started' | 'review' | 'ready_to_merge'
  | 'awaiting_deploy' | 'deployed' | 'done' | 'cancelled';
export type ColumnKey = Stage | 'unstaged';

export interface Card {
  repo: string;
  number: number;
  title: string;
  url: string;
  assignees: string[];
  milestone: string;
  due: string | null;
  overdue: boolean;
  stale: boolean;
  flags: string[];
  stage: ColumnKey;
  human: Stage | null;
  manual: boolean;
  derivedStage: Stage | null;
  prevStage: Stage | null;
  evidence: string[];
  disagree: boolean;
  dupStage: boolean;
}

export interface Column { key: ColumnKey; title: string; cards: Card[] }

export interface BoardData {
  columns: Column[];
  batchAt: string | null;
  counts: Record<string, number>;
  warning: string;
  readonly: boolean;
  unlinked?: Unlinked[];
  unlinkedAt?: string | null;
}

/** 이슈와 연결되지 않은 작업 — 본문에 closes #번호 가 없는 열린 PR, 또는 #번호 없이 커밋 중인 브랜치 */
export interface Unlinked {
  kind: 'pr' | 'branch';
  repo: string;
  number?: number;
  branch?: string;
  title: string;
  author: string;
  updated: string | null;
  url: string;
  draft?: boolean;
}

export interface Me { login: string | null; admin: boolean; viewer?: boolean }

export interface ReportTask {
  repo: string; number: number; title: string; stage: ColumnKey; prevStage: Stage | null;
  assignees: string[]; overdue: boolean; stale: boolean; flags: string[]; url: string;
}
export type ReportStatus = 'auto' | 'edited' | 'changed' | 'reflected';
export interface ReportProject {
  name: string; repos: string[]; milestone: string; tasks: ReportTask[];
  auto: string; text: string; edited: boolean; editedBy: string | null; editedAt: string | null;
  reflectedAt: string | null; reflectedBy: string | null; sheetText: string; warnings: string[]; status: ReportStatus;
}
export interface ReportData { ok: boolean; week: string; weekFound: boolean; legacyRemoved: number; projects: ReportProject[] }

export interface TrackedRepo { repo: string; type: string }
export interface RepoSearchResult { repo: string; owner?: string; description: string; private: boolean; archived?: boolean; updated: string | null; tracked: boolean }
export interface ReposData { tracked: TrackedRepo[]; results: RepoSearchResult[]; types: Record<string, string>; org: string; orgs?: string[]; error?: string }
export interface ViewersData { viewers: string[]; admins: string[]; candidates: string[] }
