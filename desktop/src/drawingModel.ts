import type { NonDeleted, ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { Card, DrawingState, Workspace } from './types';

export function visibleDrawingElements(drawing?: DrawingState): NonDeleted<ExcalidrawElement>[] {
  return (drawing?.elements ?? []).filter((element): element is NonDeleted<ExcalidrawElement> => !element.isDeleted);
}

export function withDrawingCard(workspace: Workspace, point = { x: 160, y: 90 }, force = false): Workspace {
  if (workspace.nodes.some(node => node.data.kind === 'drawing')) {
    return force && workspace.drawingCardHidden ? { ...workspace, drawingCardHidden: false } : workspace;
  }
  if (!force && (workspace.drawingCardHidden || !visibleDrawingElements(workspace.drawing).length)) return workspace;
  const card: Card = {
    id: 'drawing:' + workspace.id, type: 'card', position: point,
    style: { width: 640, height: 400 },
    data: { kind: 'drawing', title: '草图', content: '', source: 'user' },
  };
  return { ...workspace, drawingCardHidden: false, nodes: [...workspace.nodes, card] };
}
