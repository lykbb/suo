import type { CSSProperties } from 'react';
import type { CardData } from './types';

export const MAX_CARD_TAGS = 8;
export const MAX_TAG_LENGTH = 32;
export const CARD_COLORS = [
  { name: '默认', value: '' }, { name: '浅灰', value: '#f3f4f6' },
  { name: '浅黄', value: '#fef3c7' }, { name: '浅绿', value: '#dcfce7' },
  { name: '浅蓝', value: '#dbeafe' }, { name: '浅紫', value: '#ede9fe' },
  { name: '浅粉', value: '#fce7f3' }, { name: '浅橙', value: '#ffedd5' },
] as const;
export type MetadataChange = { color?: string | null; tags?: string[] };

export function normalizeCardColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const color = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/u.test(color)) return color;
  if (/^#[0-9a-f]{3}$/u.test(color)) return '#' + [...color.slice(1)].map(char => char + char).join('');
  return undefined;
}
export function readCardTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [], seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const tag = item.trim().replace(/\s+/gu, ' '), key = tag.toLocaleLowerCase();
    if (!tag || tag.length > MAX_TAG_LENGTH || seen.has(key)) continue;
    seen.add(key); tags.push(tag);
    if (tags.length === MAX_CARD_TAGS) break;
  }
  return tags;
}
export function metadataPatch(data: CardData, change: MetadataChange): Partial<CardData> {
  const patch: Partial<CardData> = {};
  if ('color' in change) {
    const reset = change.color == null || (typeof change.color === 'string' && change.color.trim() === '');
    const color = reset ? undefined : normalizeCardColor(change.color);
    if (!reset && !color) throw new Error('请输入有效颜色，例如 #DBEAFE。');
    if (data.color !== color) patch.color = color;
  }
  if ('tags' in change) {
    if (!Array.isArray(change.tags) || change.tags.some(tag => typeof tag !== 'string')) throw new Error('标签格式无效。');
    if (change.tags.some(tag => tag.trim().replace(/\s+/gu, ' ').length > MAX_TAG_LENGTH)) throw new Error('每个标签最多 32 个字符。');
    const normalized = readCardTags(change.tags);
    const unique = new Set(change.tags.map(tag => tag.trim().replace(/\s+/gu, ' ').toLocaleLowerCase()).filter(Boolean));
    if (unique.size > MAX_CARD_TAGS) throw new Error('每张卡片最多 8 个标签。');
    if (JSON.stringify(readCardTags(data.tags)) !== JSON.stringify(normalized)) patch.tags = normalized;
  }
  return patch;
}
export function colorInk(color: string): '#000000' | '#ffffff' {
  const normalized = normalizeCardColor(color);
  if (!normalized) return '#000000';
  const rgb = [1, 3, 5].map(index => {
    const value = parseInt(normalized.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}
// Deep versions of the preset colors for the dark theme; other colors are mixed toward the dark card.
const DARK_FILLS: Record<string, string> = {
  '#f3f4f6': '#2a2c31', '#fef3c7': '#3f3514', '#dcfce7': '#183a26', '#dbeafe': '#1b3354',
  '#ede9fe': '#2f2a55', '#fce7f3': '#4a2038', '#ffedd5': '#47301a',
};
// Only the chosen color goes inline; CardAppearance.css derives the card's surfaces and text from it
// for the current theme.
export function cardMetadataStyle(color: unknown): CSSProperties | undefined {
  const fill = normalizeCardColor(color);
  if (!fill) return undefined;
  return { '--card-base': fill, '--card-base-ink': colorInk(fill), '--card-dark': DARK_FILLS[fill] ?? `color-mix(in srgb, ${fill} 30%, #1b1b1b)` } as CSSProperties;
}
