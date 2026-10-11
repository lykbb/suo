import test from 'node:test';
import assert from 'node:assert/strict';
import { resizePanel } from '../src/geometry.ts';
const rect = {x:100,y:80,width:500,height:400};
test('all eight panel handles keep the opposite edge anchored',()=>{
 for(const edge of ['n','ne','e','se','s','sw','w','nw']) {
  const next=resizePanel(rect,20,15,1200,900,edge,'reader');
  if(edge.includes('w')) assert.equal(next.x+next.width,600); else assert.equal(next.x,100);
  if(edge.includes('n')) assert.equal(next.y+next.height,480); else assert.equal(next.y,80);
  assert.equal(next.width,edge.includes('w')?480:edge.includes('e')?520:500);
  assert.equal(next.height,edge.includes('n')?385:edge.includes('s')?415:400);
 }
});
test('edge resize respects the window and minimum size without moving the other edge',()=>{
 for(const edge of ['n','ne','e','se','s','sw','w','nw'])for(const delta of [-2000,2000]){
  const next=resizePanel(rect,delta,delta,1200,900,edge,'reader');
  assert(next.x>=8&&next.y>=8&&next.x+next.width<=1192&&next.y+next.height<=892);
  assert(next.width>=340&&next.height>=112);
  if(edge.includes('w')) assert.equal(next.x+next.width,600);
  if(edge.includes('n')) assert.equal(next.y+next.height,480);
 }
});
