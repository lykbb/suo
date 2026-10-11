import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {keepsNativeMenu,selectAllScope} from '../src/selection.ts';
const state={home:false,blocked:false,drawingOpen:false,readerOpen:false};
const target=kind=>({closest:selector=>selector.includes(kind)?{}:null});
test('canvas owns select all; home and menus prevent whole-page selection',()=>{
 assert.equal(selectAllScope(null,state),'cards');
 for(const patch of [{home:true},{blocked:true},{readerOpen:true}])assert.equal(selectAllScope(null,{...state,...patch}),'ignore');
});
test('text editors and Excalidraw keep their native select all; readers select their own content',()=>{
 for(const kind of ['input','textarea','select','contenteditable'])assert.equal(selectAllScope(target(kind),state),'native');
 assert.equal(selectAllScope(null,{...state,drawingOpen:true}),'native');
 assert.equal(selectAllScope(target('.reader-panel'),state),'text');
 assert.equal(selectAllScope(target('.message'),state),'text');
});
const actions=await readFile(new URL('../src/actions.ts',import.meta.url),'utf8');
const action=actions.slice(actions.indexOf('export function selectAllCards()'),actions.indexOf('export type SessionChange'));
test('select all selects cards, skips disabled nodes and groups, clears edges, and never saves or records history',()=>{
 let workspace={nodes:[{id:'a',data:{kind:'document'},selected:false},{id:'b',data:{kind:'file'}},{id:'g',data:{kind:'group'},selected:true},{id:'x',data:{kind:'note'},selectable:false}],edges:[{id:'e',selected:true}]};
 let option,drained=0;
 const ctx={exports:{},drainNodeChanges:()=>drained++,update:(fn,opts)=>{workspace=fn(workspace);option=opts}};
 vm.runInNewContext(ts.transpileModule(action,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,ctx);ctx.exports.selectAllCards();
 assert.deepEqual(workspace.nodes.filter(node=>node.selected).map(node=>node.id),['a','b']);assert.equal(workspace.edges[0].selected,false);assert.equal(option.persist,false);assert.equal(drained,1);
});
const source=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
const shortcuts=source.slice(source.indexOf('function useShortcuts()'),source.indexOf('function useStageSize'));
function handlerFor(appState){let handler,cards=0,cleared=0;const ctx={exports:{},Element:class {},useEffect:fn=>fn(),document:{addEventListener:(_,fn)=>handler=fn},app:{get:()=>appState},isWelcomeOf:s=>s.home,selectAllScope,clearTextSelection:()=>cleared++,selectAllCards:()=>cards++};
 vm.runInNewContext(ts.transpileModule(shortcuts+'\nuseShortcuts();',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 return {run:handler,counts:()=>({cards,cleared})};}
test('both Ctrl+A and Cmd+A consume browser page selection and select cards exactly once',()=>{
 for(const modifier of ['ctrlKey','metaKey']){const h=handlerFor({...state,popup:'',menu:null,sessionManaging:false});let prevented=0,stopped=0;h.run({key:'A',[modifier]:true,altKey:false,target:null,preventDefault:()=>prevented++,stopPropagation:()=>stopped++});assert.deepEqual(h.counts(),{cards:1,cleared:1});assert.equal(prevented,1);assert.equal(stopped,1);}
});
test('home Ctrl+A clears old selection and does not select hidden cards',()=>{const h=handlerFor({...state,home:true});let prevented=0;h.run({key:'a',ctrlKey:true,target:null,preventDefault:()=>prevented++,stopPropagation(){}});assert.deepEqual(h.counts(),{cards:0,cleared:1});assert.equal(prevented,1);});
test('right-click keeps the system menu only in text fields and on selected text, never Reload elsewhere', () => {
  assert.equal(keepsNativeMenu(target('textarea'), false), true);
  assert.equal(keepsNativeMenu(target('message'), true), true);
  for (const kind of ['message', 'composer', 'titlebar']) assert.equal(keepsNativeMenu(target(kind), false), false, kind);
  assert.equal(keepsNativeMenu(null, false), false);
});
