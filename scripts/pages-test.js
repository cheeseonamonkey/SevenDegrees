const assert=require('node:assert/strict');
const fs=require('node:fs');
const {graphClient}=require('../web/graph-client.js');

const {server,metrics}=require('./test-server')(process.argv[2]);
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const query=await graphClient(new URL('http://127.0.0.1:'+server.address().port+'/api/v1/manifest.json'));
  const stats=await query('/api/stats');
  const startup=metrics().transferred;
  assert.ok(startup<50000,'startup should load only manifest');
  assert.equal(metrics().rangeRequests,0);
  const found=await query('/api/artists',{q:'Tom Morello'});
  assert.equal(found[0].name,'Tom Morello');
  const firstSearch=metrics().transferred-startup;
  const before=metrics().transferred;
  const neighborhood=await query('/api/neighbors',{artist:found[0].id});
  assert.ok(neighborhood.total>=1&&neighborhood.steps.every(e=>e.source.startsWith('https://')));
  const mapBytes=metrics().transferred-before;
  const original=await query('/api/path',{from:'Tom Morello',to:'David Bowie'});
  assert.ok(original.found&&original.degrees<=3);
  if(stats.artist===773)assert.equal(original.degrees,3);
  const cover=await query('/api/path',{from:'The Wiggles',to:'Tame Impala'});
  assert.equal(cover.degrees,1);
  assert.ok(cover.steps[0].description.includes('Elephant'));
  const covered=await query('/api/path',{from:'The Wiggles',to:'Tame Impala',collaborations:false,memberships:false,production:false,covers:true,professional:false});
  assert.equal(covered.degrees,1);
  assert.ok(covered.steps[0].description.includes('covered'));
  const blocked=await query('/api/path',{from:'The Wiggles',to:'Tame Impala',collaborations:false,memberships:false,production:false,covers:false,professional:false});
  assert.equal(blocked.found,false);
  const induced=await query('/api/map-links',{artists:[cover.start.id,cover.steps[0].to.id],mask:8});
  assert.ok(induced.some(e=>['cover','cover-reference'].includes(e.kind)));
  assert.equal((await query('/api/map-links',{artists:[cover.start.id,cover.steps[0].to.id],mask:0})).length,0);
  const categories=await query('/api/categories');
  if(categories){
   assert.equal(Object.keys(categories).length,5);
   const empty=await query('/api/neighbors',{artist:found[0].id,mask:0});assert.equal(empty.total,0);
   const onlyCovers=await query('/api/neighbors',{artist:'The Wiggles',mask:8});
   assert.ok(onlyCovers.steps.every(s=>categories.covers.kinds.includes(s.kind)));
   const members=await query('/api/neighbors',{artist:'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d',mask:2});
   assert.ok(members.steps.some(s=>s.to.name==='John Lennon'));
   assert.ok(members.steps.every(s=>categories.memberships.kinds.includes(s.kind)));
  }
  const root={artist:found[0].id,ranking:'degree',fraction:1,depth:1,maxBranch:4,maxConnections:20};
  const web=await query('/api/generate',root);
  assert.equal(web.total,neighborhood.total);
  assert.equal(web.links.length,Math.min(web.total,4));
  const repeated=await query('/api/generate',root);
  assert.deepEqual(repeated.links,web.links);
  const zero=await query('/api/generate',{...root,fraction:0,depth:3});
  assert.equal(zero.links.length,0);assert.equal(zero.total,web.total);
  const decay=await query('/api/generate',{...root,depth:3,decay:0});
  assert.deepEqual(decay.links,web.links);
  const limited=await query('/api/generate',{...root,depth:3,maxConnections:3});
  assert.ok(limited.links.length<=3);
  const filtered=await query('/api/generate',{...root,mask:0});
  assert.equal(filtered.links.length,0);assert.equal(filtered.total,0);
  const ids=[web.root.id,...web.links.map(e=>e.to.id)];
  const extra=await query('/api/map-links',{artists:ids,existing:web.links.map(e=>[e.from.id,e.to.id]),ranking:'balanced',fraction:1,maxConnections:3});
  assert.ok(extra.length<=3);
  assert.ok(extra.every(e=>!web.links.some(x=>[x.from.id,x.to.id].includes(e.from.id)&&[x.from.id,x.to.id].includes(e.to.id))));
  console.log('Ranked web generation passed',web.links.length,'links');
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
  assert.equal(metrics().fullPacks,0,'No complete pack downloads');
  assert.ok(metrics().rangeRequests>0);
  console.log(JSON.stringify({stats,startup_bytes:startup,artist_search_bytes:firstSearch,neighborhood_bytes:mapBytes,total_bytes:metrics().transferred,range_requests:metrics().rangeRequests},null,2));
 }finally{server.close()}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
