export function parseCsv(text: string, options?: { truncated?: boolean; maxCells?: number }): { rows: string[][]; columns: number; delimiter: string; limited: boolean };
