const MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_CHARS = 20_000;
const MAX_CHARS = 100_000;
const TIMEOUT_MS = 30_000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', bull: '•', times: '×' };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

// Entities stay encoded until the final pass, so decoded text such as "a<b" is never mistaken for a tag.
const dropTags = html => html.replace(/<[^>]*>/g, '');
const stripTags = html => decodeEntities(dropTags(html));

function absolute(href, base) {
  try { return new URL(decodeEntities(href), base).href.replaceAll('&', '&amp;'); } catch { return href; }
}

function attr(tag, name) {
  return new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(2).find(value => value !== undefined);
}

// A small dependency-free HTML to Markdown pass: enough structure for a model to read a page.
export function htmlToMarkdown(html, baseUrl) {
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim();
  let body = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of ['main', 'article']) {
    const open = new RegExp(`<${tag}\\b[^>]*>`, 'i').exec(body);
    const close = body.toLowerCase().lastIndexOf(`</${tag}>`);
    if (open && close > open.index) { body = body.slice(open.index + open[0].length, close); break; }
  }
  body = body
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|head|nav|aside|form)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, code) => `\n\n\`\`\`\n${dropTags(code.replace(/<br\s*\/?>/gi, '\n')).replace(/\n+$/, '')}\n\`\`\`\n\n`)
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, text) => `\n\n${'#'.repeat(Number(level))} ${dropTags(text).replace(/\s+/g, ' ').trim()}\n\n`)
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs, text) => {
      const label = dropTags(text).replace(/\s+/g, ' ').trim();
      const href = attr(` ${attrs}`, 'href');
      if (!href || /^(javascript:|#)/i.test(href) || !label) return label;
      return `[${label}](${absolute(href, baseUrl)})`;
    })
    .replace(/<img\b[^>]*>/gi, tag => {
      const src = attr(tag, 'src');
      const alt = (attr(tag, 'alt') ?? '').trim();
      return src && alt ? `![${alt}](${absolute(src, baseUrl)})` : '';
    })
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, code) => `\`${dropTags(code)}\``)
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '_$2_')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(t[dh])\b[^>]*>/gi, ' | ')
    .replace(/<\/?(p|div|section|header|footer|ul|ol|table|tr|blockquote|dl|dt|dd|figure|figcaption|hr)\b[^>]*>/gi, '\n\n');
  const text = stripTags(body)
    .replace(/[ \t\f\v ]+/g, ' ')
    .split('\n').map(line => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

async function readLimited(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  while (true) {
    signal?.throwIfAborted();
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error(`Response is larger than ${MAX_BYTES / 1024 / 1024} MB.`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function decodeBody(bytes, contentType) {
  const declared = /charset=([^;]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder('latin1').decode(bytes.subarray(0, 4096)))?.[1];
  try { return new TextDecoder(declared?.trim().replace(/["']/g, '') || 'utf-8').decode(bytes); }
  catch { return new TextDecoder('utf-8').decode(bytes); }
}

export async function fetchPage(url, { maxChars = DEFAULT_CHARS, startIndex = 0, raw = false, signal, fetchImpl = fetch } = {}) {
  let target;
  try { target = new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('web_fetch only supports http and https URLs.');
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(target, {
    redirect: 'follow', signal: combined,
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; suo web_fetch)', accept: 'text/html,application/xhtml+xml,text/markdown,text/plain,application/json;q=0.9,*/*;q=0.5' },
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !/^(text\/|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml|javascript|ld\+json))/i.test(contentType)) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}: ${contentType} is not text.`);
  }
  const bytes = await readLimited(response, combined);
  const body = decodeBody(bytes, contentType);
  let title = '';
  let text = body;
  if (!raw && /html/i.test(contentType || body.slice(0, 200))) ({ title, text } = htmlToMarkdown(body, response.url || target.href));
  else if (!raw && /json/i.test(contentType)) { try { text = JSON.stringify(JSON.parse(body), null, 2); } catch {} }
  const limit = Math.min(Math.max(1, Number(maxChars) || DEFAULT_CHARS), MAX_CHARS);
  const start = Math.max(0, Number(startIndex) || 0);
  const slice = text.slice(start, start + limit);
  const end = start + slice.length;
  const lines = [`URL: ${response.url || target.href}`, `Status: ${response.status}${response.ok ? '' : ' (error status)'}`];
  if (title) lines.push(`Title: ${title}`);
  lines.push('', slice || '(empty)');
  if (end < text.length) lines.push('', `[Content truncated: showing characters ${start}-${end} of ${text.length}. Call web_fetch again with start_index=${end} to continue.]`);
  return { text: lines.join('\n'), finalUrl: response.url || target.href, status: response.status, total: text.length, start, end };
}
