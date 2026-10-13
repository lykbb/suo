import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { JsonLines } from './rpc.mjs';

const METHODS = new Set(['models.list', 'models.configure', 'models.check', 'models.discover', 'prompt.send', 'prompt.abort', 'ui.reply', 'skills.list', 'skills.get', 'skills.parse', 'skills.save', 'templates.list', 'templates.get', 'templates.save']);
export function devApi() {
  const token = randomBytes(32).toString('hex');
  const equalToken = value => typeof value === 'string' && value.length === token.length && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  return {
    name: 'suo-local-chat', apply: 'serve',
    transformIndexHtml() { return [{ tag: 'meta', attrs: { name: 'suo-local-api', content: token }, injectTo: 'head' }]; },
    configureServer(server) {
      const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
      const engine = process.env.SUO_DESKTOP_ENGINE ?? resolve(realpathSync(resolve(desktop, 'node_modules')), '..', '..');
      const child = spawn(process.execPath, [resolve(desktop, 'bridge/host.mjs')], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, SUO_DESKTOP_ENGINE: engine, SUO_DESKTOP_DATA: process.env.SUO_DESKTOP_DATA ?? resolve(desktop, 'data'), PI_OFFLINE: '1', DO_NOT_TRACK: '1' },
      });
      const clients = new Set(), pending = new Map();
      let closed = false;
      const publish = event => { for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`); };
      const parser = new JsonLines(record => {
        if (record.event) publish(record);
        else if (record.id && pending.has(record.id)) {
          const job = pending.get(record.id); pending.delete(record.id); clearTimeout(job.timer);
          record.error ? job.reject(new Error(record.error)) : job.resolve(record.result);
        }
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', data => { try { parser.push(data); } catch { fail(); } });
      child.stderr.on('data', () => {});
      child.stdin.on('error', fail); child.on('error', fail); child.on('exit', fail);
      function fail() {
        if (closed) return;
        closed = true;
        publish({ event: 'bridge-error', data: { message: '本地模型连接中断，请刷新页面。' } });
        for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('本地模型连接中断。')); }
        pending.clear();
        for (const client of clients) client.end();
        clients.clear();
        child.kill('SIGTERM');
      }
      function call(method, payload) {
        if (closed) return Promise.reject(new Error('本地模型连接中断。'));
        const id = randomUUID();
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { pending.delete(id); reject(new Error('本地模型连接超时。')); }, 30000);
          pending.set(id, { resolve, reject, timer });
          child.stdin.write(JSON.stringify({ id, method, payload }) + '\n');
        });
      }
      server.httpServer?.once('close', () => { child.stdin.end(); fail(); });
      server.middlewares.use('/__suo', async (req, res) => {
        // Loopback only, under either name: the page may be opened as 127.0.0.1 or localhost.
        const port = server.httpServer?.address()?.port;
        const host = req.headers.host, origin = `http://${host}`;
        if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { res.writeHead(403).end(); return; }
        const url = new URL(req.url, origin);
        const supplied = req.method === 'GET' ? url.searchParams.get('token') : req.headers['x-suo-token'];
        if (!equalToken(supplied) || (req.headers.origin && req.headers.origin !== origin)) { res.writeHead(403).end(); return; }
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'GET' && url.pathname === '/events') {
          if (closed || clients.size >= 4) { res.writeHead(503).end(); return; }
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
          res.write(': connected\n\n'); clients.add(res);
          const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
          req.once('close', () => { clearInterval(heartbeat); clients.delete(res); });
          return;
        }
        if (req.method !== 'POST' || url.pathname !== '/request' || req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(403).end(); return; }
        let bytes = 0;
        const chunks = [];
        try {
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > 12 * 1024 * 1024) { res.writeHead(413).end(); return; }
            chunks.push(chunk);
          }
          const record = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!METHODS.has(record.method)) { res.writeHead(403).end(); return; }
          const result = await call(record.method, record.payload ?? {});
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ result }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error instanceof SyntaxError ? '消息格式无效。' : error.message }));
        }
      });
    },
  };
}
