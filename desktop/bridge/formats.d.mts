import type { Asset } from '../src/types';
export const MAX_FILE_BYTES: number;
export const MAX_TEXT_CHARS: number;
export const MAX_HTML_CHARS: number;
export const MAX_TEXT_BYTES: number;
export const MAX_HTML_BYTES: number;
export const FILE_LIMIT_MESSAGE: string;
export function fileKind(name: string): Pick<Asset, 'mime' | 'kind'>;
