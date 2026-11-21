// AG Grid(Community) 공통 — 모듈 등록·콘솔 다크 테마·한국어 문구
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

// 색은 CSS 변수 — 밝은·어두운 테마를 같은 테마 객체로
export const gridTheme = themeQuartz.withParams({
  backgroundColor: 'var(--panel-solid)', foregroundColor: 'var(--text)', chromeBackgroundColor: 'var(--panel-solid)',
  headerBackgroundColor: 'var(--panel-2)', headerTextColor: 'var(--muted)', borderColor: 'var(--border)',
  rowHoverColor: 'var(--hover)', selectedRowBackgroundColor: 'var(--selected)', accentColor: 'var(--accent)',
  oddRowBackgroundColor: 'var(--panel-solid)', inputBackgroundColor: 'var(--panel)', inputBorder: { color: 'var(--border-2)' },
  menuBackgroundColor: 'var(--panel)', panelBackgroundColor: 'var(--panel)', subtleTextColor: 'var(--muted)',
  fontFamily: 'var(--sans)', fontSize: 13, headerFontSize: 12.5, headerFontWeight: 600, rowVerticalPaddingScale: 1.15,
  wrapperBorderRadius: 12, borderRadius: 8, spacing: 7, wrapperBorder: { color: 'var(--border)' },
});

export const localeKo: Record<string, string> = {
  noRowsToShow: '보여 줄 줄이 없습니다', loadingOoo: '불러오는 중…', filterOoo: '거르기…', searchOoo: '찾기…',
  equals: '같음', notEqual: '같지 않음', contains: '포함', notContains: '포함 안 함', startsWith: '시작', endsWith: '끝',
  blank: '빈 값', notBlank: '값 있음', andCondition: '그리고', orCondition: '또는', applyFilter: '적용', resetFilter: '초기화', clearFilter: '지우기',
  lessThan: '미만', greaterThan: '초과', lessThanOrEqual: '이하', greaterThanOrEqual: '이상', inRange: '범위',
  pinColumn: '열 고정', pinLeft: '왼쪽 고정', pinRight: '오른쪽 고정', noPin: '고정 해제', autosizeThisColumn: '이 열 맞추기', autosizeAllColumns: '모든 열 맞추기',
  resetColumns: '열 초기화', page: '쪽', of: '/', to: '~', more: '더', next: '다음', previous: '이전', first: '처음', last: '마지막',
};

export const defaultColDef = { sortable: true, filter: true, resizable: true, suppressHeaderMenuButton: false } as const;

export const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

/** 얼마나 이어졌나 — "3시간째", "2일째" */
export const lasting = (iso?: string | null) => {
  if (!iso) return '';
  const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60_000);
  return m < 60 ? `${Math.round(m)}분째` : m < 1440 ? `${Math.floor(m / 60)}시간째` : `${Math.floor(m / 1440)}일째`;
};
