import { inflateRawSync } from 'node:zlib';
import { parseXlsx } from './spreadsheet.mjs';
export function readXlsx(bytes) {
  return parseXlsx(bytes, (compressed, maxBytes) => inflateRawSync(compressed, { maxOutputLength: Math.max(1, maxBytes) }));
}
