import { useEffect, useRef, useState } from 'react';
import { columnLabel } from '../bridge/spreadsheet.mjs';
import type { Spreadsheet } from './types';
import './SpreadsheetReader.css';

const PAGE_ROWS = 100;
export default function SpreadsheetReader({ book, compact = false }: { book: Spreadsheet; compact?: boolean }) {
  const [active, setActive] = useState(0), [page, setPage] = useState(0), [selected, setSelected] = useState<{ row: number; column: number }>();
  const viewport = useRef<HTMLDivElement>(null);
  const sheet = book.sheets[Math.min(active, book.sheets.length - 1)];
  useEffect(() => { setActive(0); setPage(0); setSelected(undefined); }, [book]);
  useEffect(() => { setPage(0); setSelected(undefined); }, [active]);
  useEffect(() => { if (viewport.current) { viewport.current.scrollTop = 0; viewport.current.scrollLeft = 0; } setSelected(undefined); }, [page, active]);
  if (!sheet) return <p className="reader-message">这份工作簿没有可读取的工作表。</p>;
  const pages = Math.max(1, Math.ceil(sheet.rows.length / PAGE_ROWS)), current = Math.min(page, pages - 1), start = current * PAGE_ROWS;
  const reference = selected ? `${columnLabel(selected.column)}${selected.row + 1}` : '';
  const value = selected ? sheet.rows[selected.row]?.[selected.column] ?? '' : '';
  const formula = selected ? sheet.formulas[reference] : undefined;
  return <div className={`spreadsheet-reader ${compact ? 'spreadsheet-compact' : ''}`}>
    <nav className="spreadsheet-sheets" aria-label="工作表" role="tablist">
      {book.sheets.map((item, index) => <button key={index} role="tab" aria-selected={active === index} className={active === index ? 'active' : ''} onClick={() => setActive(index)}>{item.name}</button>)}
    </nav>
    <div className="spreadsheet-summary">{sheet.name} · {sheet.rowCount} 行 × {sheet.columnCount} 列</div>
    {!!selected && <div className="spreadsheet-cell-detail" aria-live="polite"><strong>{reference}</strong><button aria-label="关闭单元格详情" onClick={() => setSelected(undefined)}>关闭</button><pre>{value || '（空白单元格）'}</pre>{formula && <p>公式：<code>{formula}</code>（仅显示文件已有缓存结果）</p>}</div>}
    <div ref={viewport} className="spreadsheet-viewport nodrag nopan nowheel" tabIndex={0} aria-label={`${sheet.name} 表格，可上下及左右滚动`}>
      {sheet.rowCount === 0 || sheet.columnCount === 0 ? <p className="reader-message">这个工作表没有内容。</p> : <table className="spreadsheet-table" aria-rowcount={sheet.rowCount + 1} aria-colcount={sheet.columnCount + 1}>
        <thead><tr><th scope="col" aria-label="行号" />{Array.from({ length: sheet.visibleColumns }, (_, column) => <th scope="col" key={column}>{columnLabel(column)}</th>)}</tr></thead>
        <tbody>{sheet.rows.slice(start, start + PAGE_ROWS).map((row, index) => <tr key={start + index} aria-rowindex={start + index + 2}><th scope="row">{start + index + 1}</th>{Array.from({ length: sheet.visibleColumns }, (_, column) => {
          const text = row[column] ?? '', cut = text.length > (compact ? 500 : 1500), chosen = selected?.row === start + index && selected.column === column;
          return <td key={column} className={chosen ? 'selected' : ''} tabIndex={0} aria-selected={chosen} onClick={() => setSelected({ row: start + index, column })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected({ row: start + index, column }); } }}><span>{cut ? text.slice(0, compact ? 500 : 1500) + '…（单击查看全文）' : text}</span></td>;
        })}</tr>)}</tbody>
      </table>}
    </div>
    {pages > 1 && <div className="spreadsheet-pages"><button disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</button><label>第 <select aria-label="选择表格页" value={current} onChange={event => setPage(Number(event.target.value))}>{Array.from({ length: pages }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}</select> / {pages} 页</label><button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一页</button><span>当前第 {start + 1}–{Math.min(start + PAGE_ROWS, sheet.rows.length)} 行</span></div>}
    {(book.limited || book.note) && <p className="reader-limit">{book.note && `${book.note}。`}读取上限：每表前 {book.limits.rows} 行、{book.limits.columns} 列，共 {book.limits.cells} 个单元格、{book.limits.chars / 10000} 万字符、前 {book.sheets.length} / {book.sheetCount} 个工作表。原文件完整保留。</p>}
  </div>;
}
