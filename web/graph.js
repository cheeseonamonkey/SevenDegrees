// Graph algorithms operate on a storage adapter. No transport or eager graph load.
function createGraph(store){
 const {manifest,rows,blocks,directory}=store;
 const norm=s=>s.normalize('NFKC').toLowerCase().trim();
 const key=s=>Array.from(new TextEncoder().encode(Array.from(s).slice(0,2).join('')),x=>x.toString(16).padStart(2,'0')).join('');
 const simple=a=>({id:a.id,name:a.name});
 const artist=async i=>simple((await rows('artist',[i]))[0]);
 async function candidates(q,progress=()=>{}){
  const range=(await directory("search_directory"))[key(q)];
  if(!range)return [];
  const [first,count]=range,result=[];
  for(let i=0;i<count;i+=16){
   progress({message:"Finding artists",visited:result.length});
   const batch=await blocks('search',Array.from({length:Math.min(16,count-i)},(_,j)=>first+i+j));
   for(const block of batch)for(const row of block){
    const names=[row[2],...row[3]].map(norm);
    if(names.some(n=>n.startsWith(q)||n.split(/\s+/).some((_,i,a)=>a.slice(i).join(' ').startsWith(q))))result.push(row);
   }
  }
  return result;
 }
 async function search(q,progress){
  q=norm(q);if(!q)return [];
  const found=await candidates(q,progress);
  return found.sort((a,b)=>Number(norm(b[2])===q)-Number(norm(a[2])===q)||a[4]-b[4]||a[2].length-b[2].length||a[2].localeCompare(b[2])||a[1].localeCompare(b[1])).slice(0,20).map(r=>({id:r[1],name:r[2]}));
 }
 async function resolve(value,progress){
  const id=value.trim(),q=norm(id);
  if(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)){
   const starts=await directory("artist_starts");
   let lo=0,hi=starts.length;
   while(lo<hi){const mid=(lo+hi)>>>1;if(starts[mid]<=q)lo=mid+1;else hi=mid}
   if(lo){const block=(await blocks('artist',[lo-1]))[0];const i=block.findIndex(a=>a.id===q);if(i>=0)return (lo-1)*manifest.sections.artist.block_size+i}
  }
  const found=(await candidates(q,progress)).filter(r=>[r[2],...r[3]].some(n=>norm(n)===q));
  if(found.length!==1)throw Error(found.length?'Ambiguous artist; choose a search result.':'Artist not found.');
  return found[0][0];
 }
 async function hydrate(pairs){
  const [people,witnesses]=await Promise.all([rows('artist',pairs.map(p=>p[0])),rows('witness',pairs.map(p=>p[1]>>>1))]);
  return people.map((a,i)=>{const [kind,title,source]=witnesses[i];return {to:simple(a),kind,title,source}});
 }
 async function neighbors(name,strict=false,offset=0,progress){
  if(!Number.isInteger(offset)||offset<0)throw Error('Invalid neighbor offset');
  const root=await resolve(name,progress);
  const [row]=await rows('topology',[root]);
  const seen=new Set(),pairs=[];
  for(let i=0;i<row.length;i+=2){
   const to=row[i],w=row[i+1];if(seen.has(to)||(strict&&!(w&1)))continue;
   seen.add(to);if(seen.size>offset&&pairs.length<40)pairs.push([to,w]);
  }
  const [a,steps]=await Promise.all([artist(root),hydrate(pairs)]);
  return {root:a,total:seen.size,steps,next:offset+steps.length<seen.size?offset+steps.length:null};
 }
 async function path(from,to,strict=false,progress=()=>{}){
  const [start,end]=await Promise.all([resolve(from,progress),resolve(to,progress)]);
  const result=async(found,pairs)=>({found,start:await artist(start),steps:await hydrate(pairs),degrees:pairs.length});
  if(start===end)return result(true,[]);
  const front=i=>({nodes:[i],prev:new Map([[i,{from:i,depth:0}]]),depth:0});
  const left=front(start),right=front(end);
  const size=manifest.sections.topology.block_size;
  while(left.nodes.length&&right.nodes.length&&left.depth+right.depth<12){
   const [a,b]=left.nodes.length<=right.nodes.length?[left,right]:[right,left];
   const groups=new Map();
   for(const i of a.nodes){const k=Math.floor(i/size);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(i)}
   const keys=[...groups.keys()].sort((x,y)=>x-y),next=[];
   let meet=-1;
   // Both frontiers contain complete BFS layers in an undirected graph.
   // The first intersection in this layer is a shortest path.
   scan:for(let pos=0;pos<keys.length;pos+=24){
    progress({message:'Searching connections',visited:left.prev.size+right.prev.size,blocks:pos,total:keys.length});
    const batch=keys.slice(pos,pos+24),data=await blocks('topology',batch);
    for(let j=0;j<batch.length;j++)for(const i of groups.get(batch[j])){
     const row=data[j][i%size];
     for(let k=0;k<row.length;k+=2){
      const dest=row[k],w=row[k+1];
      if(a.prev.has(dest)||(strict&&!(w&1)))continue;
      const depth=a.depth+1;a.prev.set(dest,{from:i,w,depth});next.push(dest);
      const other=b.prev.get(dest);
      if(other){meet=dest;break scan}
     }
    }
   }
   if(meet!==-1){
    const pairs=[];
    for(let i=meet;i!==start;){const p=left.prev.get(i);pairs.push([i,p.w]);i=p.from}
    pairs.reverse();
    for(let i=meet;i!==end;){const p=right.prev.get(i);pairs.push([p.from,p.w]);i=p.from}
    return result(true,pairs);
   }
   a.nodes=next;a.depth++;
  }
  return result(false,[]);
 }
 async function evidence(name,other,offset=0,progress){
  if(!Number.isInteger(offset)||offset<0)throw Error('Invalid evidence offset');
  const root=await resolve(name,progress);
  let [refs]=await rows('incidence',[root]);
  if(other){
   const id=await resolve(other,progress),[shared]=await rows('incidence',[id]);
   // Sorted fact IDs permit an exact linear intersection, without a global scan.
   const out=[];let i=0,j=0;
   while(i<refs.length&&j<shared.length){if(refs[i]===shared[j]){out.push(refs[i]);i++;j++}else if(refs[i]<shared[j])i++;else j++}
   refs=out;
  }
  const selected=refs.slice(offset,offset+20),facts=await rows('fact',selected);
  const actors=await rows('artist',facts.flatMap(f=>f[4].map(a=>a[0])));
  let cursor=0;
  const records=facts.map(([id,kind,title,source,people],i)=>({
   ref:selected[i],id,kind,title,source,participants:people.map(([,role,name])=>{const a=actors[cursor++];return {id:a.id,name:name??a.name,role}})
  }));
  return {total:refs.length,records,next:offset+records.length<refs.length?offset+records.length:null};
 }
 return {search,resolve,neighbors,path,evidence,stats:()=>manifest.stats};
}
if(typeof module!=='undefined')module.exports={createGraph};
