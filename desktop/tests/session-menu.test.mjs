import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source=await readFile(new URL('../src/actions.ts',import.meta.url),'utf8');
const menu=source.slice(source.indexOf('let sessionListRevision'),source.indexOf('export function closeTransient'));
const send=source.slice(source.indexOf('export async function send('),source.indexOf('export async function stop('));
const code=ts.transpileModule(menu+'\n'+send,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText.replaceAll('import.meta.env.DEV','development');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setTimeout(resolve,8));
function harness({native=false,development=true,model}={}){
  let state={popup:'',menu:{x:1},sessions:[{id:'cached'}],workspace:{id:'workspace',model},attachments:[],busy:false};
  const calls=[],notices=[],requests=[];
  const context={exports:{},setTimeout,native,development,LOCAL_COMMANDS:{},notice:value=>notices.push(value),app:{get:()=>state,set:patch=>{state={...state,...(typeof patch==='function'?patch(state):patch)};}},request:method=>{calls.push(method);const pending=deferred();requests.push(pending);return pending.promise;}};
  vm.runInNewContext(code,context);
  return {...context.exports,get:()=>state,set:context.app.set,calls,notices,requests};
}
test('menu opens with cached items immediately, before list reading finishes',async()=>{const h=harness(),pending=h.toggleSessions();assert.equal(h.get().popup,'sessions');assert.equal(h.get().sessions[0].id,'cached');await tick();h.requests[0].resolve([{id:'new'}]);await pending;assert.equal(h.get().sessions[0].id,'new');});
test('clicking the trigger again closes it and a late result cannot reopen it',async()=>{const h=harness(),pending=h.toggleSessions();await tick();await h.toggleSessions();h.requests[0].resolve([{id:'late'}]);await pending;assert.equal(h.get().popup,'');assert.equal(h.get().sessions[0].id,'cached');});
test('outside dismissal survives a late result and does not replace another popup',async()=>{const h=harness(),pending=h.toggleSessions();await tick();h.set({popup:'help'});h.requests[0].resolve([{id:'late'}]);await pending;assert.equal(h.get().popup,'help');assert.equal(h.get().sessions[0].id,'cached');});
test('reopening only accepts the latest request',async()=>{const h=harness(),first=h.toggleSessions();await tick();h.set({popup:''});const second=h.toggleSessions();await tick();h.requests[1].resolve([{id:'latest'}]);await second;h.requests[0].resolve([{id:'stale'}]);await first;assert.equal(h.get().sessions[0].id,'latest');});
test('late errors after dismissal do not interrupt the next action',async()=>{const h=harness(),pending=h.toggleSessions();await tick();h.set({popup:''});h.requests[0].reject(new Error('late failure'));await pending;assert.equal(h.notices.length,0);});
test('sending never falls back to a simulated reply',()=>{assert(send.includes("'prompt.send'"));assert(!send.includes("'prompt.mock'"));});
