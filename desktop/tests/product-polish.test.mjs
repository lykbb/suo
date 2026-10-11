import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import { createTestDirectory } from './helpers/test-data.mjs';
import { imageGeometry } from '../src/geometry.ts';
import { panelZ, orderPanels } from '../src/layers.ts';
import { panelDefaults, boardViewport } from '../src/geometry.ts';
import { Connections, connectionCatalog, normalizeConnections } from '../bridge/connections.mjs';
import { validReaderMessage } from '../src/readerMessage.ts';

const secret='fixture-only-key';
const fakeFetch=async()=>new Response(JSON.stringify({data:[{id:'a'},{id:'b'}]}));
test('portrait and landscape images keep their intrinsic ratio and have usable minimum sizes',()=>{
 for(const [width,height] of [[1600,900],[900,1600],[480,320],[200,200],[5000,10],[10,5000]]){
  const value=imageGeometry(width,height);
  assert.equal(value.width/value.height,width/height);
  assert(value.width<=480&&value.height<=420);
  assert(value.minWidth>0&&value.minHeight>0);
 }
 assert.equal(imageGeometry(0,800),null);assert.equal(imageGeometry(Infinity,800),null);
});
test('chat, composer and tools remain above previews despite legacy pin states and focus',()=>{
 for(const target of ['drawing','reader','composer','thread','toolbar']){
  const layers=orderPanels({thread:{pinned:true,order:0},reader:{pinned:true,order:20}},target,true);
  for(const top of ['composer','thread','toolbar'])for(const bottom of ['drawing','reader']) assert(panelZ(layers,top)>panelZ(layers,bottom));
  assert(panelZ(layers,'toolbar')<50);
 }
});
test('first skill card can fit above the bottom composer and beside the conversation',()=>{
 for(const [width,height] of [[1280,780],[1000,650]]){
  const {composer,reader,thread}=panelDefaults(width,height,true);
  assert.equal(height-(composer.y+composer.height),24);
  const node={id:'skill',position:{x:100,y:100},style:{width:340,height:260},data:{kind:'document'}};
  const fit=boardViewport([node],width,height,true);
  assert(fit.y+(node.position.y+260)*fit.zoom<composer.y);
  assert(reader.x+reader.width<thread.x);
  assert(reader.y+reader.height<composer.y);
 }
});
test('adding models retains existing connections, keys and model IDs; public catalog has no secrets',async()=>{
 const root=await createTestDirectory('model-merge-');
 const c=new Connections({root,dataRoot:root,fetch:fakeFetch});
 const first=await c.configure({baseUrl:'https://api.example.test/v1',modelId:'a',apiKey:secret});
 const second=await c.configure({baseUrl:'https://api.example.test/v1/',modelId:'b',apiKey:''});
 assert.equal(first.selected.provider,second.selected.provider);
 let config=await c.load();assert.deepEqual(config.providers[first.selected.provider].models.map(m=>m.id),['a','b']);
 const other=await c.configure({baseUrl:'https://other.example.test/v1',modelId:'a',apiKey:'other-fixture-key'});
 assert.notEqual(other.selected.provider,first.selected.provider);
 config=await c.load();assert.equal(Object.keys(config.providers).length,2);
 assert.equal(config.providers[first.selected.provider].apiKey,secret);
 assert(!JSON.stringify(connectionCatalog(config)).includes(secret));
 for(const name of await readdir(c.directory)) assert.equal((await stat(c.directory+'/'+name)).mode&0o777,0o600);
 await assert.rejects(c.configure({provider:first.selected.provider,baseUrl:'https://another.example.test/v1',modelId:'a',apiKey:''}),/API Key/);
 await assert.rejects(c.configure({baseUrl:'https://api.example.test/v1',modelId:'a',apiKey:secret,network:'funnel-public'}),/Tailscale Funnel/);
 const normalized=normalizeConnections({providers:{public:{api:'openai-completions',baseUrl:'https://node.tailnet.ts.net:10000/v1',apiKey:secret,network:'funnel-public',models:[{id:'a'}]}}});
 assert.equal(normalized.providers.public.network,'funnel-public');
});
test('attachment open and close commands require the correct opaque-frame token',()=>{
 for(const type of ['reader-open','reader-close']){
  assert.equal(validReaderMessage({type,channel:'correct'},'correct'),true);
  assert.equal(validReaderMessage({type,channel:'forged'},'correct'),false);
 }
 assert.equal(validReaderMessage({type:'execute',channel:'correct'},'correct'),false);
});
