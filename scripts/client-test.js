const assert=require('node:assert/strict');
const {graphClient}=require('../web/graph-client.js');
(async()=>{
 const query=await graphClient(new URL(process.argv[2]));
 const stats=await query('/api/stats');
 assert.ok(stats.artist>=773);
 assert.ok((await query('/api/artists',{q:'Tom Morello'})).some(a=>a.name==='Tom Morello'));
 const path=await query('/api/path',{from:'Tom Morello',to:'David Bowie'});
 assert.ok(path.found&&path.degrees<=3);
 const neighborhood=await query('/api/neighbors',{artist:'Tom Morello'});
 assert.ok(neighborhood.total>=1&&neighborhood.steps.every(e=>e.source.startsWith('https://')));
 console.log(stats,'HTTP client passed');
})().catch(e=>{console.error(e);process.exitCode=1});
