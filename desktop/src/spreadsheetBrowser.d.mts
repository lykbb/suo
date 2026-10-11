import type { Spreadsheet } from './types';
export function readBrowserXlsx(bytes: ArrayBuffer | Uint8Array): Promise<Spreadsheet>;
