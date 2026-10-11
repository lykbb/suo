export async function extractPdfText(pdf, { signal, maxPages = 200, maxChars = 20000 } = {}) {
  let text = '', pages = 0, truncated = pdf.numPages > maxPages;
  for (let number = 1; number <= Math.min(pdf.numPages, maxPages); number++) {
    signal?.throwIfAborted();
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    signal?.throwIfAborted();
    const body = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
    pages = number;
    if (body) text += `\n[第 ${number} 页]\n${body}\n`;
    page.cleanup?.();
    if (text.length >= maxChars) { text = text.slice(0, maxChars); truncated = true; break; }
  }
  if (!text.trim()) throw new Error('这份 PDF 没有可提取的文字，可能是扫描件。请提供文字版或将需要分析的页面作为图片导入。');
  return { text: text.trim(), pages, truncated };
}
