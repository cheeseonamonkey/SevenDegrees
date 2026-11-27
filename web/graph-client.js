// Shared client for Pages, the worker and the local MCP adapter.
async function graphClient(manifestURL) {
 const json=async url=>{const r=await fetch(url);if(!r.ok)throw Error('Graph API: '+r.status);return r.json()};
 const manifest=await json(manifestURL);
 const descriptor=scope=>scope==='full'?manifest.full:{...manifest.graph,stats:manifest.stats};
 let activeScope,active;
 async function load(scope){
  const d=descriptor(scope);if(!d)throw Error('Full graph is not published yet.');
  if(scope!==activeScope||!active){
   activeScope=scope;
   active=(async()=>{
    const parts=d.parts||[{url:d.url}],decoder=new DecompressionStream('gzip');
    let i=0,reader;
    const compressed=new ReadableStream({async pull(controller){
     while(true){
      if(!reader){
       if(i===parts.length){controller.close();return}
       const r=await fetch(new URL(parts[i++].url,manifestURL));if(!r.ok)throw Error('Graph download failed: '+r.status);
       reader=r.body.getReader();
      }
      const chunk=await reader.read();
      if(!chunk.done){controller.enqueue(chunk.value);return}
      reader.releaseLock();reader=undefined;
     }
    },cancel(){return reader?.cancel()}});
    const data=await new Response(compressed.pipeThrough(decoder)).json();
    return localGraph(data);
   })().catch(e=>{if(activeScope===scope)active=undefined;throw e});
  }
  return active;
 }
 return async (path,params={})=>{
  const scope=params.scope||'priority',d=descriptor(scope);
  if(path==='/api/stats'){if(!d)throw Error('Graph unavailable');return d.stats}
  const g=await load(scope);
  switch(path){
   case '/api/artists':return g.search(params.q);
   case '/api/path':return g.path(params.from,params.to,params.strict);
   case '/api/neighbors':return g.neighbors(params.artist,params.strict,params.offset);
   default:throw Error('Unknown graph operation');
  }
 };
}
if(typeof module!=='undefined'){globalThis.localGraph=require('./graph.js').localGraph;module.exports={graphClient}}
