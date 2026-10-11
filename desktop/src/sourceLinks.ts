export type SourceLink = { title: string; url: string };

// Only web pages may leave the document renderer. Never resolve relative or executable URLs.
export function safeSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const text = value.trim();
  if (!text || /[\u0000-\u0020\u007f]/u.test(text)) return;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return;
    return url.href;
  } catch { return; }
}

export function sourceLinks(steps: { refs?: string[] }[] = []): SourceLink[] {
  const result: SourceLink[] = [], seen = new Set<string>();
  for (const ref of steps.flatMap(step => step.refs ?? [])) {
    if (typeof ref !== 'string') continue;
    const cleaned = ref.trim(), match = cleaned.match(/(?:^|\s)(https?:\/\/\S+)$/iu);
    const url = safeSourceUrl(match?.[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = cleaned.slice(0, match!.index).trim() || new URL(url).hostname;
    result.push({ title, url });
  }
  return result;
}

// Keep the reply intact when copying it or placing it on the board; append only missing sources.
export function replyWithSources(text: string, steps?: { refs?: string[] }[]) {
  const sources = sourceLinks(steps).filter(source => !text.includes(source.url));
  if (!sources.length) return text;
  const title = (value: string) => value.replace(/([\\`*_[\]<>])/gu, '\\$1').replace(/[\r\n]+/gu, ' ');
  return `${text}\n\n来源：\n${sources.map(source => `- [${title(source.title)}](<${source.url}>)`).join('\n')}`;
}
