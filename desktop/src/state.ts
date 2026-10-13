import { createStore } from './store';
import type { Guide } from './alignment';
import type { Asset, Workspace, WorkspaceSummary } from './types';

export type Menu = { x: number; y: number; point: { x: number; y: number } };
export type Editor = { id: string; title: string; content: string };
export type Popup = '' | 'sessions' | 'skills' | 'help';
export type Presence = { key: string; x: number; y: number; label: string };
export type SaveStatus = '已保存' | '未保存' | '保存中…' | '保存失败';

export type AppState = {
  workspace: Workspace | null;
  sessions: WorkspaceSummary[];
  stage: { width: number; height: number };
  saveStatus: SaveStatus;
  busy: boolean;
  sessionManaging: boolean;
  toast: string;
  popup: Popup;
  menu: Menu | null;
  editor: Editor | null;
  preview: Asset | null;
  sketchPreview: boolean;
  settingsTab: 'appearance' | 'models' | 'input' | 'about';
  threadOpen: boolean;
  drawingOpen: boolean;
  tool: 'select' | 'pan';
  dragOver: boolean;
  historyVersion: number;
  presence: Presence | null;
  // Alignment lines shown while a card is dragged, in board coordinates.
  guides: Guide[];
  // The connection whose relation is being written, and where to show the box.
  edgeEditor: { id: string; x: number; y: number } | null;
  // Hydrated view of workspace.draftAttachments; they become cards with the first message.
  attachments: Asset[];
};

export const app = createStore<AppState>({
  workspace: null, sessions: [], stage: typeof window === 'undefined' ? { width: 1300, height: 800 } : { width: window.innerWidth, height: window.innerHeight - 52 }, saveStatus: '已保存', busy: false, sessionManaging: false, toast: '',
  popup: '', menu: null, editor: null, preview: null, sketchPreview: false, settingsTab: 'appearance', threadOpen: true, drawingOpen: false, tool: 'select',
  dragOver: false, historyVersion: 0, presence: null, guides: [], edgeEditor: null, attachments: [],
});

export const hasContentOf = (state: AppState) => !!state.workspace && (state.workspace.nodes.length > 0 || state.workspace.messages.length > 0);
export const hasThreadOf = (state: AppState) => hasContentOf(state) && state.threadOpen;
// The first-run home page: a loaded session with nothing on the board and no conversation yet.
export const isWelcomeOf = (state: AppState) => !!state.workspace && !hasContentOf(state);
