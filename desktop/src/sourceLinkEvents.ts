import type { MouseEvent, PointerEvent } from 'react';
import { openExternal } from './bridge';
import { safeSourceUrl } from './sourceLinks.ts';
import { app } from './state';

const presses = new WeakMap<HTMLAnchorElement, { x: number; y: number }>();

export function sourceAnchor(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLAnchorElement>('a[data-source-link]') : null;
}

// Link gestures stay inside the reader; dragging elsewhere still belongs to the canvas.
export function sourcePointerDown(event: PointerEvent<HTMLElement>) {
  const anchor = sourceAnchor(event.target);
  if (anchor) { presses.set(anchor, { x: event.clientX, y: event.clientY }); event.stopPropagation(); }
}
export function sourceDoubleClick(event: MouseEvent<HTMLElement>) {
  if (!sourceAnchor(event.target)) return false;
  event.preventDefault(); event.stopPropagation();
  return true;
}
export function sourceClick(event: MouseEvent<HTMLElement>) {
  const anchor = sourceAnchor(event.target);
  if (!anchor) return;
  event.preventDefault(); event.stopPropagation();
  const url = safeSourceUrl(anchor.getAttribute('href'));
  const press = presses.get(anchor); presses.delete(anchor);
  const dragged = press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 3;
  // A dragged text selection and the second click of a double click never launch a page.
  if (!url || event.detail > 1 || (event.detail > 0 && (dragged || window.getSelection()?.toString()))) return;
  void openExternal(url).catch(error => app.set({ toast: error instanceof Error ? error.message : '来源页面未能打开，请重试。' }));
}
