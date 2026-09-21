import {parseArgs} from 'node:util';
import {randomBytes,createHash} from 'node:crypto';
import {hostname,platform} from 'node:os';
import {realpath,mkdir,writeFile,access} from 'node:fs/promises';
import {resolve,dirname,relative,sep,basename} from 'node:path';
const {values:v}=parseArgs({options:{gateway:{type:'string'},workspace:{type:'string'},config:{type:'string'},name:{type:'string'},'allow-write':{type:'boolean'},'allow-commands':{type:'boolean'}}});
if(!v.gateway||!v.workspace||!v.config)throw Error('Required: --gateway URL --workspace PATH --config PATH');
const url=new URL(v.gateway);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('HTTPS required');
const workspace=await realpath(v.workspace);
await mkdir(dirname(resolve(v.config)),{recursive:true,mode:0o700});
const config=resolve(await realpath(dirname(resolve(v.config))),basename(v.config)),rel=relative(workspace,config);
if(rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'))throw Error('Store the agent config outside the workspace');
try{await access(config);throw Error('Configuration already exists; choose another path')}catch(e){if(e.code!=='ENOENT')throw e}
const token=randomBytes(32).toString('base64url');
const post=async(path,body)=>fetch(new URL(path,url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
const response=await post('/pair/start',{tokenHash:createHash('sha256').update(token).digest('hex'),name:v.name||hostname(),os:platform()});
if(!response.ok)throw Error('Unable to start pairing ('+response.status+')');
const pairing=await response.json();
console.log('Open '+pairing.verificationUri+' and sign in.\nPairing code: '+pairing.code+'\nExpires in five minutes. Workspace: '+workspace);
const deadline=Date.now()+pairing.expiresIn*1000;
while(Date.now()<deadline){
 await new Promise(r=>setTimeout(r,3000));
 const result=await post('/pair/poll',{pollToken:pairing.pollToken});if(result.status===202)continue;
 if(!result.ok)throw Error('Pairing expired or failed; run the command again');
 const {deviceId}=await result.json();
 await mkdir(dirname(config),{recursive:true,mode:0o700});
 await writeFile(config,JSON.stringify({gateway:url.origin,deviceId,token,workspace,allowWrite:!!v['allow-write'],allowCommands:!!v['allow-commands']},null,2),{mode:0o600,flag:'wx'});
 console.log('Paired. Start with: node apps/agent/index.mjs '+config);process.exit(0);
}
throw Error('Pairing expired');
