import { AgGridReact } from 'ag-grid-react';
import type { ColDef, RowClickedEvent } from 'ag-grid-community';
import { gridTheme, localeKo } from '../grid';

// 위젯 안 표 — AG Grid(정렬·열 크기 조절), 높이는 줄 수만큼
export function MiniGrid<T>({ rows, cols, rowId, onRow, rowHeight = 36, rowBad }: {
  rows: T[]; cols: ColDef<T>[]; rowId: (r: T) => string; onRow?: (r: T) => void; rowHeight?: number;
  /** 문제 있는 줄 — 그 줄만 잠깐 흔들어 알린다 */
  rowBad?: (r: T) => boolean;
}) {
  return (
    <div className="mini">
      <AgGridReact<T> theme={gridTheme} localeText={localeKo} rowData={rows} columnDefs={cols} domLayout="autoHeight" rowHeight={rowHeight} headerHeight={32}
        defaultColDef={{ sortable: true, resizable: true, suppressHeaderMenuButton: true }} getRowId={(p) => rowId(p.data)} suppressCellFocus
        rowClassRules={rowBad ? { 'row-bad': (p) => !!p.data && rowBad(p.data) } : undefined}
        rowStyle={onRow ? { cursor: 'pointer' } : undefined} onRowClicked={(e: RowClickedEvent<T>) => { if (onRow && e.data && !(e.event?.target as HTMLElement)?.closest('a')) onRow(e.data); }}
        overlayNoRowsTemplate="<span style='color:var(--muted)'>없음</span>" />
    </div>
  );
}
