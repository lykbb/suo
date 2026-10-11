import { useEffect, useMemo, useRef, useState } from 'react';
import { parseCsv } from '../bridge/csv.mjs';
const ROW_HEIGHT = 42;
export default function CsvReader({ text, truncated = false }: { text: string; truncated?: boolean }) {
  const parsed = useMemo(() => parseCsv(text, { truncated }), [text, truncated]);
  const viewport = useRef<HTMLDivElement>(null), [top, setTop] = useState(0), [height, setHeight] = useState(240);
  const header = parsed.rows[0] ?? [], count = Math.max(0, parsed.rows.length - 1);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setHeight(entries[0].contentRect.height));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (viewport.current) viewport.current.scrollTop = 0; setTop(0); }, [text]);
  const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - 5), last = Math.min(count, Math.ceil((top + height) / ROW_HEIGHT) + 5);
  return <div className="csv-reader">
    {!parsed.rows.length ? <p className="reader-message">这份表格没有内容。</p> : <div ref={viewport} className="csv-viewport nodrag nopan nowheel" tabIndex={0} aria-label="CSV 表格" onScroll={event => setTop(event.currentTarget.scrollTop)}>
      <table className="csv-table" aria-rowcount={parsed.rows.length} aria-colcount={parsed.columns}>
        <thead><tr>{Array.from({ length: parsed.columns }, (_, column) => <th key={column} scope="col">{header[column] || `列 ${column + 1}`}</th>)}</tr></thead>
        <tbody>
          {first > 0 && <tr className="csv-spacer" aria-hidden="true"><td colSpan={parsed.columns} style={{ height: first * ROW_HEIGHT }} /></tr>}
          {parsed.rows.slice(first + 1, last + 1).map((row, index) => <tr key={first + index} aria-rowindex={first + index + 2}>
            {Array.from({ length: parsed.columns }, (_, column) => <td key={column}><span title={row[column] ?? ''}>{row[column] ?? ''}</span></td>)}
          </tr>)}
          {last < count && <tr className="csv-spacer" aria-hidden="true"><td colSpan={parsed.columns} style={{ height: (count - last) * ROW_HEIGHT }} /></tr>}
        </tbody>
      </table>
    </div>}
    {parsed.limited && <p className="reader-limit">表格较大，当前显示部分行。</p>}
  </div>;
}
