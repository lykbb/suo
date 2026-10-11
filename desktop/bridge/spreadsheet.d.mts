import type { Spreadsheet } from '../src/types';
export const SPREADSHEET_LIMITS: Readonly<{ bytes: number; expandedBytes: number; entryBytes: number; entries: number; sheets: number; rows: number; columns: number; cells: number; chars: number }>;
export const XLS_MESSAGE: string;
export function zipCrc32(bytes: Uint8Array): number;
export function columnLabel(index: number): string;
export function parseXlsx(bytes: Uint8Array | ArrayBuffer, inflate: (bytes: Uint8Array, maxBytes: number) => Uint8Array | Promise<Uint8Array>): Promise<Spreadsheet>;
export function spreadsheetText(book: Spreadsheet): { text: string; truncated: boolean };
