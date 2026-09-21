import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

const repo=new URL('../',import.meta.url).pathname;
const realNode=process.execPath;

async function executable(path,content){
 await writeFile(path,content,{mode:0o755});
 await chmod(path,0o755);
}

function run(script,env){
 return new Promise((resolve,reject)=>{
  const child=spawn('sh',[script],{cwd:repo,env:{...process.env,...env}});
  let stdout='',stderr='';
  child.stdout.on('data',d=>stdout+=d);
  child.stderr.on('data',d=>stderr+=d);
  child.on('error',reject);
  child.on('close',code=>resolve({code,stdout,stderr}));
 });
}

test('installer pairs with full agent permissions and is idempotent',async()=>{
 const root=await mkdtemp(join(tmpdir(),'tethershell-install-'));
 try{
  const bin=join(root,'bin'),install=join(root,'agent'),workspace=join(root,'workspace');
  const config=join(root,'config','agent.json'),service=join(root,'tethershell-agent.service');
  const pairLog=join(root,'pair.log'),systemctlLog=join(root,'systemctl.log');
  await mkdir(join(install,'.git'),{recursive:true});
  await mkdir(bin,{recursive:true});

  await executable(join(bin,'git'),'#!/bin/sh\nexit 0\n');
  await executable(join(bin,'npm'),'#!/bin/sh\nexit 0\n');
  await executable(join(bin,'systemctl'),'#!/bin/sh\necho "$*" >> "$SYSTEMCTL_LOG"\nexit 0\n');
  await executable(join(bin,'node'),`#!/bin/sh
if [ "\$1" = "apps/agent/pair.mjs" ]; then
  echo "\$*" > "\$PAIR_LOG"
  while [ "\$#" -gt 0 ]; do
    if [ "\$1" = "--config" ]; then shift; mkdir -p "\$(dirname "\$1")"; printf '{}\\n' > "\$1"; break; fi
    shift
  done
  exit 0
fi
exec "${realNode}" "\$@"
`);

  const env={
   PATH:bin+':'+process.env.PATH,
   PAIR_LOG:pairLog,
   SYSTEMCTL_LOG:systemctlLog,
   TETHERSHELL_INSTALL_DIR:install,
   TETHERSHELL_CONFIG:config,
   TETHERSHELL_WORKSPACE:workspace,
   TETHERSHELL_SERVICE_FILE:service
  };
  const first=await run(join(repo,'install.sh'),env);
  assert.equal(first.code,0,first.stderr);
  assert.match(first.stdout,/File writes:\s+enabled/);
  assert.match(first.stdout,/Commands:\s+enabled/);
  const pair=await readFile(pairLog,'utf8');
  assert.match(pair,/--gateway https:\/\/mcp\.tethershell\.com/);
  assert.match(pair,/--allow-write/);
  assert.match(pair,/--allow-commands/);
  const unit=await readFile(service,'utf8');
  assert.match(unit,/Environment=TETHERSHELL_AGENT_CONFIG=/);
  assert.match(unit,/Restart=on-failure/);

  await writeFile(pairLog,'not-called\n');
  const second=await run(join(repo,'install.sh'),env);
  assert.equal(second.code,0,second.stderr);
  assert.match(second.stdout,/Existing configuration found/);
  assert.equal(await readFile(pairLog,'utf8'),'not-called\n');
 }finally{
  await rm(root,{recursive:true,force:true});
 }
});

test('installer rejects a config inside the exposed workspace',async()=>{
 const root=await mkdtemp(join(tmpdir(),'tethershell-install-boundary-'));
 try{
  const result=await run(join(repo,'install.sh'),{
   TETHERSHELL_INSTALL_DIR:join(root,'agent'),
   TETHERSHELL_WORKSPACE:root,
   TETHERSHELL_CONFIG:join(root,'private','agent.json'),
   TETHERSHELL_SERVICE_FILE:join(root,'service')
  });
  assert.notEqual(result.code,0);
  assert.match(result.stderr,/must be outside TETHERSHELL_WORKSPACE/);
 }finally{
  await rm(root,{recursive:true,force:true});
 }
});
