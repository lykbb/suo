function guessDelimiter(text) {
  const counts = new Map([ [',', 0], [';', 0], ['\t', 0] ]);
  let quoted = false;
  for (let index = 0; index < Math.min(text.length, 65536); index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index++; else quoted = !quoted;
    } else if (!quoted) {
      if (char === '\n' || char === '\r') break;
      if (counts.has(char)) counts.set(char, counts.get(char) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}
export function parseCsv(source, { truncated = false, maxCells = 200000 } = {}) {
  const text = source.replace(/^\uFEFF/, ''), delimiter = guessDelimiter(text);
  const rows = [];
  let row = [], field = '', quoted = false, columns = 0, cells = 0, limited = false;
  const finishRow = () => {
    row.push(field); field = '';
    if (row.length > 1 || row.some(value => value !== '')) {
      if (cells + row.length > maxCells) { limited = true; return false; }
      rows.push(row); cells += row.length; columns = Math.max(columns, row.length);
    }
    row = []; return true;
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && (quoted || !field.length)) {
      if (quoted && text[index + 1] === '"') { field += '"'; index++; } else quoted = !quoted;
    } else if (!quoted && char === delimiter) { row.push(field); field = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (!finishRow()) break;
      if (char === '\r' && text[index + 1] === '\n') index++;
    } else field += char;
    if (row.length >= maxCells) { limited = true; break; }
  }
  if (!limited && (field || row.length) && !truncated) finishRow();
  return { rows, columns, delimiter, limited: limited || truncated };
}
