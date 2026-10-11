export function redactErrorDetails(value: unknown): string;
export function presentMessageError(value: unknown): { kind: string; title: string; reason: string; details: string };
export function hideSystemRecord(text?: string): string;
export function messageDisplayText(message?: { text?: string; error?: string }): string;
