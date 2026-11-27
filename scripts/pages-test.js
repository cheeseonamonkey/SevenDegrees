const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {graphClient}=require('../web/graph-client.js');

const root=path.resolve(process.argv[2]);
let transferred=0,rangeRequests=0,fullPacks=0;
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return}
 const size=fs.statSync(file).size,range=req.headers.range;
 let start=0,end=size-1;
 if(range){
  const m=/^bytes=(\d+)-(\d+)$/.exec(range);
  if(!m||Number(m[2])>=size||Number(m[1])>Number(m[2])){res.writeHead(416).end();return}
  start=Number(m[1]);end=Number(m[2]);rangeRequests++;
  res.writeHead(206,{'Content-Range':'bytes '+start+'-'+end+'/'+size,'Content-Length':end-start+1});
 }else{
  if(file.endsWith('.bin'))fullPacks++;
  res.writeHead(200,{'Content-Length':size});
 }
 transferred+=end-start+1;
 fs.createReadStream(file,{start,end}).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const query=await graphClient(new URL('http://127.0.0.1:'+server.address().port+'/api/v1/manifest.json'));
  const stats=await query('/api/stats');
  const startup=transferred;
  assert.ok(startup<50000,'startup should load only manifest');
  assert.equal(rangeRequests,0);
  const found=await query('/api/artists',{q:'Tom Morello'});
  assert.equal(found[0].name,'Tom Morello');
  const firstSearch=transferred-startup;
  const before=transferred;
  const neighborhood=await query('/api/neighbors',{artist:found[0].id});
  assert.ok(neighborhood.total>=1&&neighborhood.steps.every(e=>e.source.startsWith('https://')));
  const mapBytes=transferred-before;
  const original=await query('/api/path',{from:'Tom Morello',to:'David Bowie'});
  assert.ok(original.found&&original.degrees<=3);
  if(stats.artist===773)assert.equal(original.degrees,3);
  const cover=await query('/api/path',{from:'The Wiggles',to:'Tame Impala'});
  assert.equal(cover.degrees,1);
  const same=await query('/api/path',{from:'David Bowie',to:'David Bowie'});
  assert.equal(same.degrees,0);
  const shared=await query('/api/evidence',{artist:'The Wiggles',other:'Tame Impala'});
  assert.ok(shared.total>=1&&shared.records.some(f=>f.title.toLowerCase().includes('elephant')));
  assert.ok(shared.records.every(f=>f.participants.length>=2&&f.source.startsWith('https://')));
  if(stats.artist===773){
   const strict=await query('/api/path',{from:'The Wiggles',to:'Tame Impala',strict:true});
   assert.equal(strict.found,false);
   // Round-trip all canonical seed facts for a selected artist, preserving roles and names.
   const source=new Map();
   for(const file of fs.readdirSync('corpus').filter(s=>s.endsWith('.jsonl')).sort()){
    for(const line of fs.readFileSync('corpus/'+file,'utf8').trim().split('\n')){
     if(line){const f=JSON.parse(line);source.set(f.id,f)}
    }
   }
   const expected=[...source.values()].filter(f=>f.participants.some(a=>a.id===found[0].id));
   const all=[];let offset=0;
   do{const p=await query('/api/evidence',{artist:found[0].id,offset});all.push(...p.records.map(({ref,...f})=>f));offset=p.next}while(offset!==null);
   assert.deepEqual(all.sort((a,b)=>a.id.localeCompare(b.id)),expected.sort((a,b)=>a.id.localeCompare(b.id)));
  }
  assert.equal(fullPacks,0,'No complete pack downloads');
  assert.ok(rangeRequests>0);
  console.log(JSON.stringify({stats,startup_bytes:startup,artist_search_bytes:firstSearch,neighborhood_bytes:mapBytes,total_bytes:transferred,range_requests:rangeRequests},null,2));
 }finally{server.close()}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
