import type { Edge, Node, Viewport } from '@xyflow/react';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

export type Spreadsheet = { sheets: { name: string; rows: string[][]; rowCount: number; columnCount: number; visibleColumns: number; formulas: Record<string, string>; limited: boolean }[]; sheetCount: number; limited: boolean; limits: { rows: number; columns: number; cells: number; chars: number }; note?: string };
export type Asset = { id: string; name: string; size: number; mime: string; kind: 'text' | 'html' | 'image' | 'pdf' | 'word' | 'spreadsheet' | 'video' | 'audio' | 'binary'; truncated?: boolean; preview?: string; text?: string; spreadsheet?: Spreadsheet; base64?: string; sourceUrl?: string; error?: string };
export type CardData = { title: string; content: string; kind: 'note' | 'document' | 'file' | 'group' | 'drawing'; asset?: Asset; source?: 'user' | 'demo' | 'ai'; replyId?: string; color?: string; tags?: string[]; pinned?: boolean; layerOrder?: number; [key: string]: unknown };
export type Card = Node<CardData>;
export type PanelName = 'composer' | 'thread' | 'toolbar' | 'reader' | 'drawing';
export type Rect = { x: number; y: number; width: number; height: number };
export type PanelLayers = Partial<Record<PanelName, { pinned: boolean; order: number }>>;
export type DrawingState = { elements: readonly ExcalidrawElement[]; appState: Partial<AppState>; files: BinaryFiles };
export type Panels = Partial<Record<PanelName, Rect>>;
export type ToolStep = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string; refs?: string[] };
// A question Suo asked with options to click; `answered` is the option the user chose.
export type Ask = { question: string; options: { label: string; description?: string }[]; answered?: string };
export type OperationReceipt = { operationId: string; logicalRequestId: string; kind: string; input: Record<string, unknown>; inputHash: string; result: Record<string, unknown>; nodeStates?: Record<string, string | null>; edgeStates?: Record<string, string | null> };
export type BoardTask = { mode: 'classify'; allowRegroup: boolean };
export type Message = { id: string; role: 'user' | 'assistant'; text: string; demo?: boolean; cancelled?: boolean; error?: string; incomplete?: boolean; stopReason?: string; retryConflict?: boolean; saveUnconfirmed?: boolean; cardIds?: string[]; contextNote?: string; steps?: ToolStep[]; ask?: Ask; logicalRequestId?: string; retryOf?: string; operationReceipts?: OperationReceipt[]; boardTask?: BoardTask };
export type ModelChoice = { provider: string; id: string; name: string; contextWindow?: number; maxTokens?: number; supportsImages?: boolean };
export type ModelDraft = { id: string; provider?: string; editModelId?: string; modelId: string; baseUrl: string; api: string; network: 'default' | 'funnel-public'; warning: string; hasKey: boolean; supportsImages?: boolean };
export type ModelCatalog = { models: ModelChoice[]; mode: 'ready' | 'unconfigured'; warning?: string; selected?: { provider: string; id: string }; connections?: { provider: string; baseUrl: string; api: string; network: 'default' | 'funnel-public' }[]; drafts?: ModelDraft[] };
export type Workspace = { id: string; title: string; titleCustomized?: boolean; pinned?: boolean; deletedAt?: string; version: number; updatedAt: string; saveReceipt?: { id: string; baseVersion: number }; nodes: Card[]; edges: Edge[]; messages: Message[]; draft: string; draftAttachments?: Asset[]; model?: Pick<ModelChoice, 'provider' | 'id'>; panels: Panels; panelLayers?: PanelLayers; drawing?: DrawingState; drawingCardHidden?: boolean; viewport: Viewport };
export type WorkspaceSummary = Pick<Workspace, 'id' | 'title' | 'version' | 'updatedAt' | 'pinned' | 'deletedAt'>;
export type BridgeEvent = { event: string; data: { runId?: string; workspaceId?: string; delta?: string; cancelled?: boolean; error?: string; message?: string; restarting?: boolean; cards?: CardData[]; contextNote?: string; boardTouched?: boolean;
  requestId?: string; logicalRequestId?: string; operationId?: string; incomplete?: boolean; stopReason?: string; retryConflict?: boolean; saveUnconfirmed?: boolean; kind?: string; payload?: Record<string, unknown>; id?: string; label?: string; status?: ToolStep['status']; detail?: string; refs?: string[] } };
