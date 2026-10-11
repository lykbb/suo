import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { createConnectionFetch, publicAddresses, supportsPublicRoute } from '../bridge/network.mjs';
import { fileURLToPath } from 'node:url';
import { realpath } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

const baseUrl='https://node.tailnet.ts.net:10000/v1';
function fixture({status=200,headers={'content-type':'text/event-stream'},body='data: first\n\n',hold=false}={}){
 const seen=[];
 function requestImpl(url,options,callback){
  const outgoing=new EventEmitter();
  outgoing.end=bodySent=>{
   seen.push({url:url.href,options,body:bodySent?.toString()});
   const incoming=new PassThrough();incoming.statusCode=status;incoming.headers=headers;
   queueMicrotask(()=>{
    callback(incoming);
    incoming.write(body);
    if(!hold)incoming.end();
   });
   options.signal.addEventListener('abort',()=>{incoming.destroy(options.signal.reason);outgoing.emit('error',options.signal.reason);},{once:true});
  };return outgoing;
 }
 return {seen,requestImpl};
}
const transport=f=>createConnectionFetch({baseUrl,network:'funnel-public'},{resolve:async()=>['208.111.34.11'],requestImpl:f.requestImpl});
test('public route keeps hostname and certificate checks, streams SSE and makes exactly one POST',async()=>{
 const f=fixture(),fetch=transport(f),response=await fetch(baseUrl+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer fixture-key'},body:'{"model":"a"}'});
 assert.equal(await response.text(),'data: first\n\n');assert.equal(f.seen.length,1);
 const request=f.seen[0];assert.equal(request.options.servername,'node.tailnet.ts.net');assert.equal(request.options.rejectUnauthorized,true);
 assert.equal(request.options.headers.authorization,'Bearer fixture-key');assert.equal(request.body,'{"model":"a"}');
 let address;request.options.lookup('node.tailnet.ts.net',{},(_err,value)=>address=value);assert.equal(address,'208.111.34.11');
 await assert.rejects(fetch('https://other.tailnet.ts.net/v1/models'),/不一致/);assert.equal(f.seen.length,1);
});
test('compressed responses decode and streamed responses stop on abort',async()=>{
 const compressed=fixture({headers:{'content-type':'application/json','content-encoding':'gzip','content-length':'80'},body:gzipSync('{"ok":true}')});
 const result=await transport(compressed)(baseUrl+'/models');assert.deepEqual(await result.json(),{ok:true});assert.equal(result.headers.get('content-encoding'),null);
 const f=fixture({hold:true}),controller=new AbortController();
 const response=await transport(f)(baseUrl+'/chat/completions',{signal:controller.signal});
 const reader=response.body.getReader();assert.equal(new TextDecoder().decode((await reader.read()).value),'data: first\n\n');
 controller.abort();await assert.rejects(reader.read());assert.equal(f.seen.length,1);
});
test('public DNS excludes private routes and plain connections retain the default fetch',async()=>{
 const calls=[];
 const addresses=await publicAddresses('unique-fixture.tailnet.ts.net',undefined,async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({Answer:[{type:1,data:'100.64.0.1'},{type:1,data:'192.168.1.1'},{type:1,data:'208.111.34.11',TTL:30}]}));});
 assert.deepEqual(addresses,['208.111.34.11']);assert.equal(calls[0].options.headers.Authorization,undefined);
 const basic=()=>{};assert.equal(createConnectionFetch({baseUrl},{fetchImpl:basic}),basic);
 assert.equal(supportsPublicRoute('http://node.tailnet.ts.net/v1'),false);
 assert.equal(supportsPublicRoute('https://api.example.test/v1'),false);
});
test('installed OpenAI SDK uses the custom HTTPS transport without sockets or external requests',async()=>{
 const desktop=fileURLToPath(new URL('..',import.meta.url));
 const engine=resolvePath(await realpath(desktop+'/node_modules'),'..','..');
 const ai=await import(engine+'/node_modules/@earendil-works/pi-ai/dist/index.js');
 const sdk=await import(engine+'/node_modules/@earendil-works/pi-coding-agent/dist/index.js');
 const runtime=await sdk.ModelRuntime.create({credentials:new ai.InMemoryCredentialStore(),modelsStore:new ai.InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
 const chunk=text=>'data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{content:text},finish_reason:null}]})+'\n\n';
 const f=fixture({body:chunk('连接')+chunk('验收')+'data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'});
 const model={id:'fixture',name:'fixture',provider:'fixture',api:'openai-completions',baseUrl,reasoning:false,input:['text'],contextWindow:32768,maxTokens:256,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
 runtime.registerProvider('fixture',{api:'openai-completions',baseUrl,models:[model]});
 const stream=runtime.streamSimple(runtime.getModel('fixture','fixture'),{systemPrompt:'fixture',messages:[{role:'user',content:'fixture',timestamp:1}],tools:[]},{apiKey:'fixture-key',fetch:transport(f),maxRetries:0,maxTokens:32});
 const chunks=[];for await(const part of stream) chunks.push(part);
 assert.equal(f.seen.length,1);assert.equal(chunks.filter(p=>p.type==='text_delta').map(p=>p.delta).join(''),'连接验收');
 assert.equal(chunks.at(-1).type,'done');
});
