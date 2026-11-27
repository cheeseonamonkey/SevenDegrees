// Numeric CSR adjacency, with shared evidence and string dictionaries.
function localGraph(data) {
 if(data.version!==2)throw Error('Unsupported graph snapshot');
 const {artists,strings,evidence}=data;
 const offsets=Uint32Array.from(data.offsets),adjacency=Uint32Array.from(data.adjacency);
 delete data.offsets;delete data.adjacency;
 const norm=s=>s.trim().toLocaleLowerCase('en');
 const byID=new Map(artists.map((a,i)=>[a.id,i]));
 const names=artists.map(a=>[...new Set([a.name,...(a.aliases||[])].map(norm))]);
 const byName=new Map();
 names.forEach((list,i)=>list.forEach(n=>{const matches=byName.get(n)||[];matches.push(i);byName.set(n,matches)}));
 const resolve=s=>{
  if(byID.has(s))return byID.get(s);
  const matches=byName.get(norm(s))||[];
  if(matches.length!==1)throw Error(matches.length?'Ambiguous artist; choose from suggestions.':'Artist not found in this snapshot.');
  return matches[0];
 };
 const simple=i=>({id:artists[i].id,name:artists[i].name});
 const search=q=>{
  q=norm(q);if(!q)return [];
  const found=[];
  names.forEach((list,i)=>{if(list.some(n=>n.includes(q)))found.push(i)});
  return found.sort((a,b)=>Number(norm(artists[b].name)===q)-Number(norm(artists[a].name)===q)||artists[a].name.length-artists[b].name.length||artists[a].name.localeCompare(artists[b].name)||artists[a].id.localeCompare(artists[b].id)).slice(0,20).map(simple);
 };
 const step=(to,w)=>{const [k,t,s]=evidence[w];return {to:simple(to),kind:strings[k],title:strings[t],source:strings[s]}};
 const neighbors=(name,strict=false,limit=40)=>{
  const root=resolve(name),seen=new Set(),steps=[];
  for(let j=offsets[root];j<offsets[root+1];j+=2){
   const to=adjacency[j],w=adjacency[j+1];
   if(seen.has(to)||(strict&&!evidence[w][3]))continue;
   seen.add(to);if(steps.length<limit)steps.push(step(to,w));
  }
  return {root:simple(root),total:seen.size,steps};
 };
 const path=(from,to,strict)=>{
  const start=resolve(from),end=resolve(to);
  const result=(found,steps)=>({found,start:simple(start),steps,degrees:steps.length});
  if(start===end)return result(true,[]);
  // Typed predecessor vectors keep per-query memory proportional to artists,
  // and avoid materializing edge objects until a path is reconstructed.
  const front=i=>{const prev=new Int32Array(artists.length).fill(-1);prev[i]=i;return {nodes:[i],prev,via:new Int32Array(artists.length),depth:0}};
  const left=front(start),right=front(end);
  while(left.nodes.length&&right.nodes.length&&left.depth+right.depth<7){
   const [a,b]=left.nodes.length<=right.nodes.length?[left,right]:[right,left];
   const next=[];let meet=-1;
   outer:for(const i of a.nodes){
    for(let j=offsets[i];j<offsets[i+1];j+=2){
     const dest=adjacency[j],w=adjacency[j+1];
     if(a.prev[dest]!==-1||(strict&&!evidence[w][3]))continue;
     a.prev[dest]=i;a.via[dest]=w;next.push(dest);
     if(b.prev[dest]!==-1){meet=dest;break outer}
    }
   }
   if(meet!==-1){
    const steps=[];
    for(let i=meet;i!==start;i=left.prev[i])steps.push(step(i,left.via[i]));
    steps.reverse();
    for(let i=meet;i!==end;i=right.prev[i])steps.push(step(right.prev[i],right.via[i]));
    return result(true,steps);
   }
   a.nodes=next;a.depth++;
  }
  return result(false,[]);
 };
 return {search,path,neighbors,stats:()=>({artist:artists.length,fact:data.facts})};
}
if(typeof module!=='undefined')module.exports={localGraph};
