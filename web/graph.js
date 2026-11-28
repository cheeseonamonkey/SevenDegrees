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
 async function search(q,progress,expand=false){
  q=norm(q);if(q.length<2)return [];
  const found=await candidates(q,progress);
  const exactNames=found.filter(a=>a.exact);
  const rank=manifest.ranking&&exactNames.length>1&&exactNames.every(a=>a.rank>=1000000)?await rankingData():null;
  const ordered=found.sort((a,b)=>Number(b.exact)-Number(a.exact)||Number(b.full)-Number(a.full)||a.rank-b.rank||(rank?(rank.degree[b.id]||0)-(rank.degree[a.id]||0):0)||a.name.length-b.name.length||a.name.localeCompare(b.name)||a.mbid.localeCompare(b.mbid));
  const groups=new Map();
  for(const r of ordered){const k=norm(r.name);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)}
  if(expand){const group=groups.get(q)||[];return artists(group.slice(0,100).map(r=>r.id))}
  const selected=[...groups.values()].slice(0,20),result=await artists(selected.map(g=>g[0].id));
  return result.map((a,i)=>({...a,matches:selected[i].length,connections:rank?.degree[selected[i][0].id]}));
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
 // Generation uses the full eligible adjacency, not the first UUID-sorted page.
 function uniqueNeighbors(row,filter){
  const pairs=new Map();
  for(let i=0;i<row.length;i+=2)if(allowed(row[i+1],filter)&&!pairs.has(row[i]))pairs.set(row[i],row[i+1]);
  return pairs;
 }
 const options=p=>{
  const number=(key,def,min,max,integer=false)=>{
   const v=p[key]??def;
   if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(integer&&!Number.isInteger(v)))throw Error('Invalid '+key);
   return v;
  };
  const ranking=p.ranking??'popular';
  if(!['popular','degree','balanced'].includes(ranking))throw Error('Invalid ranking');
  return {ranking,fraction:number('fraction',.4,0,1),decay:number('decay',.5,0,1),depth:number('depth',2,1,4,true),maxBranch:number('maxBranch',16,1,100,true),maxConnections:number('maxConnections',100,0,500,true),variation:number('variation',.12,0,1),seed:number('seed',0,0,4294967295,true)};
 };
 async function rankingData(){
  if(!manifest.ranking)throw Error('Ranking index unavailable in this snapshot');
  return resource(manifest.ranking);
 }
 function score(id,rank,mode){
  const degree=Math.log1p(rank.degree[id]||0),chart=rank.popular[id];
  const popularity=chart===undefined?0:Math.log1p(1000/(chart+1));
  return mode==='degree'?degree:mode==='popular'?popularity*3-degree*.035:popularity*3-degree*.1;
 }
 async function generate(name,filter,params,progress=()=>{}){
  const o=options(params),root=await resolve(name,progress),rank=await rankingData();
  let state=o.seed>>>0;
  const noise=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return (state/4294967296-.5)*o.variation*8};
  const visited=new Map([[root,0]]),chosen=[],links=new Set();
  const rootRow=(await rows("topology",[root]))[0];
  let frontier=[root],total=uniqueNeighbors(rootRow,filter).size;
  for(let depth=0;depth<o.depth&&frontier.length;depth++){
   const next=[];
   for(let pos=0;pos<frontier.length&&chosen.length<o.maxConnections;pos+=16){
    const batch=frontier.slice(pos,pos+16),data=depth===0?[rootRow]:await rows('topology',batch);
    progress({message:'Generating map',visited:visited.size});
    for(let j=0;j<batch.length&&chosen.length<o.maxConnections;j++){
     const from=batch[j],pairs=uniqueNeighbors(data[j],filter);
     if(depth===0)total=pairs.size;
     const candidates=[...pairs].filter(([to])=>!links.has(from<to?from+':'+to:to+':'+from)).map(([to,w])=>[to,w,score(to,rank,o.ranking)+noise()]);
     candidates.sort((a,b)=>b[2]-a[2]||a[0]-b[0]);
     const fraction=o.fraction*Math.pow(o.decay,depth);
     const budget=Math.min(Math.ceil(o.maxBranch*Math.pow(o.decay,depth)),Math.ceil(pairs.size*fraction),o.maxConnections-chosen.length);
     for(const [to,w] of candidates.slice(0,budget)){
      links.add(from<to?from+':'+to:to+':'+from);chosen.push([from,to,w]);
      if(!visited.has(to)){visited.set(to,depth+1);next.push(to)}
     }
    }
   }
   frontier=next;
  }
  const steps=await hydrate(chosen.map(([,to,w])=>[to,w])),people=await artists(chosen.map(([from])=>from));
  return {root:await artist(root),total,links:steps.map((s,i)=>({from:people[i],...s})),settings:o};
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
 async function describePath(start,steps,progress){
  let from=start;
  for(const step of steps){
   if(['cover','cover-reference','production','featured'].includes(step.kind)){
    // Match the original witness, or prefer an explicit cover assertion for
    // the same title over an inferred reference version. Preserve its source.
    let best;
    for(let offset=0;offset<100;){
     progress({message:'Reading connection details'});
     const page=await evidence(from.id,step.to.id,offset,progress);
     for(const f of page.records){
      const roles=Object.fromEntries(['performer','producer','featured','original','reference'].map(role=>{
       const ids=[...new Set(f.participants.filter(p=>p.role===role&&[from.id,step.to.id].includes(p.id)).map(p=>p.id))];
       return [role,ids.length===1?ids[0]:undefined];
      }));
      const explicit=f.kind==='cover'&&roles.performer&&roles.original&&roles.performer!==roles.original&&f.title===step.title;
      const matches=f.source===step.source&&f.title===step.title&&(f.kind===step.kind||(['production','featured'].includes(step.kind)&&['recording','performance'].includes(f.kind)));
      if((step.kind==='cover'||step.kind==='cover-reference')&&explicit){best={...roles,kind:f.kind,source:f.source};break}
      if(matches&&!best)best=roles;
     }
     if(best&&(step.kind!=='cover-reference'||best.kind==='cover'))break;
     if(page.next===null)break;offset=page.next;
    }
    if(best)Object.assign(step,best);
   }
   step.description=connectionText(from,step.to,step);
   from=step.to;
  }
  return steps;
 }
 async function mapLinks(names,filter,progress,params){
  if(!Array.isArray(names)||names.length>500)throw Error('Map limit is 500 artists');
  const ids=await Promise.all(names.map(name=>resolve(name,progress))),chosen=new Set(ids),pairs=[];
  const size=manifest.sections.topology.block_size,groups=new Map();
  for(const id of chosen){const key=Math.floor(id/size);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(id)}
  const keys=[...groups.keys()];
  for(let i=0;i<keys.length;i+=16){
   const batch=keys.slice(i,i+16),data=await blocks('topology',batch);
   progress?.({message:'Connecting mapped artists',visited:i});
   for(let j=0;j<batch.length;j++)for(const from of groups.get(batch[j])){
    const row=data[j][from%size];
    for(let k=0;k<row.length;k+=2){const to=row[k],w=row[k+1];if(to>from&&chosen.has(to)&&allowed(w,filter))pairs.push([from,to,w])}
   }
  }
  let selected=pairs;
  if(params?.fraction!==undefined||params?.maxConnections!==undefined||params?.ranking!==undefined){
   const o=options(params),rank=await rankingData(),neighbors=new Map(ids.map(id=>[id,new Set()]));
   for(const [a,b] of pairs){neighbors.get(a).add(b);neighbors.get(b).add(a)}
   const existing=new Set((params.existing||[]).map(pair=>[...pair].sort().join(':')));
   const namesByID=new Map(ids.map((id,i)=>[id,names[i]]));
   const available=pairs.filter(([a,b])=>!existing.has([namesByID.get(a),namesByID.get(b)].sort().join(':')));
   const scores=new Map(available.map(p=>{
    const [a,b]=p,small=neighbors.get(a),large=neighbors.get(b);
    let mutual=0;for(const c of small)if(large.has(c))mutual++;
    return [p,Math.log1p(mutual)*.1+score(a,rank,o.ranking)+score(b,rank,o.ranking)];
   }));
   available.sort((a,b)=>scores.get(b)-scores.get(a)||a[0]-b[0]||a[1]-b[1]||a[2]-b[2]);
   selected=available.slice(0,Math.min(o.maxConnections,Math.ceil(available.length*o.fraction)));
  }
  const steps=await hydrate(selected.map(([,to,w])=>[to,w])),people=await artists(selected.map(([from])=>from));
  return selected.map((_,i)=>({from:people[i],...steps[i]}));
 }
 async function path(from,to,strict=false,progress=()=>{},limit=1){
  if(!Number.isInteger(limit)||limit<1||limit>10)throw Error('Path limit must be 1–10');
  const [start,end]=await Promise.all([resolve(from,progress),resolve(to,progress)]);
  const root=await artist(start);
  const result=async(paths)=>{
   const routes=[];
   for(const pairs of paths){const steps=await describePath(root,await hydrate(pairs),progress);routes.push({found:true,start:root,steps,degrees:steps.length})}
   return {...(routes[0]||{found:false,start:root,steps:[],degrees:0}),alternatives:routes.slice(1)};
  };
  if(start===end)return result([[]]);
  const rank=limit>1&&manifest.ranking?await rankingData():null;
  const front=i=>({nodes:[i],prev:new Map([[i,{parents:[],depth:0}]]),depth:0});
  const left=front(start),right=front(end),size=manifest.sections.topology.block_size;
  while(left.nodes.length&&right.nodes.length&&left.depth+right.depth<12){
   const [a,b]=left.nodes.length<=right.nodes.length?[left,right]:[right,left],groups=new Map();
   for(const i of a.nodes){const k=Math.floor(i/size);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(i)}
   const keys=[...groups.keys()].sort((x,y)=>x-y),next=[],meet=new Set();
   let distance=Infinity;
   scan:for(let pos=0;pos<keys.length;pos+=24){
    progress({message:'Searching connections',visited:left.prev.size+right.prev.size,blocks:pos,total:keys.length});
    const batch=keys.slice(pos,pos+24),data=await blocks('topology',batch);
    for(let j=0;j<batch.length;j++)for(const i of groups.get(batch[j])){
     for(const [dest,w] of uniqueNeighbors(data[j][i%size],strict)){
      const depth=a.depth+1,old=a.prev.get(dest);
      if(old&&old.depth!==depth)continue;
      if(!old){a.prev.set(dest,{parents:[[i,w]],depth});next.push(dest)}
      else if(limit>1)old.parents.push([i,w]);
      const other=b.prev.get(dest);
      if(other){const d=depth+other.depth;if(d<distance){distance=d;meet.clear()}if(d===distance)meet.add(dest);if(limit===1)break scan}
     }
    }
   }
   if(meet.size){
    const value=id=>rank?score(id,rank,'popular'):0;
    function prefixes(side){
     const memo=new Map();
     function best(id){
      if(memo.has(id))return memo.get(id);
      const parents=side.prev.get(id).parents;
      const choices=[];
      if(!parents.length)choices.push({pairs:[],ids:[id],score:value(id)});
      for(const [p,w] of parents){for(const r of best(p))choices.push({pairs:[...r.pairs,[id,w]],ids:[...r.ids,id],score:r.score+value(id)});if(choices.length>limit*8){choices.sort((a,b)=>b.score-a.score);choices.length=limit}}
      choices.sort((a,b)=>b.score-a.score);
      const top=choices.slice(0,limit);memo.set(id,top);return top
     }return best
    }
    const l=prefixes(left),r=prefixes(right),routes=[];
    for(const m of meet)for(const x of l(m))for(const y of r(m)){
     const pairs=x.pairs.concat(y.pairs.map((p,i)=>[y.ids[i],p[1]]).reverse());
     routes.push({pairs,score:x.score+y.score-value(m)});
     // Bound retained combinations without truncating the shortest-path DAG.
     if(routes.length>limit*8){routes.sort((a,b)=>b.score-a.score);routes.length=limit}
    }
    routes.sort((a,b)=>b.score-a.score);
    return result(routes.slice(0,limit).map(r=>r.pairs));
   }
   a.nodes=next;a.depth++;
  }
  return result([]);
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
 return {search,resolve,neighbors,path,evidence,profile,mapLinks,generate,stats:()=>manifest.stats};
}
if(typeof module!=='undefined')module.exports={createGraph};
