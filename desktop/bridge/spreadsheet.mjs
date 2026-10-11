// Restricted, read-only OOXML. No formula evaluation, external relations, or XML entities.
export const SPREADSHEET_LIMITS = Object.freeze({ bytes: 20 * 1024 * 1024, expandedBytes: 64 * 1024 * 1024, entryBytes: 16 * 1024 * 1024, entries: 2048, sheets: 50, rows: 2000, columns: 100, cells: 100000, chars: 1000000 });
export const XLS_MESSAGE = '旧版 .xls 暂不支持预览或分析，请在 Excel 中另存为 .xlsx 后导入。';
const invalid = () => new Error('无法读取这份 XLSX：文件损坏、加密或结构不受支持，请另存为 .xlsx 后重试。');
const oversized = () => new Error('这份 XLSX 超过安全读取范围（文件 20 MB、解压后 64 MB、单个内部文件 16 MB），请拆分后导入。');
const decoder = new TextDecoder('utf-8', { fatal: true });
const crcTable = Array.from({ length: 256 }, (_, value) => { for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
export function zipCrc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function utf8(bytes) { try { return decoder.decode(bytes); } catch { throw invalid(); } }
function archive(input, inflate) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > SPREADSHEET_LIMITS.bytes) throw oversized();
  if (bytes.length < 22) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => view.getUint16(offset, true), u32 = offset => view.getUint32(offset, true);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break; }
  }
  if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) throw invalid();
  const count = u16(end + 10), centralSize = u32(end + 12), centralOffset = u32(end + 16);
  if (!count || count === 0xffff || count > SPREADSHEET_LIMITS.entries || centralOffset + centralSize !== end) throw invalid();
  const entries = new Map(); let at = centralOffset, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) throw invalid();
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16), compressed = u32(at + 20), size = u32(at + 24);
    const nameSize = u16(at + 28), extra = u16(at + 30), comment = u16(at + 32), local = u32(at + 42), next = at + 46 + nameSize + extra + comment;
    if (next > end || u16(at + 34) || (flags & 0x41) || ![0, 8].includes(method) || local + 30 > centralOffset || compressed === 0xffffffff || size === 0xffffffff) throw invalid();
    expanded += size;
    if (size > SPREADSHEET_LIMITS.entryBytes || expanded > SPREADSHEET_LIMITS.expandedBytes || size > Math.max(1024 * 1024, compressed * 1000)) throw oversized();
    const name = utf8(bytes.subarray(at + 46, at + 46 + nameSize));
    if (!name || /^[\/]/u.test(name) || /[\\\u0000]/u.test(name) || name.split('/').some(part => part === '..' || part === '.') || entries.has(name)) throw invalid();
    if (u32(local) !== 0x04034b50 || u16(local + 8) !== method || u16(local + 6) !== flags) throw invalid();
    const localNameSize = u16(local + 26), localExtraSize = u16(local + 28), data = local + 30 + localNameSize + localExtraSize;
    if (data > centralOffset || utf8(bytes.subarray(local + 30, local + 30 + localNameSize)) !== name || data + compressed > centralOffset || (method === 0 && size !== compressed)) throw invalid();
    entries.set(name, { method, crc, size, compressed, data, end: data + compressed, local }); at = next;
  }
  if (at !== end) throw invalid();
  const ranges = [...entries.values()].sort((a, b) => a.local - b.local);
  if (ranges.some((entry, index) => index > 0 && entry.local < ranges[index - 1].end)) throw invalid();
  return async path => {
    const entry = entries.get(path);
    if (!entry) return undefined;
    let output;
    try { output = entry.method === 0 ? bytes.subarray(entry.data, entry.end) : await inflate(bytes.subarray(entry.data, entry.end), entry.size); }
    catch { throw invalid(); }
    if (!(output instanceof Uint8Array) || output.length !== entry.size || zipCrc32(output) !== entry.crc) throw invalid();
    return utf8(output);
  };
}
function decodeText(value) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw invalid();
  return value.replace(/&([^;]*);|&/gu, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(named, entity)) return named[entity];
    if (/^#(?:[0-9]+|x[0-9a-f]+)$/iu.test(entity ?? '')) {
      const point = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (point === 9 || point === 10 || point === 13 || point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) && point !== 0xfffe && point !== 0xffff) return String.fromCodePoint(point);
    }
    throw invalid();
  });
}
const localName = name => name.split(':').at(-1);
function xml(text, { open = () => {}, close = () => {}, value = () => {} } = {}) {
  if (text === undefined || /<!\s*(?:DOCTYPE|ENTITY)/iu.test(text)) throw invalid();
  const stack = []; let root = false, roots = 0, tokens = 0, at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (at < text.length) {
    if (++tokens > 600000) throw oversized();
    if (text[at] !== '<') {
      let end = text.indexOf('<', at); if (end < 0) end = text.length;
      const content = decodeText(text.slice(at, end));
      if (!stack.length && content.trim()) throw invalid();
      if (stack.length) value(content, localName(stack.at(-1))); at = end; continue;
    }
    if (text.startsWith('<!--', at)) { const end = text.indexOf('-->', at + 4); if (end < 0 || text.slice(at + 4, end).includes('--')) throw invalid(); at = end + 3; continue; }
    if (text.startsWith('<?', at)) { const end = text.indexOf('?>', at + 2); if (end < 0 || !/^xml(?:\s|$)/iu.test(text.slice(at + 2, end)) || root) throw invalid(); at = end + 2; continue; }
    if (text.startsWith('<![CDATA[', at)) { const end = text.indexOf(']]>', at + 9); if (end < 0 || !stack.length) throw invalid(); value(text.slice(at + 9, end), localName(stack.at(-1))); at = end + 3; continue; }
    const tag = /^<\/?([A-Za-z_][\w.:-]*)/u.exec(text.slice(at));
    if (!tag) throw invalid();
    const name = tag[1], closing = text[at + 1] === '/'; let cursor = at + tag[0].length, self = false;
    const attrs = Object.create(null);
    while (cursor < text.length) {
      const spaces = /^\s*/u.exec(text.slice(cursor))[0]; cursor += spaces.length;
      if (text[cursor] === '>') { cursor++; break; }
      if (text.slice(cursor, cursor + 2) === '/>' && !closing) { self = true; cursor += 2; break; }
      if (closing || !spaces.length) throw invalid();
      const attr = /^([A-Za-z_][\w.:-]*)\s*=\s*(["'])/u.exec(text.slice(cursor));
      if (!attr || attr[1] in attrs) throw invalid();
      cursor += attr[0].length;
      const end = text.indexOf(attr[2], cursor);
      if (end < 0 || text.slice(cursor, end).includes('<')) throw invalid();
      attrs[attr[1]] = decodeText(text.slice(cursor, end)); cursor = end + 1;
    }
    if (cursor > text.length || text[cursor - 1] !== '>') throw invalid();
    at = cursor;
    if (closing) { if (stack.pop() !== name) throw invalid(); close(localName(name)); }
    else {
      if (!stack.length) { if (++roots > 1) throw invalid(); root = true; }
      if (stack.length > 64) throw invalid();
      stack.push(name); open(localName(name), attrs);
      if (self) { close(localName(name)); stack.pop(); }
    }
  }
  if (stack.length || !root) throw invalid();
}
function packagePath(base, target) {
  if (!target || /[\\?#\u0000]|^[a-z]+:/iu.test(target)) throw invalid();
  const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) throw invalid(); parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}
function relationships(text, base) {
  const result = new Map();
  xml(text, { open: (name, attrs) => {
    if (name !== 'Relationship') return;
    if (!attrs.Id || result.has(attrs.Id)) throw invalid();
    if (attrs.TargetMode === 'External') { result.set(attrs.Id, null); return; }
    result.set(attrs.Id, { type: attrs.Type ?? '', path: packagePath(base, attrs.Target) });
  } });
  return result;
}
function strings(text) {
  const output = []; let inString = false, inText = false, phonetic = 0, current = '', chars = 0;
  xml(text, { open: name => { if (name === 'si') { if (inString) throw invalid(); inString = true; current = ''; } if (name === 'rPh') phonetic++; if (name === 't' && !phonetic) inText = true; },
    value: content => { if (inString && inText && !phonetic) { chars += content.length; if (chars > 4 * SPREADSHEET_LIMITS.chars) throw oversized(); current += content; } },
    close: name => { if (name === 'rPh') phonetic--; if (name === 't') inText = false; if (name === 'si') { output.push(current); inString = false; if (output.length > 200000) throw oversized(); } } });
  return output;
}
function styles(text) {
  if (!text) return [];
  const formats = new Map(); const result = []; let inCells = false;
  xml(text, { open: (name, attrs) => { if (name === 'numFmt') formats.set(attrs.numFmtId, attrs.formatCode); if (name === 'cellXfs') inCells = true; if (name === 'xf' && inCells) result.push(formats.get(attrs.numFmtId)); }, close: name => { if (name === 'cellXfs') inCells = false; } });
  return result;
}
export function columnLabel(index) { let label = ''; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(65 + (value - 1) % 26) + label; return label; }
function address(ref) {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(ref ?? '');
  if (!match) throw invalid();
  let column = 0; for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[2]); if (column > 16384 || row > 1048576) throw invalid();
  return { row: row - 1, column: column - 1 };
}
function worksheet(text, name, shared, formats, budget) {
  const rows = [], formulas = Object.create(null); let rowCount = 0, columnCount = 0, currentRow = -1, nextColumn = 0, cell, part, phonetic = 0, limited = false;
  xml(text, {
    open: (tag, attrs) => {
      if (tag === 'dimension' && attrs.ref) { for (const ref of attrs.ref.split(':')) { const pos = address(ref); rowCount = Math.max(rowCount, pos.row + 1); columnCount = Math.max(columnCount, pos.column + 1); } }
      if (tag === 'row') { currentRow = attrs.r ? address(`A${attrs.r}`).row : currentRow + 1; rowCount = Math.max(rowCount, currentRow + 1); nextColumn = 0; }
      if (tag === 'c') {
        if (cell || currentRow < 0) throw invalid();
        const pos = attrs.r ? address(attrs.r) : { row: currentRow, column: nextColumn };
        nextColumn = pos.column + 1; rowCount = Math.max(rowCount, pos.row + 1); columnCount = Math.max(columnCount, pos.column + 1);
        cell = { ...pos, type: attrs.t, style: attrs.s, cached: '', inline: '', formula: '', hasValue: false, hasFormula: false };
      }
      if (tag === 'rPh') phonetic++;
      if (cell && ['v', 't', 'f'].includes(tag)) { part = tag; if (tag === 'v') cell.hasValue = true; if (tag === 'f') cell.hasFormula = true; }
    },
    value: content => { if (!cell) return; if (part === 'v') cell.cached += content; if (part === 'f') cell.formula += content; if (part === 't' && !phonetic) cell.inline += content; },
    close: tag => {
      if (tag === 'rPh') phonetic--; if (tag === part) part = undefined;
      if (tag !== 'c' || !cell) return;
      let content = cell.type === 'inlineStr' ? cell.inline : cell.cached;
      if (cell.type === 's') {
        if (!/^\d+$/u.test(content) || Number(content) >= shared.length) throw invalid(); content = shared[Number(content)];
      }
      // Preserve the original numeric spelling, with only simple all-zero formats padded.
      const format = formats[Number(cell.style)];
      if ((!cell.type || cell.type === 'n') && /^0{2,20}$/u.test(format ?? '') && /^\d+$/u.test(content)) content = content.padStart(format.length, '0');
      if (cell.hasFormula && !cell.hasValue) content = '[公式无缓存结果]';
      if (cell.row < SPREADSHEET_LIMITS.rows && cell.column < SPREADSHEET_LIMITS.columns && budget.cells < SPREADSHEET_LIMITS.cells && budget.chars + content.length <= SPREADSHEET_LIMITS.chars) {
        rows[cell.row] ??= []; rows[cell.row][cell.column] = content;
        if (cell.hasFormula) formulas[`${columnLabel(cell.column)}${cell.row + 1}`] = cell.formula.slice(0, 4000) || '[共享公式，表达式由工作簿其他单元格定义]';
        budget.cells++; budget.chars += content.length;
      } else limited = true;
      cell = undefined;
    },
  });
  if (cell) throw invalid();
  const visibleRows = Math.min(rowCount, SPREADSHEET_LIMITS.rows), visibleColumns = Math.min(columnCount, SPREADSHEET_LIMITS.columns);
  // Sparse ranges keep blank positions and their original row numbers; never infer headers.
  for (let index = 0; index < visibleRows; index++) rows[index] ??= [];
  return { name, rows, rowCount, columnCount, visibleColumns, formulas, limited: limited || rowCount > visibleRows || columnCount > visibleColumns };
}
export async function parseXlsx(bytes, inflate) {
  const read = archive(bytes, inflate);
  const root = relationships(await read('_rels/.rels'), '');
  const office = [...root.values()].find(item => item?.type.endsWith('/officeDocument'));
  if (!office || !office.path.endsWith('.xml')) throw invalid();
  const path = office.path, slash = path.lastIndexOf('/'), relPath = `${path.slice(0, slash + 1)}_rels/${path.slice(slash + 1)}.rels`;
  const relations = relationships(await read(relPath), path), declarations = [];
  xml(await read(path), { open: (name, attrs) => { if (name === 'sheet') { const id = attrs['r:id'] ?? Object.entries(attrs).find(([key]) => key.endsWith(':id'))?.[1]; if (!attrs.name || !id) throw invalid(); declarations.push({ name: attrs.name, id }); } } });
  if (!declarations.length) throw invalid();
  const sharedPath = [...relations.values()].find(item => item?.type.endsWith('/sharedStrings'))?.path;
  const stylePath = [...relations.values()].find(item => item?.type.endsWith('/styles'))?.path;
  const shared = sharedPath ? strings(await read(sharedPath)) : [], formats = stylePath ? styles(await read(stylePath)) : [];
  const sheets = [], budget = { cells: 0, chars: 0 }; let unsupported = 0;
  for (const sheet of declarations.slice(0, SPREADSHEET_LIMITS.sheets)) {
    const relation = relations.get(sheet.id);
    if (!relation || !relation.type.endsWith('/worksheet')) { unsupported++; continue; }
    sheets.push(worksheet(await read(relation.path), sheet.name, shared, formats, budget));
  }
  if (!sheets.length) throw invalid();
  return { sheets, sheetCount: declarations.length, limited: declarations.length > sheets.length || sheets.some(sheet => sheet.limited), limits: { rows: SPREADSHEET_LIMITS.rows, columns: SPREADSHEET_LIMITS.columns, cells: SPREADSHEET_LIMITS.cells, chars: SPREADSHEET_LIMITS.chars }, ...(unsupported ? { note: `${unsupported} 个图表或非普通工作表未读取` } : {}) };
}
export function spreadsheetText(book) {
  let text = '', truncated = false;
  const append = value => { const room = SPREADSHEET_LIMITS.chars - text.length; if (value.length > room) { text += value.slice(0, room); truncated = true; } else text += value; };
  for (const sheet of book.sheets) {
    append(`\n[工作表：${sheet.name}]\n`);
    sheet.rows.forEach((row, index) => {
      const cells = row.flatMap((value, column) => value !== '' && value !== undefined ? [`${columnLabel(column)}${index + 1}=${JSON.stringify(value)}`] : []);
      if (cells.length) append(`[第 ${index + 1} 行] ${cells.join(' | ')}\n`);
    });
    if (sheet.limited) append(`[工作表内容已截取；原范围 ${sheet.rowCount} 行 × ${sheet.columnCount} 列]\n`);
  }
  if (book.limited) append(`[表格读取范围：最多 ${book.limits.rows} 行/表、${book.limits.columns} 列/表、${book.limits.cells} 个单元格、${book.limits.chars} 字符；原文件完整保留]\n`);
  return { text: text.trimStart(), truncated: truncated || book.limited };
}
