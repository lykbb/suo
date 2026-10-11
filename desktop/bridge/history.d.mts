export function textTokens(text: string): number;
export function clipText(text: string, budget: number): string;
export function prepareHistory(input: {role: 'user'|'assistant'; text: string; demo?: boolean; error?: boolean; cancelled?: boolean}[], budget?: number): {history: {role: 'user'|'assistant'; text: string; demo?: boolean; error?: boolean; cancelled?: boolean}[]; summary: string; summarized: number};
