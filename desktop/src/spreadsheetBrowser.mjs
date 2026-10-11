import { parseXlsx } from '../bridge/spreadsheet.mjs';
// Pako already ships with Excalidraw. Keep Node's zlib out of the browser bundle.
export async function readBrowserXlsx(bytes) {
  const { Inflate } = await import('pako');
  return parseXlsx(bytes, (compressed, maxBytes) => {
    const chunks = []; let length = 0;
    const inflater = new Inflate({ raw: true, chunkSize: 32768 });
    inflater.onData = chunk => { length += chunk.length; if (length > maxBytes) throw new Error('XLSX 解压内容超出范围。'); chunks.push(chunk); };
    inflater.push(compressed, true);
    if (inflater.err || !inflater.ended) throw new Error('XLSX 压缩内容损坏。');
    const result = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  });
}
