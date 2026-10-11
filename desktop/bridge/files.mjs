import { readFile, mkdir, writeFile, stat, copyFile, chmod, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { assertId } from './store.mjs';
import { fileKind, MAX_FILE_BYTES, MAX_TEXT_CHARS, MAX_HTML_CHARS, MAX_TEXT_BYTES, MAX_HTML_BYTES, FILE_LIMIT_MESSAGE } from './formats.mjs';
import { readXlsx } from './spreadsheet-node.mjs';
import { spreadsheetText, SPREADSHEET_LIMITS, XLS_MESSAGE } from './spreadsheet.mjs';
export { fileKind, MAX_FILE_BYTES } from './formats.mjs';

function wordText(bytes, name) {
  if (process.platform !== 'darwin') throw new Error('Word 正文读取目前支持 Mac 桌面版。');
  const format = extname(name).slice(1).toLowerCase();
  return new Promise((resolve, reject) => {
    const child = execFile('/usr/bin/textutil', ['-convert', 'txt', '-format', format, '-stdin', '-stdout', '-encoding', 'UTF-8', '-noload', '-nostore'],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        if (error) reject(new Error('无法读取这份 Word 正文。请检查文件是否损坏、加密，或另存为 DOCX。'));
        else resolve(stdout);
      });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}
async function prefixBytes(path, limit) {
  const handle = await open(path, 'r');
  try {
    const size = (await handle.stat()).size;
    const bytes = Buffer.alloc(Math.min(size, limit));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    return { bytes: bytes.subarray(0, offset), size };
  } finally { await handle.close(); }
}
export class FileStore {
  constructor(root) { this.root = join(root, 'imports'); }
  async importPaths(paths) {
    const result = [];
    for (const path of paths.slice(20)) result.push({ name: basename(path), error: '一次最多导入 20 份资料，请分批添加。' });
    for (const path of paths.slice(0, 20)) {
      try {
        const info = await stat(path);
        if (!info.isFile()) throw new Error('只支持文件，暂不支持文件夹。');
        if (info.size > MAX_FILE_BYTES) throw new Error(FILE_LIMIT_MESSAGE);
        const id = randomUUID(), name = basename(path), type = fileKind(name);
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        const original = join(this.root, `${id}.bin`);
        await copyFile(path, original, constants.COPYFILE_EXCL);
        await chmod(original, 0o600);
        const size = (await stat(original)).size;
        if (size > MAX_FILE_BYTES) throw new Error(FILE_LIMIT_MESSAGE);
        const metadata = { id, name, size, ...type };
        await writeFile(join(this.root, `${id}.json`), JSON.stringify(metadata), { flag: 'wx', mode: 0o600 });
        const preview = type.kind === 'text' || type.kind === 'html'
          ? (await prefixBytes(original, 400004)).bytes.toString('utf8').slice(0, 100000) : undefined;
        result.push({ ...metadata, preview });
      } catch (error) { result.push({ name: basename(path), error: error.message }); }
    }
    return result;
  }
  async get(id, { metadataOnly = false } = {}) {
    assertId(id);
    const metadata = JSON.parse(await readFile(join(this.root, `${id}.json`), 'utf8'));
    const original = join(this.root, `${id}.bin`);
    const info = await stat(original);
    if (info.size > MAX_FILE_BYTES) throw new Error(FILE_LIMIT_MESSAGE);
    // Reclassify older imports without rewriting their metadata or original.
    const type = fileKind(metadata.name), asset = { ...metadata, ...type, size: info.size };
    if (type.kind === 'text' || type.kind === 'html') {
      const html = type.kind === 'html';
      const limit = html ? MAX_HTML_CHARS : MAX_TEXT_CHARS;
      const { bytes, size } = await prefixBytes(original, html ? MAX_HTML_BYTES : MAX_TEXT_BYTES);
      const text = bytes.toString('utf8');
      return { ...asset, text: text.slice(0, limit), truncated: text.length > limit || bytes.length < size };
    }
    if (type.kind === 'word') {
      const text = await wordText(await readFile(original), metadata.name);
      return { ...asset, text: text.slice(0, MAX_TEXT_CHARS), truncated: text.length > MAX_TEXT_CHARS };
    }
    if (type.kind === 'spreadsheet') {
      if (/\.xls$/iu.test(metadata.name)) return { ...asset, error: XLS_MESSAGE };
      if (info.size > SPREADSHEET_LIMITS.bytes) return { ...asset, error: 'XLSX 正文读取上限 20 MB，请拆分后导入。' };
      try {
        const spreadsheet = await readXlsx(await readFile(original));
        return { ...asset, spreadsheet, ...spreadsheetText(spreadsheet) };
      } catch (error) { return { ...asset, error: error.message }; }
    }
    if (metadataOnly || type.kind === 'binary') return asset;
    // Kept for non-UI callers of the original small-file API.
    if (info.size > 20 * 1024 * 1024) throw new Error('大文件请通过本地文件读取。');
    return { ...asset, base64: (await readFile(original)).toString('base64') };
  }
}
