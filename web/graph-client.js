// Range-addressable static API. Independent gzip members, bounded concurrent
// requests, in-flight deduplication and an LRU cache shared by all operations.
async function graphClient(manifestURL){
 const read=async(url,options)=>{const r=await fetch(url,options);if(!r.ok)throw Error('Graph API: '+r.status);return r};
 const manifest=await (await read(manifestURL)).json();
 if(manifest.layout!=='range-v1')throw Error('The lazy graph index is not deployed yet.');
 const url=p=>new URL(p,manifestURL);
 const unzip=async bytes=>new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
 const indexes=new Map(),directories=new Map(),cache=new Map(),pending=new Map(),queue=[];
 let running=0,weight=0;
 const schedule=fn=>new Promise((resolve,reject)=>{queue.push({fn,resolve,reject});pump()});
 function pump(){
  while(running<8&&queue.length){
   const t=queue.shift();running++;
   Promise.resolve().then(t.fn).then(t.resolve,t.reject).finally(()=>{running--;pump()});
  }
 }
 function resource(path){
  if(!directories.has(path))directories.set(path,schedule(async()=>unzip(await (await read(url(path))).arrayBuffer())).catch(e=>{directories.delete(path);throw e}));
  return directories.get(path);
 }
 function directory(name){const d=manifest[name];return typeof d==='string'?resource(d):Promise.resolve(d)}
 function index(section){
  if(!indexes.has(section)){
   const d=manifest.sections[section];
   if(!d)throw Error('Unknown data section');
   indexes.set(section,schedule(async()=>unzip(await (await read(url(d.index))).arrayBuffer())).catch(e=>{indexes.delete(section);throw e}));
  }
  return indexes.get(section);
 }
 function remember(key,data,bytes){
  cache.set(key,{data,bytes});weight+=bytes;
  while(weight>8*1024*1024&&cache.size>1){const [k,v]=cache.entries().next().value;cache.delete(k);weight-=v.bytes}
 }
 async function blocks(section,ids){
  if(!ids.length)return [];
  const d=manifest.sections[section],idx=await index(section),jobs=new Map(),fresh=[];
  for(const i of new Set(ids)){
   const key=section+':'+i;
   if(cache.has(key)){const v=cache.get(key);cache.delete(key);cache.set(key,v);jobs.set(i,Promise.resolve(v.data));continue}
   if(pending.has(key)){jobs.set(i,pending.get(key));continue}
   const record=idx[i];if(!record)throw Error('Invalid graph block '+key);
   fresh.push({i,key,pack:record[0],start:record[1],size:record[2]});
  }
  fresh.sort((a,b)=>a.pack-b.pack||a.start-b.start);
  const groups=[];
  for(const f of fresh){
   const g=groups[groups.length-1],end=f.start+f.size;
   // Coalesce only close ranges; avoid hauling unrelated megabytes.
   if(g&&g.pack===f.pack&&f.start-g.end<=8192&&end-g.start<=262144){g.members.push(f);g.end=end}
   else groups.push({pack:f.pack,start:f.start,end,members:[f]});
  }
  for(const g of groups){
   const request=schedule(async()=>{
    const r=await read(url(d.packs[g.pack]),{headers:{Range:'bytes='+g.start+'-'+(g.end-1)}});
    if(r.status!==206){await r.body?.cancel();throw Error('Static host does not support byte-range reads');}
    const bytes=await r.arrayBuffer();
    if(bytes.byteLength!==g.end-g.start)throw Error('Truncated graph block');
    const range=r.headers.get('content-range');
    if(range&&!range.startsWith('bytes '+g.start+'-'+(g.end-1)+'/'))throw Error('Incorrect graph byte range');
    return bytes;
   });
   for(const f of g.members){
    const job=request.then(bytes=>unzip(bytes.slice(f.start-g.start,f.start-g.start+f.size))).then(data=>{remember(f.key,data,f.size);return data}).finally(()=>pending.delete(f.key));
    pending.set(f.key,job);jobs.set(f.i,job);
   }
  }
  return Promise.all(ids.map(i=>jobs.get(i)));
 }
 async function rows(section,ids){
  if(!ids.length)return [];
  const n=manifest.sections[section].block_size;
  const keys=ids.map(i=>Math.floor(i/n)),data=await blocks(section,keys);
  return ids.map((i,j)=>data[j][i%n]);
 }
 const graph=createGraph({manifest,blocks,rows,directory,resource});
 return async(path,params={},progress)=>{
  switch(path){
   case '/api/stats':return graph.stats();
   case '/api/categories':return manifest.categories||null;
   case '/api/atlas':return manifest.atlas?resource(manifest.atlas):null;
   case '/api/profile':return graph.profile(params.artist,params.offset,params.year,progress,params.mask);
   case '/api/artists':return graph.search(params.q,progress);
   case '/api/path':return graph.path(params.from,params.to,params.mask??params.strict,progress);
   case '/api/neighbors':return graph.neighbors(params.artist,params.mask??params.strict,params.offset,progress);
   case '/api/evidence':return graph.evidence(params.artist,params.other,params.offset,progress);
   default:throw Error('Unknown graph operation');
  }
 };
}
if(typeof module!=='undefined'){globalThis.createGraph=require('./graph.js').createGraph;module.exports={graphClient}}
