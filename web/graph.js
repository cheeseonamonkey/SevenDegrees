// Browser-side traversal over the Go engine's exported, role-aware edges.
function localGraph(data) {
 const byID=new Map(data.artists.map(a=>[a.id,a]));
 const norm=s=>s.trim().toLocaleLowerCase('en');
 const names=a=>[a.name,...a.aliases].map(norm);
 const resolve=s=>{
  if(byID.has(s))return byID.get(s);
  const matches=data.artists.filter(a=>names(a).includes(norm(s)));
  if(matches.length!==1)throw Error(matches.length?'Ambiguous artist; choose from suggestions.':'Artist not found in this snapshot.');
  return matches[0];
 };
 const simple=a=>({id:a.id,name:a.name});
 const search=q=>data.artists.filter(a=>names(a).some(n=>n.includes(norm(q))))
  .sort((a,b)=>Number(norm(b.name)===norm(q))-Number(norm(a.name)===norm(q))||a.name.length-b.name.length||a.name.localeCompare(b.name)||a.id.localeCompare(b.id)).slice(0,20).map(simple);
 const path=(from,to,strict)=>{
  const start=resolve(from),end=resolve(to),queue=[{id:start.id,depth:0}],previous=new Map([[start.id,null]]);
  for(let i=0;i<queue.length;i++){
   const {id,depth}=queue[i];
   if(id===end.id){const steps=[];for(let cur=id;cur!==start.id;){const p=previous.get(cur);steps.push(p.step);cur=p.from}steps.reverse();return {found:true,start:simple(start),steps,degrees:steps.length}}
   if(depth>=7)continue;
   for(const step of data.edges[id]||[]){
    if(strict&&['cover','cover-reference','tribute'].includes(step.kind))continue;
    if(previous.has(step.to.id))continue;
    previous.set(step.to.id,{from:id,step});queue.push({id:step.to.id,depth:depth+1});
   }
  }
  return {found:false,start:simple(start),steps:[],degrees:0};
 };
 return {search,path,stats:()=>({artist:data.artists.length,fact:data.facts})};
}
if(typeof module!=='undefined')module.exports={localGraph};
