importScripts('graph.js','graph-client.js');
let client;
self.onmessage=async ({data:{id,path,params}})=>{
 try{
  client ||= graphClient(new URL('api/v1/manifest.json',self.location.href)).catch(e=>{client=undefined;throw e});
  const value=await (await client)(path,params);
  self.postMessage({id,value});
 }catch(e){self.postMessage({id,error:e.message})}
};
