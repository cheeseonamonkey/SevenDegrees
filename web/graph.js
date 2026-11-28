// Graph algorithms operate on a storage adapter. No transport or eager graph load.
function createGraph(store){
 const {manifest,rows,blocks,directory,resource}=store;
 const norm=s=>s.normalize('NFKC').toLowerCase().trim();
 const key=s=>Array.from(new TextEncoder().encode(Array.from(s).slice(0,2).join('')),x=>x.toString(16).padStart(2,'0')).join('');
 const simple=a=>({id:a.id,name:a.name});
 async function artists(ids){
  const [people,types]=await Promise.all([rows('artist',ids),manifest.sections.profile?rows('profile',ids):Promise.resolve([])]);
  return people.map((a,i)=>({...simple(a),...(types[i]?{type:types[i][0],disambiguation:types[i][1]}:{})}));
 }
 const artist=async i=>(await artists([i]))[0];
 const lowerBound=(list,match)=>{let lo=0,hi=list.length;while(lo<hi){const m=(lo+hi)>>>1;if(match(list[m]))lo=m+1;else hi=m}return lo};
 async function candidates(q,progress=()=>{},exact=false){
  const directoryMap=await directory("search_directory");
  if(manifest.search_layout==='sorted-prefix-v1'){
   const file=directoryMap[key(Array.from(q)[0]||'')];if(!file)return [];
   const ranges=await resource(file),start=lowerBound(ranges,r=>r[1]<q),result=new Map();
   for(let i=start;i<ranges.length&& (ranges[i][0]<=q||ranges[i][0].startsWith(q));i+=16){
    progress({message:"Finding artists",visited:result.size});
    const wanted=ranges.slice(i,i+16).filter(r=>r[0]<=q||r[0].startsWith(q));
    if(!wanted.length)break;
    for(const block of await blocks('search',wanted.map(r=>r[2])))for(const row of block){
     const [term,id,mbid,name,rank,full]=row;
     if(exact?term!==q||!full:!term.startsWith(q))continue;
     const match={id,mbid,name,rank,exact:term===q&&!!full,full:!!full};
     const old=result.get(id);if(!old||Number(match.exact)>Number(old.exact)||(!old.full&&match.full))result.set(id,match);
    }
   }
   return [...result.values()];
  }
  const range=directoryMap[key(q)];if(!range)return [];
  const [first,count]=range,result=[];
  for(let i=0;i<count;i+=16){
   progress({message:"Finding artists",visited:result.length});
   for(const block of await blocks('search',Array.from({length:Math.min(16,count-i)},(_,j)=>first+i+j)))for(const row of block){
    const [id,mbid,name,aliases,rank]=row,names=[name,...aliases].map(norm);
    const full=names.some(n=>n===q),prefix=names.some(n=>n.startsWith(q));
    if(exact?full:prefix||names.some(n=>n.split(/\s+/).some((_,i,a)=>a.slice(i).join(' ').startsWith(q))))result.push({id,mbid,name,rank,exact:full,full:prefix});
   }
  }
  return result;
 }
 async function search(q,progress){
  q=norm(q);if(q.length<2)return [];
  const found=await candidates(q,progress);
  return found.sort((a,b)=>Number(b.exact)-Number(a.exact)||Number(b.full)-Number(a.full)||a.rank-b.rank||a.name.length-b.name.length||a.name.localeCompare(b.name)||a.mbid.localeCompare(b.mbid)).slice(0,20).map(r=>({id:r.mbid,name:r.name}));
 }
 async function resolve(value,progress){
  const id=value.trim(),q=norm(id);
  if(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)){
   const starts=await directory("artist_starts");
   let lo=0,hi=starts.length;
   while(lo<hi){const mid=(lo+hi)>>>1;if(starts[mid]<=q)lo=mid+1;else hi=mid}
   if(lo){const block=(await blocks('artist',[lo-1]))[0];const i=block.findIndex(a=>a.id===q);if(i>=0)return (lo-1)*manifest.sections.artist.block_size+i}
  }
  const found=await candidates(q,progress,true);
  if(found.length!==1)throw Error(found.length?'Ambiguous artist; choose a search result.':'Artist not found.');
  return found[0].id;
 }
 const categorical=manifest.edge_encoding==='category-v1';
 const allowed=(w,filter)=>categorical?!!(w&(typeof filter==='number'?filter:filter?23:31)):(typeof filter==="number"?!!(filter&8):!filter)||!!(w&1);
 const witness=w=>w>>>(categorical?5:1);
 async function hydrate(pairs){
  const [people,witnesses]=await Promise.all([artists(pairs.map(p=>p[0])),rows('witness',pairs.map(p=>witness(p[1])))]);
  return people.map((a,i)=>{const [kind,title,source]=witnesses[i];return {to:a,kind,title,source}});
 }
 async function neighbors(name,strict=false,offset=0,progress){
  if(!Number.isInteger(offset)||offset<0)throw Error('Invalid neighbor offset');
  const root=await resolve(name,progress);
  const [row]=await rows('topology',[root]);
  const seen=new Set(),pairs=[];
  for(let i=0;i<row.length;i+=2){
   const to=row[i],w=row[i+1];if(seen.has(to)||!allowed(w,strict))continue;
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
      if(a.prev.has(dest)||!allowed(w,strict))continue;
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
 async function profile(name,offset=0,year,progress,mask=31){
  if(!Number.isInteger(offset)||offset<0)throw Error('Invalid profile offset');
  const id=await resolve(name,progress),root=await artist(id);
  if(!manifest.sections.timeline)return {root,total:0,records:[],next:null,available:false};
  let [records]=await rows('timeline',[id]);
  if(year!==undefined&&year!==''){
   year=Number(year);if(!Number.isInteger(year))throw Error('Invalid year');
   records=records.filter(r=>(!r[4]?.[0]||r[4][0]<=year)&&(!r[5]?.[0]||r[5][0]>=year));
  }
  if(manifest.categories)records=records.filter(r=>Object.values(manifest.categories).some(c=>(mask&c.bit)&&c.kinds.includes(r[3])));
  records=[...records].sort((a,b)=>(a[4]?.[0]??99999)-(b[4]?.[0]??99999)||(a[5]?.[0]??99999)-(b[5]?.[0]??99999)||a[2].localeCompare(b[2]));
  const page=records.slice(offset,offset+40),others=await artists(page.map(r=>r[0]));
  return {root,total:records.length,available:true,next:offset+page.length<records.length?offset+page.length:null,records:page.map((r,i)=>({other:others[i],direction:r[1],id:r[2],kind:r[3],begin:r[4],end:r[5],ended:r[6],attributes:r[7],source:r[8]}))};
 }
 return {search,resolve,neighbors,path,evidence,profile,stats:()=>manifest.stats};
}
if(typeof module!=='undefined')module.exports={createGraph};
