importScripts('graph.js','graph-client.js');
let client;
const active=new Map();
self.onmessage=async ({data:{id,path,params,cancel}})=>{
 if(cancel!==undefined){const state=active.get(cancel);if(state)state.cancelled=true;return}
 const state={cancelled:false};active.set(id,state);
 try{
  client ||= graphClient(new URL('api/v1/manifest.json',self.location.href)).catch(e=>{client=undefined;throw e});
  const value=await (await client)(path,params,progress=>{
   if(state.cancelled)throw Error('Cancelled');
   self.postMessage({id,progress})
  });
  if(!state.cancelled)self.postMessage({id,value});
 }catch(e){if(!state.cancelled)self.postMessage({id,error:e.message})}
 finally{active.delete(id)}
};
