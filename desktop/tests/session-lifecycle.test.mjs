import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestDirectory } from './helpers/test-data.mjs';
import { WorkspaceStore } from '../bridge/store.mjs';
import { assertSaveRequest, committedReplay, committedState, workspaceAssetIds } from '../bridge/saveReceipt.mjs';
async function fixture(){ const dir=await createTestDirectory('sessions-');return {dir,store:new WorkspaceStore(dir)}; }
test('renaming and pinning survive reopening without changing cards or attachments',async()=>{
 const {dir,store}=await fixture();const first=await store.create();
 const nodes=[{id:'card',data:{content:'用户正文',asset:{id:'asset-id'}}}];
 const saved=await store.save({...first,title:'我的访谈',titleCustomized:true,pinned:true,nodes,draft:'未发送'},first.version);
 const reopened=await new WorkspaceStore(dir).load(first.id);
 assert.equal(reopened.title,'我的访谈');assert.equal(reopened.pinned,true);assert.equal(reopened.titleCustomized,true);
 assert.deepEqual(reopened.nodes,nodes);assert.equal(reopened.draft,'未发送');assert.equal(saved.version,2);
});
test('pinned sessions precede newer unpinned sessions; unpinning restores chronological order',async()=>{
 const {store}=await fixture();const a=await store.create();await store.save({...a,pinned:true},a.version);
 await new Promise(resolve=>setTimeout(resolve,5));const b=await store.create();
 assert.equal((await store.list())[0].id,a.id);const pinned=await store.load(a.id);await store.save({...pinned,pinned:false},pinned.version);
 const list=await store.list();assert.equal(list[0].pinned,false);assert.equal(list.some(item=>item.id===b.id),true);
});
test('deleted sessions leave the active list, preserve revisions, and can be restored',async()=>{
 const {store}=await fixture();const a=await store.create(),b=await store.create();
 const saved=await store.save({...a,title:'资料会话',draft:'留住正文'},a.version);
 const removed=await store.remove(a.id,saved.version);assert(removed.deletedAt);
 assert.deepEqual((await store.list()).map(item=>item.id),[b.id]);assert.equal((await store.list(true))[0].id,a.id);
 const original=JSON.parse(await readFile(join(store.folder(a.id),'0000000002.json'),'utf8'));assert.equal(original.draft,'留住正文');
 const restored=await store.restore(a.id,removed.version);assert.equal(restored.draft,'留住正文');assert.equal(restored.deletedAt,undefined);assert.equal((await store.list(true)).length,0);
});
test('late saves, even with the tombstone version, cannot resurrect a deleted session',async()=>{
 const {dir,store}=await fixture();const other=new WorkspaceStore(dir),a=await store.create();const removed=await store.remove(a.id,a.version);
 await assert.rejects(other.save({...a,title:'迟到'},a.version),/已删除/);
 await assert.rejects(other.save({...a,version:removed.version},removed.version),/已删除/);
 assert.equal((await store.list()).length,0);assert.equal((await store.list(true)).length,1);
});
test('conflicting deletes and restores reject stale versions and preserve the winning state',async()=>{
 const {dir,store}=await fixture();const other=new WorkspaceStore(dir),a=await store.create();
 const results=await Promise.allSettled([store.remove(a.id,a.version),other.save({...a,title:'另一个窗口'},a.version)]);
 assert.equal(results.filter(item=>item.status==='fulfilled').length,1);
 const current=await store.load(a.id);
 if(current.deletedAt){await assert.rejects(store.restore(a.id,a.version),/另一个窗口/);assert((await store.load(a.id)).deletedAt);}
 else {await assert.rejects(store.remove(a.id,a.version),/另一个窗口/);assert.equal((await store.list()).length,1);}
});
test('ordinary saves cannot fabricate a deleted record',async()=>{
 const {store}=await fixture();const a=await store.create();await assert.rejects(store.save({...a,deletedAt:'now'},a.version),/已删除/);assert.equal((await store.list()).length,1);
});

import vm from 'node:vm';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
const frontend=await readFile(new URL('../src/bridge.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('bridge.ts',frontend,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
const request=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&['request','browserRequest'].includes(node.name?.text)).map(node=>node.getText(ast)).join('\n');
test('browser sessions have the same pin, deletion, late-save rejection, and restore behavior',async()=>{
 const localStorage={};Object.defineProperties(localStorage,{getItem:{value:key=>localStorage[key]??null},setItem:{value:(key,value)=>localStorage[key]=value}});
 const ctx={exports:{},native:false,navigator:{},prefix:'test:',localStorage,crypto:{randomUUID},console,assertSaveRequest,committedReplay,committedState,workspaceAssetIds};
 vm.runInNewContext(ts.transpileModule(request,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 const call=ctx.exports.request,a=await call('workspace.create'),b=await call('workspace.create');
 const renamed=await call('workspace.save',{state:{...a,title:'重命名',titleCustomized:true,pinned:true},expectedVersion:a.version});
 assert.equal((await call('workspace.list'))[0].id,a.id);
 const deleted=await call('workspace.remove',{id:a.id,expectedVersion:renamed.version});
 assert.equal(await call('workspace.load',{id:a.id}),null);assert.deepEqual(Array.from((await call('workspace.list')).map(item=>item.id)),[b.id]);
 await assert.rejects(call('workspace.save',{state:renamed,expectedVersion:deleted.version}),/已删除/);
 assert.equal((await call('workspace.trash'))[0].id,a.id);
 const restored=await call('workspace.restore',{id:a.id,expectedVersion:deleted.version});assert.equal(restored.title,'重命名');assert.equal(restored.pinned,true);assert.equal((await call('workspace.trash')).length,0);
});
