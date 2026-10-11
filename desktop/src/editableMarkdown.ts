import { marked, Renderer } from 'marked';
import { safeSourceUrl } from './sourceLinks.ts';

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

// Application-owned documents render Markdown and safe web links, never raw HTML or remote media.
export function editableMarkdown(text: string) {
  const renderer = new Renderer();
  renderer.html = ({ text }) => escape(text);
  renderer.link = function ({ tokens, href, title }) {
    const label = this.parser.parseInline(tokens), url = safeSourceUrl(href);
    return url ? `<a href="${escape(url)}" title="${escape(title || url)}" data-source-link="true" class="nodrag nopan" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
  };
  renderer.image = ({ text }) => escape(text);
  return marked.parse(text, { renderer, async: false, breaks: true, gfm: true });
}
