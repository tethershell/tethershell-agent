// Shared, conservative tool classes. Unknown operations are mutations.
export function operationClass(tool) {
 if(tool==='terminate_process')return 'control';
 if(['list_devices','list_files','read_file','read_process_output','list_sessions'].includes(tool))return 'read';
 return 'mutation';
}
export class CapacityError extends Error {
 constructor(scope, retryAfterMs=1000) {
  super('Capacity exceeded ('+scope+'); operation was not dispatched.');
  this.code='CAPACITY_EXCEEDED';this.scope=scope;this.retryable=true;this.retryAfterMs=retryAfterMs;
 }
}
export function errorPayload(e) {
 return {code:e.code||'EXECUTION_FAILED',message:e.message, ...(e.scope?{scope:e.scope}:{}),
  retryable:e.retryable===true,...(e.retryAfterMs?{retryAfterMs:e.retryAfterMs}:{})};
}
export function positive(value,fallback,name,max=10000) {
 const n=value===undefined?fallback:Number(value);
 if(!Number.isInteger(n)||n<1||n>max)throw Error(name+' must be an integer from 1 to '+max);
 return n;
}
export const defaults={device:4,user:8,global:64,controlDevice:1,controlUser:2,controlGlobal:8};
export class Admission {
 constructor(options={}) {
  this.limits=Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,positive(options[k],v,k)]));
  this.devices=new Map();this.users=new Map();this.active=0;this.control=0;this.rejected={};
 }
 reject(scope,kind){const key=scope+':'+kind;this.rejected[key]=(this.rejected[key]||0)+1;throw new CapacityError(scope)}
 acquire(user,device,tool,{legacy=false,deviceLimit=this.limits.device}={}) {
  const kind=operationClass(tool),control=kind==='control';
  const u=this.users.get(user)||{active:0,control:0};
  const d=this.devices.get(device)||{active:0,control:0,mutation:0};
  if(legacy&&device&&(d.active+d.control)>0)this.reject('device',kind);
  if(control) {
   if(this.control>=this.limits.controlGlobal)this.reject('gateway',kind);
   if(u.control>=this.limits.controlUser)this.reject('user',kind);
   if(device&&d.control>=this.limits.controlDevice)this.reject('device',kind);
  } else {
   if(this.active>=this.limits.global)this.reject('gateway',kind);
   if(u.active>=this.limits.user)this.reject('user',kind);
   if(device&&d.active>=Math.min(this.limits.device,deviceLimit,legacy?1:Infinity))this.reject('device',kind);
   if(device&&kind==='mutation'&&d.mutation)this.reject('mutation',kind);
  }
  const key=control?'control':'active';
  this[key]++;u[key]++;this.users.set(user,u);
  if(device){d[key]++;if(kind==='mutation')d.mutation++;this.devices.set(device,d)}
  let released=false;
  return ()=>{if(released)return;released=true;this[key]--;u[key]--;
   if(device){d[key]--;if(kind==='mutation')d.mutation--;if(!d.active&&!d.control)this.devices.delete(device)}
   if(!u.active&&!u.control)this.users.delete(user);
  };
 }
 snapshot(){return {active:this.active,control:this.control,devices:this.devices.size,users:this.users.size,rejected:{...this.rejected},limits:this.limits}}
}
export function toolDeadline(tool,args={},overrides={}) {
 const kind=operationClass(tool);
 const fallback=kind==='control'?3000:kind==='read'?10000:15000;
 const configured=positive(overrides[tool],fallback,'toolTimeoutMs.'+tool,60000);
 const wait=['run_command','start_process','interact_with_process'].includes(tool)?Math.min(5000,Math.max(0,Number(args.wait_ms??1000)||0)):0;
 return Math.min(60000,Math.max(configured,wait+2000));
}
// Bounded token buckets; idle entries expire. Never evict active users to reset their budget.
export class UserRates {
 constructor({perMinute=120,burst=20,controlPerMinute=60,controlBurst=10,maxEntries=10000}={}) {
  this.options={ordinary:[perMinute,burst],control:[controlPerMinute,controlBurst]};
  for(const [kind,values] of Object.entries(this.options))for(const value of values)positive(value,1,kind+' rate',100000);
  this.maxEntries=maxEntries;this.entries=new Map();this.rejected={ordinary:0,control:0};
 }
 sweep(now=Date.now()){for(const [key,b] of this.entries)if(now-b.updated>120000)this.entries.delete(key)}
 take(user,tool,now=Date.now()){
  const kind=operationClass(tool)==='control'?'control':'ordinary',key=user+':'+kind;
  const [rate,burst]=this.options[kind];let b=this.entries.get(key);
  if(!b){if(this.entries.size>=this.maxEntries)this.sweep(now);if(this.entries.size>=this.maxEntries)throw new CapacityError('gateway');b={tokens:burst,updated:now}}
  b.tokens=Math.min(burst,b.tokens+(now-b.updated)*rate/60000);b.updated=now;this.entries.set(key,b);
  if(b.tokens<1){this.rejected[kind]++;const e=new CapacityError('user',Math.ceil((1-b.tokens)*60000/rate));e.code='RATE_LIMITED';throw e}
  b.tokens--;
 }
}
