import test from 'node:test';
import assert from 'node:assert/strict';
import {createDispatcher} from '../apps/agent/dispatcher.mjs';

const delay=ms=>new Promise(r=>setTimeout(r,ms));

test('dispatcher overlaps reads, targets cancellation and retains uninterruptible slots',async()=>{
 const gates=new Map(),results=[];
 const d=createDispatcher({maxConcurrency:2},(tool,args,signal)=>new Promise(resolve=>gates.set(args.n,{resolve,signal})),m=>results.push(m));
 const one=d.request({id:'one',tool:'read_file',arguments:{n:1},budgetMs:20});
 const two=d.request({id:'two',tool:'read_file',arguments:{n:2}});
 assert.equal(gates.size,2);
 await d.request({id:'three',tool:'read_file',arguments:{n:3}});
 assert.equal(results.at(-1).error.code,'CAPACITY_EXCEEDED');
 d.cancel('two');
 assert.equal(gates.get(2).signal.aborted,true);
 assert.equal(gates.get(1).signal.aborted,false);
 await delay(30);
 assert.equal(gates.get(1).signal.aborted,true);
 assert.equal(d.admission.active,2);
 gates.get(2).resolve('second');
 await two;
 gates.get(1).resolve('first');
 await one;
 assert.deepEqual(results.slice(-2).map(x=>x.id),['two','one']);
 assert.equal(d.active.size,0);
});

test('dispatcher rejects overlapping mutations and duplicate request IDs',async()=>{
 let finish,count=0;
 const output=[];
 const d=createDispatcher({},async(tool)=>{
  count++;
  if(tool==='run_command')await new Promise(r=>finish=r);
  return tool;
 },m=>output.push(m));

 const first=d.request({id:'first',tool:'run_command',arguments:{}});
 await d.request({id:'first',tool:'run_command',arguments:{}});
 await d.request({id:'second',tool:'write_file',arguments:{}});
 assert.equal(output[0].error.code,'CAPACITY_EXCEEDED');

 await d.request({id:'stop',tool:'terminate_process',arguments:{}});
 assert.equal(output.at(-1).result,'terminate_process');
 assert.equal(count,2);

 finish();
 await first;
 assert.equal(d.admission.active,0);
 assert.equal(d.admission.control,0);
});
