import WebSocket from 'ws';
import {platform} from 'node:os';
import {readFileSync} from 'node:fs';
import {ProcessSessions} from '../../packages/tools/sessions.mjs';
import {execute} from '../../packages/tools/execute.mjs';
import {createDispatcher} from './dispatcher.mjs';
import {positive} from '../../packages/protocol/concurrency.mjs';
const c=JSON.parse(readFileSync(process.env.TETHERSHELL_AGENT_CONFIG||process.env.PORTSIDE_AGENT_CONFIG||process.argv[2],'utf8'));
if(c.maxRuntimeMs!==undefined&&(!Number.isInteger(c.maxRuntimeMs)||c.maxRuntimeMs<100||c.maxRuntimeMs>86400000))throw Error('maxRuntimeMs must be 100–86400000');
const maxConcurrency=positive(c.maxConcurrency,4,'maxConcurrency',64);
const maxControlConcurrency=positive(c.maxControlConcurrency,1,'maxControlConcurrency',8);
let stopping=false,socket,backoff=500;
function send(ws,m){
 if(ws.readyState!==WebSocket.OPEN)return;
 const data=JSON.stringify(m);
 if(Buffer.byteLength(data)>1048576||ws.bufferedAmount>2097152){ws.terminate();return}
 ws.send(data,err=>{if(err)ws.terminate()});
}
const sessions=new ProcessSessions({maxRuntimeMs:c.maxRuntimeMs??3600000,onExit:m=>{if(socket)send(socket,{type:'process_exit',...m})}});
const url=new URL(c.gateway);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('HTTPS required');
url.protocol=url.protocol==='https:'?'wss:':'ws:';url.pathname='/agent';url.search='';
// A shared dispatcher keeps uninterruptible work counted across reconnects.
const dispatcher=createDispatcher(c,(tool,args,signal)=>execute(c.workspace,tool,args,{write:c.allowWrite===true,commands:c.allowCommands===true,signal,sessions}),m=>{
 const ws=owners.get(m.id);if(ws)send(ws,m);owners.delete(m.id);
});
const owners=new Map();
function connect(){
 const ws=new WebSocket(url,{headers:{Authorization:'Bearer '+c.token,'X-Tethershell-Device':c.deviceId,'X-Portside-Device':c.deviceId},maxPayload:1048576,handshakeTimeout:10000});socket=ws;
 ws.on('open',()=>{backoff=500;send(ws,{type:'hello',os:platform(),version:'0.5.0',workspace:c.workspace,allowWrite:c.allowWrite===true,allowCommands:c.allowCommands===true,capabilities:{parallelCalls:1,maxConcurrency,maxControlConcurrency}});console.log('Agent connected')});
 ws.on('message',raw=>{
  let m;try{m=JSON.parse(raw)}catch{return ws.close(1008,'Invalid message')}
  if(!m||typeof m!=='object')return ws.close(1008,'Invalid message');
  if(m.type==='cancel'){if(owners.get(m.id)===ws)dispatcher.cancel(m.id);return}
  if(m.type!=='request'||typeof m.id!=='string'||m.id.length>100||typeof m.tool!=='string')return;
  if(owners.has(m.id)||dispatcher.active.has(m.id))return;
  owners.set(m.id,ws);
  dispatcher.request(m).catch(()=>ws.terminate());
 });
 ws.on('error',()=>{});
 ws.on('close',()=>{
  for(const [id,owner] of owners)if(owner===ws){dispatcher.cancel(id);owners.delete(id)}
  if(socket===ws)sessions.disconnect();
  if(!stopping&&socket===ws){console.log('Agent disconnected; reconnecting');setTimeout(connect,backoff+Math.random()*300);backoff=Math.min(backoff*2,30000)}
 });
}
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{stopping=true;dispatcher.close();sessions.close();socket?.close();setTimeout(()=>process.exit(),1000).unref()});
connect();
