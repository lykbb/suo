import { safeSourceUrl } from './sourceLinks.ts';

const markdownStyle = `body{font:14px/1.8 -apple-system,'PingFang SC',sans-serif;margin:0;padding:12px;color:#29251f;overflow-wrap:anywhere}h1{font-size:22px}h2{font-size:18px}h3{font-size:16px}p{margin:0 0 12px}pre{overflow:auto;background:#f5f5f3;padding:10px;border-radius:6px;white-space:pre-wrap}code{font:13px/1.7 ui-monospace,monospace}table{border-collapse:collapse;max-width:100%;font-size:13px}td,th{padding:6px 8px;border:1px solid #e4ddd3}blockquote{margin:12px 0;padding-left:12px;border-left:2px solid #d3c9bc;color:#716759}a{color:inherit}`;
const embeddedImage = /^data:image\/(?:png|jpeg|jpg|gif|webp|avif|svg\+xml)[;,]/i;
// A script-free, opaque-origin iframe retains head styles and body/html attributes.
export function safeHtml(text: string, markdown = false, bridge?: { channel: string; scriptUrl: string; compact?: boolean }) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const sources = new Map([...doc.querySelectorAll('a')].map(node => [node, safeSourceUrl(node.getAttribute('href'))]));
  doc.querySelectorAll('script,iframe,object,embed,base,link').forEach(node => node.remove());
  doc.querySelectorAll('meta').forEach(node => {
    if (node.hasAttribute('http-equiv') || node.hasAttribute('charset')) node.remove();
  });
  doc.querySelectorAll('*').forEach(node => [...node.attributes].forEach(attribute => {
    const name = attribute.name.toLowerCase(), value = attribute.value.trim();
    if (name.startsWith('on') || ['srcdoc','action','formaction','target','download','ping','autofocus','data-source-url'].includes(name)
      || (['src','srcset','poster','href','xlink:href'].includes(name) && !(name !== 'srcset' && (embeddedImage.test(value) || (['href','xlink:href'].includes(name) && value.startsWith('#')))))) node.removeAttribute(attribute.name);
  }));
  // Links remain inert inside the sandbox; only the parent may open their verified web URL.
  doc.querySelectorAll('a').forEach(node => {
    const url = sources.get(node);
    if (url) { node.setAttribute('data-source-url', url); node.setAttribute('href', '#'); if (!node.hasAttribute('title')) node.setAttribute('title', url); }
    else if (!node.getAttribute('href')?.startsWith('#')) node.removeAttribute('href');
  });
  const trusted = bridge && /^[a-f0-9-]{36}$/.test(bridge.channel) && new URL(bridge.scriptUrl).origin === window.location.origin && new URL(bridge.scriptUrl).pathname === '/reader-events.js' ? bridge : undefined;
  const scriptPolicy = trusted ? "'nonce-" + trusted.channel + "'" : "'none'";
  const csp = doc.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = "default-src 'none'; script-src " + scriptPolicy + "; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";
  const charset = doc.createElement('meta'); charset.setAttribute('charset', 'UTF-8');
  doc.head.prepend(charset, csp);
  if (markdown) { const style = doc.createElement('style'); style.textContent = markdownStyle; doc.head.append(style); }
  if (trusted) {
    const script = doc.createElement('script'); script.src = trusted.scriptUrl; script.setAttribute('nonce', trusted.channel); script.dataset.channel = trusted.channel; script.dataset.mode = trusted.compact ? 'compact' : 'reader';
    doc.body.append(script);
  }
  return '<!doctype html>' + doc.documentElement.outerHTML;
}

