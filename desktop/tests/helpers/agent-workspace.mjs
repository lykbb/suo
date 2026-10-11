import { readFile } from 'node:fs/promises';
import { randomUUID, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { freeSpot, nodeBoxes, ungroupCards } from '../../src/geometry.ts';
import { arrangeBoardNodes, classifyBoardNodes } from '../../src/boardLayout.ts';
import { CARD_COLORS, metadataPatch, readCardTags } from '../../src/cardMetadata.ts';

const source = await readFile(new URL('../../src/agentTools.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('agentTools.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const code = ts.transpileModule(syntax.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(syntax)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

export function agentWorkspace(workspace) {
  let state = { workspace: structuredClone(workspace), editor: null };
  const records = [], commits = [], recordOptions = [], frames = [];
  const context = {
    exports: {}, crypto: { randomUUID, subtle: webcrypto.subtle }, TextEncoder, Uint8Array, AbortSignal,
    app: { get: () => state, set: patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; } },
    update: change => { state = { ...state, workspace: change(state.workspace) }; commits.push(structuredClone(state.workspace)); },
    record: options => { records.push(structuredClone(state.workspace)); recordOptions.push(options); }, frameBoard: () => frames.push(structuredClone(state.workspace)), animateIn: () => {}, reveal: () => {}, center: () => ({ x: 0, y: 0 }),
    newCard: (data, x, y) => ({ id: randomUUID(), type: 'card', position: { x, y }, style: { width: 258 }, data: { title: '新便签', content: '', kind: 'note', source: 'user', ...data } }),
    freeSpot, nodeBoxes, ungroupCards, arrangeBoardNodes, classifyBoardNodes, CARD_COLORS, metadataPatch, readCardTags,
    readMaterial: async () => ({}), searchMaterials: async () => ({ hits: [] }),
  };
  vm.runInNewContext(code, context);
  return { ...context.exports, records, commits, recordOptions, frames, get: () => state.workspace,
    patch: change => { state = { ...state, workspace: change(state.workspace) }; },
    reload: workspace => { state = { ...state, workspace: structuredClone(workspace) }; },
  };
}

export const note = (id = randomUUID(), extra = {}) => ({ id, type: 'card', position: { x: 0, y: 0 }, style: { width: 258, height: 174 }, data: { kind: 'note', title: '便签', content: '原文', source: 'user' }, ...extra });
export const requestWorkspace = (logicalRequestId, nodes = []) => ({ id: randomUUID(), nodes, edges: [], messages: [
  { id: randomUUID(), role: 'user', logicalRequestId, text: '请新建卡片并整理画布。' },
  { id: 'attempt-one', role: 'assistant', logicalRequestId, text: '保留这段已输出文字。' },
] });
