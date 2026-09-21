import {Admission,positive,toolDeadline,errorPayload} from '../../packages/protocol/concurrency.mjs';
export function createDispatcher(config,execute,send) {
 const max=positive(config.maxConcurrency,4,'maxConcurrency',64);
 const control=positive(config.maxControlConcurrency,1,'maxControlConcurrency',8);
 const timeouts=config.toolTimeoutMs||{};
 for(const [name,value] of Object.entries(timeouts))positive(value,1,'toolTimeoutMs.'+name,60000);
 const admission=new Admission({device:max,user:max,global:max,controlDevice:control,controlUser:control,controlGlobal:control});
 const active=new Map();
 return {
  active,admission,
  cancel(id){active.get(id)?.controller.abort()},
  close(){for(const r of active.values())r.controller.abort()},
  async request(m){
   if(typeof m.id!=='string'||m.id.length>100||typeof m.tool!=='string')return;
   // Do not replay an in-flight operation with the same ID.
   if(active.has(m.id))return;
   let release;
   try{release=admission.acquire('local','local',m.tool)}catch(e){send({type:'result',id:m.id,error:errorPayload(e)});return}
   const controller=new AbortController();
   const local=toolDeadline(m.tool,m.arguments,timeouts);
   const budget=Number.isFinite(m.budgetMs)?Math.max(1,Math.min(local,m.budgetMs)):local;
   const record={controller};active.set(m.id,record);
   const timer=setTimeout(()=>controller.abort(),budget);timer.unref();
   try{
    const result=await execute(m.tool,m.arguments,controller.signal);
    send({type:'result',id:m.id,result});
   }catch(e){send({type:'result',id:m.id,error:e.code&&e.code!=='CAPACITY_EXCEEDED'?{code:'EXECUTION_FAILED',message:'Filesystem operation failed ('+e.code+')',retryable:false}:errorPayload(e)})}
   finally{clearTimeout(timer);if(active.get(m.id)===record)active.delete(m.id);release()}
  }
 };
}
