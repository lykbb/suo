export const EDITABLE = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
type Target = { closest: (selector: string) => unknown } | null;
export function selectAllScope(target: Target, state: { home: boolean; blocked: boolean; drawingOpen: boolean; readerOpen: boolean }) {
  if (target?.closest(EDITABLE) || state.drawingOpen || target?.closest('.drawing-body')) return 'native';
  if (target?.closest('.reader-panel,.message')) return 'text';
  return state.home || state.blocked || state.readerOpen ? 'ignore' : 'cards';
}
export function clearTextSelection() { const selection = window.getSelection(); if (selection && selection.rangeCount !== 0) selection.removeAllRanges(); }

const gestures = new Set<symbol>();
const lockClass = 'suo-text-gesture';
export function textSelectionLocked() { return gestures.size > 0; }

export function syncReaderSelection(frame: HTMLIFrameElement) {
  const channel = frame.dataset.readerChannel;
  if (channel) frame.contentWindow?.postMessage({ channel, type: 'reader-selection-lock', locked: textSelectionLocked() }, '*');
}

function clearGestureSelection() {
  clearTextSelection();
  document.querySelectorAll<HTMLIFrameElement>('iframe[data-reader-channel]').forEach(frame => {
    // Sandboxed readers use the authenticated message below; same-origin readers can also be cleared directly.
    try { const selection = frame.contentWindow?.getSelection(); if (selection && selection.rangeCount !== 0) selection.removeAllRanges(); } catch { /* Opaque-origin reader. */ }
    syncReaderSelection(frame);
  });
}
function preventSelection(event: Event) { event.preventDefault(); }

// A temporary lock follows the complete canvas/panel gesture, including travel across an iframe.
// Editable fields never acquire the lock, so their ordinary selection stays native.
export function suppressTextSelection() {
  const token = Symbol();
  gestures.add(token);
  if (gestures.size === 1) {
    document.documentElement.classList.add(lockClass);
    document.addEventListener('selectstart', preventSelection, true);
    document.addEventListener('selectionchange', clearGestureSelection);
  }
  clearGestureSelection();
  return () => {
    if (!gestures.delete(token)) return;
    if (!gestures.size) {
      document.documentElement.classList.remove(lockClass);
      document.removeEventListener('selectstart', preventSelection, true);
      document.removeEventListener('selectionchange', clearGestureSelection);
    }
    clearGestureSelection();
  };
}

export function selectablePanelContent(target: Element | null) {
  if (target?.closest(`${EDITABLE},button,a,[role="button"],.drawing-body`)) return null;
  return target?.closest('.message,.thread-empty,.reader-panel .card-reader') ?? null;
}

export function clearContentSelection(region: Element) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  const intersects = region.contains(selection.anchorNode) || region.contains(selection.focusNode)
    || Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).intersectsNode(region)).some(Boolean);
  if (intersects) selection.removeAllRanges();
}
