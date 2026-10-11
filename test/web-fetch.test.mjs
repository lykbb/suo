import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchPage, htmlToMarkdown } from '../extensions/web-fetch.js';

// The page reader bundled into the App for Suo's web_fetch tool.
test('pages become readable text: HTML as Markdown, pretty JSON, paged long text, GBK, no binaries', async t => {
  const long = 'x'.repeat(50);
  const server = createServer((req, res) => {
    if (req.url === '/page') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<html><head><title>标题 &amp; 测试</title><script>bad()</script></head><body><nav>菜单</nav><main><h2>小节</h2><p>正文 <a href="/next">下一页</a> <code>x&lt;y</code></p><ul><li>一</li><li>二</li></ul><pre>line1\nline2</pre></main></body></html>`); return; }
    if (req.url === '/json') { res.setHeader('content-type', 'application/json'); res.end('{"a":[1,2]}'); return; }
    if (req.url === '/long') { res.setHeader('content-type', 'text/plain'); res.end(long); return; }
    if (req.url === '/gbk') { res.setHeader('content-type', 'text/plain; charset=gbk'); res.end(Buffer.from([0xc4, 0xe3, 0xba, 0xc3])); return; }
    if (req.url === '/redirect') { res.statusCode = 302; res.setHeader('location', '/json'); res.end(); return; }
    res.setHeader('content-type', 'image/png'); res.end(Buffer.alloc(10));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = (await fetchPage(`${base}/page`)).text;
  assert.match(page, /Title: 标题 & 测试/);
  assert.match(page, /## 小节/);
  assert.match(page, new RegExp(`\\[下一页\\]\\(${base}/next\\)`));
  assert.match(page, /`x<y`/);
  assert.match(page, /- 一\n- 二/);
  assert.match(page, /```\nline1\nline2\n```/);
  assert.doesNotMatch(page, /bad\(\)|菜单/);
  assert.match((await fetchPage(`${base}/json`)).text, /"a": \[\n\s+1,/);
  assert.match((await fetchPage(`${base}/long`, { maxChars: 20 })).text, /start_index=20/);
  assert.equal((await fetchPage(`${base}/long`, { maxChars: 100, startIndex: 40 })).end, 50);
  assert.match((await fetchPage(`${base}/gbk`)).text, /你好/);
  assert.match((await fetchPage(`${base}/redirect`)).text, new RegExp(`URL: ${base}/json`));
  await assert.rejects(fetchPage(`${base}/image`), /image\/png is not text/);
  await assert.rejects(fetchPage('file:///etc/hosts'), /only supports http/);
  assert.equal(htmlToMarkdown('<p>a&nbsp;&#x4e2d;&#25991;</p>').text, 'a 中文');
});
