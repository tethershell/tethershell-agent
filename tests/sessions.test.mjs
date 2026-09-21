import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProcessSessions} from '../packages/tools/sessions.mjs';
import {execute} from '../packages/tools/execute.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function finished(manager,id){
 for(let i=0;i<300;i++){const r=manager.read(id);if(r.status==='exited')return r;await delay(50)}
 throw Error('Session did not exit');
}
test('background sessions, pagination, stdin, cancellation and bounds',async t=>{
 const root=await mkdtemp(join(tmpdir(),'tethershell-sessions-'));
 const sessions=new ProcessSessions({maxOutputBytes:131072,maxRunning:2});
 t.after(async()=>{sessions.close();await delay(100);await rm(root,{recursive:true,force:true})});
 const call=(name,args)=>execute(root,name,args,{commands:true,write:true,sessions});
 await t.test('command runs beyond 10 seconds while other operations remain available',async()=>{
  const start=Date.now();const r=await call('start_process',{command:'sleep 11; printf LONG_OK',wait_ms:0});
  assert.equal(r.status,'running');assert.ok(Date.now()-start<1000);
  await call('write_file',{path:'concurrent.txt',content:'ok'});
  const status=await finished(sessions,r.sessionId);assert.equal(status.output,'LONG_OK');assert.equal(status.exitCode,0);
 });
 await t.test('interactive stdin and EOF',async()=>{
  const r=await call('start_process',{command:'cat',wait_ms:0});
  await call('interact_with_process',{sessionId:r.sessionId,input:'hello\n',wait_ms:50});
  await call('interact_with_process',{sessionId:r.sessionId,input:'world\n',eof:true,wait_ms:1000});
  const end=await finished(sessions,r.sessionId);assert.equal(end.output,'hello\nworld\n');
  await assert.rejects(call('interact_with_process',{sessionId:r.sessionId,input:'again'}),/closed/);
 });
 await t.test('large output is paginated without terminating the process',async()=>{
  const r=await call('run_command',{command:'head -c 100000 /dev/zero',wait_ms:1000});
  assert.equal(r.reason,'completed');assert.equal(r.nextOffset,65536);assert.equal(r.hasMore,true);
  const page=await call('read_process_output',{sessionId:r.sessionId,offset:r.nextOffset,encoding:'base64'});
  assert.equal(Buffer.from(page.output,'base64').length,100000-65536);assert.equal(page.hasMore,false);
 });
 await t.test('rolling buffer reports eviction without killing the process',async()=>{
  const r=await call('start_process',{command:'head -c 200000 /dev/zero; sleep 30',wait_ms:100});
  assert.equal(r.status,'running');assert.equal(r.droppedBytes,200000-131072);assert.equal(r.truncated,true);
  const end=await call('terminate_process',{sessionId:r.sessionId});assert.equal(end.reason,'cancelled');assert.equal(end.status,'exited');
 });
 await t.test('running session limit, disconnect cleanup and unknown IDs',async()=>{
  const a=await call('start_process',{command:'sleep 30',wait_ms:0});
  const b=await call('start_process',{command:'sleep 30',wait_ms:0});
  await assert.rejects(call('start_process',{command:'true',wait_ms:0}),/limit/);
  sessions.disconnect();assert.equal((await finished(sessions,a.sessionId)).reason,'disconnected');await finished(sessions,b.sessionId);
  await assert.rejects(call('read_process_output',{sessionId:'00000000-0000-0000-0000-000000000000'}),/Unknown/);
 });
 await t.test('large UTF-8 files reconstruct exactly in base64 pages and detect changes',async()=>{
  const content='🙂héllo\n'.repeat(15000);await writeFile(join(root,'large.txt'),content);
  let offset=0,version,bytes=[];
  do{
   const p=await call('read_file',{path:'large.txt',offset,length:16381,encoding:'base64',expectedVersion:version});
   bytes.push(Buffer.from(p.content,'base64'));version=p.version;offset=p.nextOffset;if(!p.hasMore)break;
  }while(true);
  assert.equal(Buffer.concat(bytes).toString('utf8'),content);
  await writeFile(join(root,'large.txt'),'changed');
  await assert.rejects(call('read_file',{path:'large.txt',offset:0,expectedVersion:version}),/changed/);
 });
 await t.test('chunked append accepts expected size and rejects replay',async()=>{
  let p=await call('write_file',{path:'append.txt',content:'a'.repeat(65536)});
  p=await call('write_file',{path:'append.txt',content:'b'.repeat(65536),mode:'append',expectedSize:p.size});
  assert.equal(p.size,131072);
  await assert.rejects(call('write_file',{path:'append.txt',content:'b',mode:'append',expectedSize:65536}),/size changed/);
  assert.equal((await call('read_file',{path:'append.txt',offset:65536,length:10})).content,'bbbbbbbbbb');
 });
});
