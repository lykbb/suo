import { drainNodeChanges, frameBoard, notice, record, update } from './actions';
import { arrangeBoardNodes } from './boardLayout';
import { app } from './state';

export function arrangeCurrentBoard() {
  if (app.get().busy || app.get().sessionManaging) return false;
  drainNodeChanges();
  const workspace = app.get().workspace;
  if (!workspace) return false;
  try {
    const nodes = arrangeBoardNodes(workspace.nodes);
    if (nodes === workspace.nodes) { notice('画布已经排齐。'); return true; }
    record({ includeViewport: true });
    update(state => ({ ...state, nodes }));
    frameBoard();
    notice('已整齐排列，可用 ⌘Z 整体撤销。');
    return true;
  } catch (error) { notice(error instanceof Error ? error.message : '未能完成排列，画布保持原样。'); return false; }
}
