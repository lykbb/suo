export function textTokens(text) {
  const wide = (text.match(/[\u2e80-\uffff]/gu) ?? []).length;
  return Math.ceil(wide * 2 + (text.length - wide) / 3);
}
export function clipText(text, budget) {
  if (textTokens(text) <= budget) return text;
  let low = 0, high = text.length;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (textTokens(text.slice(0, middle)) <= budget) low = middle; else high = middle - 1; }
  return text.slice(0, low);
}
export function prepareHistory(input, budget = 20000) {
  let shortened = 0;
  const valid = input.filter(item => !item.demo && !item.error && !item.cancelled && item.text && ['user', 'assistant'].includes(item.role)).map(item => {
    if (item.text.length <= 20000) return item;
    shortened++;
    const marker = '\n[这条历史消息中间有省略]\n', side = Math.floor((20000 - marker.length) / 2);
    return { ...item, text: item.text.slice(0, side) + marker + item.text.slice(-side) };
  });
  if (valid.reduce((sum, item) => sum + textTokens(item.text) + 8, 0) <= budget) return { history: valid, summary: '', summarized: shortened };
  const recentBudget = Math.floor(budget * 0.65);
  let left = recentBudget, split = valid.length;
  const recent = []; let clipped = 0;
  for (let index = valid.length - 1; index >= 0; index--) {
    const item = valid[index], tokens = textTokens(item.text) + 8;
    if (left < 80) break;
    if (tokens > left) {
      const allowance = Math.max(0, Math.floor(left * (index > 0 ? 0.65 : 1)) - 8);
      const marker = '\n[这条历史消息中间有省略]\n';
      const contentBudget = Math.max(0, allowance - textTokens(marker));
      const head = clipText(item.text, Math.floor(contentBudget / 2));
      const tail = clipText([...item.text].reverse().join(''), Math.max(0, contentBudget - textTokens(head)));
      const text = head + marker + [...tail].reverse().join('');
      recent.unshift({ ...item, text }); left -= textTokens(text) + 8; split = index; clipped++;
    } else { recent.unshift(item); left -= tokens; split = index; }
  }
  const older = valid.slice(0, split), excerpts = [];
  // Quote early context and later constraints; never label an assistant suggestion as a decision.
  for (let index = 0; index < older.length; index++) {
    const item = older[index];
    const lines = item.text.split('\n').filter(line => /目标|用户|预算|约束|必须|不要|决定|确认|版本|截止|风险|验证|结论/u.test(line));
    const quote = [item.text.slice(0, item.role === 'user' ? 240 : 100), ...lines.slice(0, 4).map(line => line.slice(0, 320))].filter(Boolean).join(' / ');
    excerpts.push(`[第 ${index + 1} 条，${item.role === 'user' ? '用户原话' : 'Suo 建议'}] ${quote}`);
  }
  const summaryBudget = Math.max(0, budget - (recentBudget - left));
  const head = '历史摘记（从较早消息原文提取，包含省略；建议不等于已确认决定）：\n';
  const available = Math.max(0, summaryBudget - textTokens(head) - 20);
  // Keep both initial goals and later changes when the excerpt itself must be shortened.
  let body = excerpts.join('\n');
  if (textTokens(body) > available) {
    const early = clipText(body, Math.floor(available / 2));
    const reversed = [...excerpts].reverse().join('\n');
    body = early + '\n[中间细节省略，后续变化按从新到旧排列]\n' + clipText(reversed, Math.max(0, available - textTokens(early) - 60));
  }
  return { history: recent, summary: clipText(head + body, summaryBudget), summarized: Math.min(valid.length, older.length + clipped + shortened) };
}
