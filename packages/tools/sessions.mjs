import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const PAGE=65536;
export class ProcessSessions {
 constructor({maxRunning=8,maxSessions=32,maxOutputBytes=4*1024*1024,maxRuntimeMs=3600000,retentionMs=3600000,onExit=()=>{}}={}){
  this.onExit=onExit;this.limits={maxRunning,maxSessions,maxOutputBytes,maxRuntimeMs,retentionMs};this.sessions=new Map();
  this.timer=setInterval(()=>this.prune(),60000);this.timer.unref();
 }
 prune(){for(const [id,s] of this.sessions)if(s.finishedAt&&Date.now()-s.finishedAt>this.limits.retentionMs)this.sessions.delete(id)}
 get(id){this.prune();const s=this.sessions.get(id);if(!s)throw Error('Unknown or expired process session');return s}
 info(s){return {sessionId:s.id,pid:s.child.pid,status:s.status,exitCode:s.exitCode,signal:s.signal,reason:s.reason,startedAt:s.startedAt,finishedAt:s.finishedAt,outputStart:s.start,outputEnd:s.end}}
 kill(s,reason){if(s.status!=='running')return;s.reason=reason;try{process.kill(-s.child.pid,'SIGKILL')}catch{}}
 async wait(s,ms,signal){
  if(!ms||s.status!=='running')return;
  await new Promise(resolve=>{
   const done=()=>{clearTimeout(timer);s.child.off('close',done);signal?.removeEventListener('abort',abort);resolve()};
   const abort=()=>{this.kill(s,'cancelled');done()};
   const timer=setTimeout(done,ms);s.child.once('close',done);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
 }
 async start(root,a,signal){
  this.prune();if(signal?.aborted)throw Error('Cancelled');
  if([...this.sessions.values()].filter(s=>s.status==='running').length>=this.limits.maxRunning)throw Error('Running process limit reached');
  while(this.sessions.size>=this.limits.maxSessions){
   const oldest=[...this.sessions.values()].find(s=>s.status!=='running');if(!oldest)throw Error('Session limit reached');this.sessions.delete(oldest.id);
  }
  const child=spawn('/bin/sh',['-c',a.command],{cwd:root,detached:true,env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:root,LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']});
  const s={id:randomUUID(),child,status:'running',exitCode:null,signal:null,reason:'running',startedAt:Date.now(),finishedAt:null,start:0,end:0,buffer:Buffer.alloc(0)};
  this.sessions.set(s.id,s);
  const output=b=>{
   s.end+=b.length;
   s.buffer=b.length>=this.limits.maxOutputBytes?b.subarray(b.length-this.limits.maxOutputBytes):Buffer.concat([s.buffer,b]);
   if(s.buffer.length>this.limits.maxOutputBytes)s.buffer=s.buffer.subarray(s.buffer.length-this.limits.maxOutputBytes);
   s.start=s.end-s.buffer.length;
  };
  child.stdout.on('data',output);child.stderr.on('data',output);child.stdin.on('error',()=>{});
  const timeout=setTimeout(()=>this.kill(s,'timeout'),Math.min(a.timeout_ms??this.limits.maxRuntimeMs,this.limits.maxRuntimeMs));timeout.unref();
  child.on('error',()=>{s.reason='spawn_error'});
  child.on('close',(code,sig)=>{
   clearTimeout(timeout);try{process.kill(-child.pid,'SIGKILL')}catch{}
   s.status='exited';s.exitCode=code;s.signal=sig;s.finishedAt=Date.now();if(s.reason==='running')s.reason='completed';
   this.onExit({sessionId:s.id,runtimeMs:s.finishedAt-s.startedAt,exitCode:s.exitCode,reason:s.reason});
  });
  await this.wait(s,a.wait_ms??1000,signal);return this.read(s.id,0,PAGE);
 }
 read(id,offset=0,length=PAGE,encoding='utf8'){
  const s=this.get(id);const from=Math.max(s.start,Math.min(offset,s.end)),to=Math.min(from+length,s.end);
  return {...this.info(s),output:s.buffer.subarray(from-s.start,to-s.start).toString(encoding),encoding,offset:from,nextOffset:to,hasMore:to<s.end,truncated:offset<s.start,droppedBytes:Math.max(0,s.start-offset)};
 }
 async input(id,input,eof,wait_ms,signal){
  const s=this.get(id);if(s.status!=='running'||s.child.stdin.destroyed||s.child.stdin.writableEnded)throw Error('Process input is closed');
  if(s.child.stdin.writableLength>65536)throw Error('Process input buffer full');
  const offset=s.end;if(input)s.child.stdin.write(input);if(eof)s.child.stdin.end();
  await this.wait(s,wait_ms,signal);return this.read(id,offset);
 }
 async terminate(id){const s=this.get(id);this.kill(s,'cancelled');await this.wait(s,1000);return this.info(s)}
 list(){this.prune();return [...this.sessions.values()].map(s=>this.info(s))}
 disconnect(){for(const s of this.sessions.values())this.kill(s,'disconnected')}
 close(){clearInterval(this.timer);this.disconnect()}
}
