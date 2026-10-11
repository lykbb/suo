import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
const source=await readFile(new URL('../src/actions.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('actions.ts',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
const names=new Set(['hydrateDraftAttachments','manageSession','switchSession','serialize','scheduleSave','flush','update','addTemplateCard']);
const code=ts.transpileModule(ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name?.text)).map(node=>node.getText(ast)).join('\n'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const clone=value=>JSON.parse(JSON.stringify(value));
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function harness({saveFails=false,loadFails=false}={}){
 const make=id=>({id,title:id,version:1,nodes:[],edges:[],messages:[],draft:'已有草稿',panels:{},updatedAt:'2026-10-10'});
 const records=new Map([['A',make('A')],['B',make('B')]]),pending=deferred(),calls=[],notices=[];
 let state={workspace:clone(records.get('A')),sessionManaging:false,busy:false,popup:'sessions',saveStatus:'已保存'};
 const session={version:1,dirty:false,saving:null,importing:false};
 const ctx={exports:{},crypto:{randomUUID},structuredClone,session,workspaceLoads:{revision:0},sessionListRevision:0,saveTimer:null,bindings:{},history:{past:[],future:[]},clearTimeout(){},setTimeout(){return 1;},drainNodeChanges(){},cleanNodes:nodes=>nodes,withDrawingCard:value=>value,notice:value=>notices.push(value),stop:async()=>{},app:{get:()=>state,set:patch=>state={...state,...(typeof patch==='function'?patch(state):patch)}},request:async(method,payload={})=>{
  calls.push({method,payload});
  if(method==='workspace.list')return [...records.values()].filter(item=>!item.deletedAt).map(clone);
  if(method==='workspace.load'){if(loadFails)throw new Error('读取失败');return clone(records.get(payload.id));}
  if(method==='workspace.create'){const next=make('C');records.set('C',next);return clone(next);}
  if(method==='workspace.save'){if(saveFails)throw new Error('保存失败');const old=records.get(payload.state.id);if(old.version!==payload.expectedVersion)throw new Error('版本冲突');const saved={...clone(payload.state),version:old.version+1};records.set(saved.id,saved);return clone(saved);}
  if(method==='workspace.remove'){await pending.promise;const old=records.get(payload.id);if(old.version!==payload.expectedVersion)throw new Error('版本冲突');const removed={...old,deletedAt:'now',version:old.version+1};records.set(old.id,removed);return clone(removed);}
  throw new Error(method);
 }};
 vm.runInNewContext(code,ctx);
 return {...ctx.exports,get:()=>state,set:ctx.app.set,records,session,pending,calls,notices};
}
test('current-session removal saves drafts first, locks template insertion and switching, and opens the retained session',async()=>{
 const h=harness();h.update(value=>({...value,draft:'刚写的草稿'}));const job=h.manageSession('A',{remove:true});await tick();
 assert.equal(h.get().sessionManaging,true);h.addTemplateCard('不能插入','新内容');await h.switchSession('B');assert.equal(h.get().workspace.nodes.length,0);
 h.pending.resolve();assert.equal(await job,true);assert.equal(h.records.get('A').draft,'刚写的草稿');assert.equal(h.get().workspace.id,'B');assert.equal(h.get().sessionManaging,false);
});
test('a failed flush prevents removal and leaves the original editable workspace intact',async()=>{
 const h=harness({saveFails:true});h.update(value=>({...value,draft:'未保存'}));assert.equal(await h.manageSession('A',{remove:true}),false);assert.equal(h.calls.some(call=>call.method==='workspace.remove'),false);assert.equal(h.get().workspace.id,'A');assert.equal(h.get().workspace.draft,'未保存');assert.equal(h.session.dirty,true);assert.equal(h.get().sessionManaging,false);
});
test('if opening the next session fails after removal, new session can recover the empty workspace',async()=>{
 const h=harness({loadFails:true});const job=h.manageSession('A',{remove:true});await tick();h.pending.resolve();assert.equal(await job,false);assert.equal(h.get().workspace,null);assert.equal(h.get().sessionManaging,false);await h.switchSession();assert.equal(h.get().workspace.id,'C');
});
test('current rename uses the normal save queue and preserves pending edits with a customized title',async()=>{
 const h=harness();h.update(value=>({...value,draft:'编辑中',nodes:[{id:'n',data:{content:'内容'}}]}));assert.equal(await h.manageSession('A',{title:'新会话'}),true);const saved=h.records.get('A');assert.equal(saved.draft,'编辑中');assert.equal(saved.nodes[0].data.content,'内容');assert.equal(saved.titleCustomized,true);assert.equal(h.session.version,saved.version);assert.equal(h.session.dirty,false);
});
