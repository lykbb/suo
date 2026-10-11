export function assertSaveRequest(requestId: unknown, expectedVersion: unknown): void;
export function savedContent(state: object): string;
export function committedReplay(current: unknown, requested: object, expectedVersion: unknown, requestId: unknown): boolean;
export function committedState<T extends object>(state: T, version: number, requestId: unknown, baseVersion: unknown): T;
export function workspaceAssetIds(state: { nodes?: { data?: { asset?: { id: string } } }[]; draftAttachments?: { id: string }[] }): string[];
