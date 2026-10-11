export type ReaderActivation = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean };
export type ReaderMessage = { channel: string; type: 'reader-activate'; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }
  | { channel: string; type: 'reader-external-link'; url: string }
  | { channel: string; type: 'reader-zoom'; x: number; y: number; delta: number; deltaMode: number };
export type ReaderCommand = { channel: string; type: 'reader-open' | 'reader-close' | 'reader-select-all' };

export function validReaderMessage(data: unknown, channel: string): data is ReaderMessage | ReaderCommand {
  if (!data || typeof data !== 'object') return false;
  const value = data as Record<string, unknown>;
  if (value.channel !== channel) return false;
  if (value.type === 'reader-external-link') return !!safeSourceUrl(value.url);
  if (value.type === 'reader-open' || value.type === 'reader-close' || value.type === 'reader-select-all') return true;
  if (value.type === 'reader-activate') return ['shiftKey', 'metaKey', 'ctrlKey'].every(key => typeof value[key] === 'boolean');
  return value.type === 'reader-zoom' && ['x', 'y', 'delta'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && Math.abs(value[key] as number) <= 100000)
    && [0, 1, 2].includes(value.deltaMode as number);
}

export function wheelPixels(delta: number, mode: number, page = 800) {
  return Math.max(-200, Math.min(200, delta * (mode === 1 ? 16 : mode === 2 ? page : 1)));
}
import { safeSourceUrl } from './sourceLinks.ts';

