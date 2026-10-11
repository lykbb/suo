import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';

export function supportsPublicRoute(baseUrl) {
  try { const url = new URL(baseUrl); return url.protocol === 'https:' && /^[a-z0-9-]+\.[a-z0-9.-]+\.ts\.net$/iu.test(url.hostname) && ['', '443', '8443', '10000'].includes(url.port); } catch { return false; }
}
const cached = new Map();
function publicIPv4(ip) {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return ![0, 10, 127].includes(a) && !(a === 169 && b === 254) && !(a === 192 && b === 168) && !(a === 172 && b >= 16 && b <= 31) && !(a === 100 && b >= 64 && b <= 127) && a < 224;
}
export async function publicAddresses(hostname, signal, fetchImpl = globalThis.fetch) {
  const previous = cached.get(hostname);
  if (previous && previous.expires > Date.now()) return previous.addresses;
  const response = await fetchImpl('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(hostname) + '&type=A', { headers: { Accept: 'application/dns-json' }, signal });
  if (!response.ok) throw new Error('公网地址解析失败，请稍后重试。');
  const data = await response.json();
  const answers = (data.Answer ?? []).filter(item => item.type === 1 && publicIPv4(item.data));
  if (!answers.length) throw new Error('未找到公网入口，请检查是否已开启 Tailscale Funnel。');
  const addresses = [...new Set(answers.map(item => item.data))];
  cached.set(hostname, { addresses, expires: Date.now() + Math.min(300, ...answers.map(item => Math.max(1, Number(item.TTL) || 30))) * 1000 });
  return addresses;
}

// Resolve only the chosen Funnel endpoint via public DNS. TLS still verifies the original hostname.
// There are no redirects or automatic POST retries; aborts also stop the response stream.
export function createConnectionFetch(connection, { fetchImpl = globalThis.fetch, resolve = publicAddresses, requestImpl = httpsRequest } = {}) {
  if (connection.network !== 'funnel-public') return fetchImpl;
  if (!supportsPublicRoute(connection.baseUrl)) throw new Error('公网连接仅支持 HTTPS 的 Tailscale Funnel 地址。');
  const endpoint = new URL(connection.baseUrl);
  return async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.origin !== endpoint.origin) throw new Error('模型请求地址与连接配置不一致。');
    const addresses = await resolve(url.hostname, request.signal, fetchImpl);
    if (request.signal.aborted) throw request.signal.reason;
    const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
    if (body && body.length > 1024 * 1024) throw new Error('模型请求内容过大。');
    const headers = Object.fromEntries(request.headers);
    if (body) headers['content-length'] = String(body.length);
    return new Promise((accept, reject) => {
      const outgoing = requestImpl(url, {
        method: request.method, headers, signal: request.signal, servername: url.hostname,
        agent: false, rejectUnauthorized: true,
        lookup: (_hostname, options, callback) => options?.all
          ? callback(null, [{ address: addresses[0], family: 4 }])
          : callback(null, addresses[0], 4),
      }, incoming => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : String(value));
        const status = incoming.statusCode ?? 502;
        const empty = request.method === 'HEAD' || [204, 205, 304].includes(status);
        if (empty) incoming.resume();
        const decoder = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress }[incoming.headers['content-encoding']];
        const content = !empty && decoder ? incoming.pipe(decoder()) : incoming;
        if (decoder) { responseHeaders.delete('content-encoding'); responseHeaders.delete('content-length'); }
        incoming.on('error', error => content.destroy(error));
        accept(new Response(empty ? null : Readable.toWeb(content), { status, headers: responseHeaders }));
      });
      outgoing.on('error', reject);
      outgoing.end(body);
    });
  };
}
