import {randomUUID} from 'node:crypto';
import {realpath,open,readdir,lstat,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,relative,sep,dirname} from 'node:path';
import {tools,MAX_OUTPUT} from '../protocol/tools.mjs';
export async function execute(root,name,input,{write=false,commands=false,signal,sessions}={}) {
 const spec=tools[name];if(!spec)throw Error('Unknown tool');const a=spec.schema.parse(input);
 signal?.throwIfAborted();root=await realpath(root);signal?.throwIfAborted();
 async function safe(p,creating=false){
  if(p.includes('\0')||p.startsWith('/')||p.split(/[\\/]/).includes('..'))throw Error('Path outside workspace');
  const target=resolve(root,p);const rel=relative(root,target);
  if(rel==='..'||rel.startsWith('..'+sep))throw Error('Path outside workspace');
  let current=root;
  for(const part of rel.split(sep).filter(Boolean)){
   current=resolve(current,part);
   try {if((await lstat(current)).isSymbolicLink())throw Error('Symlinks are not allowed')}
   catch(e){if(e.code==='ENOENT'&&creating&&current===target)break;throw e}
  }
  const parent=await realpath(creating?dirname(target):target);
  const check=relative(root,parent);if(check==='..'||check.startsWith('..'+sep))throw Error('Path outside workspace');
  return target;
 }
 if(name==='list_files'){
  const path=await safe(a.path);const dir=await import('node:fs/promises').then(m=>m.opendir(path));const entries=[];
  for await(const e of dir){entries.push({name:e.name,type:e.isSymbolicLink()?'symlink':e.isDirectory()?'directory':'file'});if(entries.length>=200)break}
  return {entries,limited:entries.length===200};
 }
 if(name==='read_file'){
  const file=await open(await safe(a.path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const stat=await file.stat();if(!stat.isFile())throw Error('Regular files only');
   const version=[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
   if(a.expectedVersion&&a.expectedVersion!==version)throw Error('File changed; restart pagination');
   const buf=Buffer.alloc(a.length);const {bytesRead}=await file.read(buf,0,buf.length,a.offset);
   const after=await file.stat();
   if([after.dev,after.ino,after.size,after.mtimeMs,after.ctimeMs].join(':')!==version)throw Error('File changed during read; restart pagination');
   const nextOffset=a.offset+bytesRead;
   return {content:buf.subarray(0,bytesRead).toString(a.encoding),encoding:a.encoding,offset:a.offset,nextOffset,size:stat.size,version,hasMore:nextOffset<stat.size,truncated:nextOffset<stat.size};
  }finally{await file.close()}
 }
 if(name==='write_file'){
  if(!write)throw Error('File writes are disabled on this device');
  if(Buffer.byteLength(a.content)>MAX_OUTPUT)throw Error('Content exceeds 64 KiB');
  const path=await safe(a.path,true);signal?.throwIfAborted();
  if(a.mode==='overwrite'){
   let existing,probe;
   try{
    probe=await open(path,constants.O_WRONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    existing=await probe.stat();
    if(!existing.isFile()||existing.nlink>1)throw Error('Regular single-link files only');
   }catch(e){if(e.code!=='ENOENT')throw e}finally{await probe?.close()}
   if(a.expectedSize!==undefined&&a.expectedSize!==(existing?.size||0))throw Error('File size changed; inspect before retrying');
   const temporary=resolve(dirname(path),'.tethershell-'+randomUUID()+'.tmp');
   let file;
   try{
    file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await file.writeFile(a.content);
    if(existing){await file.chown(existing.uid,existing.gid);await file.chmod(existing.mode&0o777)}
    await file.close();file=undefined;
    signal?.throwIfAborted();await safe(a.path,true);
    let now;try{now=await lstat(path)}catch(e){if(e.code!=='ENOENT')throw e}
    if(existing?(!now||now.dev!==existing.dev||now.ino!==existing.ino||now.size!==existing.size||now.mtimeMs!==existing.mtimeMs||now.ctimeMs!==existing.ctimeMs):!!now)throw Error('File changed; inspect before retrying');
    signal?.throwIfAborted();await rename(temporary,path);
    return {written:Buffer.byteLength(a.content),size:Buffer.byteLength(a.content),mode:a.mode};
   }finally{await file?.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e})}
  }
  const file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_NOFOLLOW|constants.O_NONBLOCK|(a.mode==='append'?constants.O_APPEND:0),0o600);
  try{const stat=await file.stat();if(!stat.isFile()||stat.nlink>1)throw Error('Regular single-link files only');if(a.expectedSize!==undefined&&a.expectedSize!==stat.size)throw Error('File size changed; inspect before retrying');if(a.mode==='overwrite')await file.truncate(0);await file.writeFile(a.content);const size=(await file.stat()).size;return {written:Buffer.byteLength(a.content),size,mode:a.mode}}finally{await file.close()}
 }
 if(!commands)throw Error('Commands are disabled on this device');
 if(!sessions)throw Error('Process session manager unavailable');
 switch(name){
  case 'run_command':case 'start_process':return sessions.start(root,a,signal);
  case 'list_sessions':return {sessions:sessions.list(),limits:sessions.limits};
  case 'read_process_output':return sessions.read(a.sessionId,a.offset,a.length,a.encoding);
  case 'interact_with_process':return sessions.input(a.sessionId,a.input,a.eof,a.wait_ms,signal);
  case 'terminate_process':return sessions.terminate(a.sessionId);
  default:throw Error('Unknown tool');
 }
}
