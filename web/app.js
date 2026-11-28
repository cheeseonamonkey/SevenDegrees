const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const button=(text,action,cls)=>{const b=el('button',text,cls);b.type='button';b.onclick=action;return b};
const link=(source,text='Source')=>{const a=el('a',text);try{const u=new URL(source);if(u.protocol==='https:'){a.href=u.href;a.target='_blank';a.rel='noopener noreferrer'}}catch{}return a};
const listen=(...terms)=>link(spotifySearch(...terms),'Spotify ↗');
const spinner=text=>{const n=el('span',undefined,'loading');n.append(el('span',undefined,'spinner'),el('span',text));return n};
const staticMode=!!document.querySelector('meta[name="static-graph"]');
const worker=staticMode?new Worker('graph-worker.js'):null,pending=new Map();let requestID=0;
if(worker){
 worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;if(data.progress){p.progress?.(data.progress);return}pending.delete(data.id);p.clean();data.error?p.reject(Error(data.error)):p.resolve(data.value)};
 worker.onerror=()=>{for(const p of pending.values()){p.clean();p.reject(Error('Graph worker failed'))}pending.clear()};
}
async function api(path,params={},options={}){
 const {signal,progress}=options;
 if(!worker){const r=await fetch(path+'?'+new URLSearchParams(params),{signal});const v=await r.json();if(!r.ok)throw Error(v.error||'Request failed');return v}
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 return new Promise((resolve,reject)=>{
  const id=++requestID,clean=()=>signal?.removeEventListener('abort',abort);
  const abort=()=>{pending.delete(id);clean();worker.postMessage({cancel:id});reject(new DOMException('Aborted','AbortError'))};
  pending.set(id,{resolve,reject,progress,clean});signal?.addEventListener('abort',abort,{once:true});worker.postMessage({id,path,params});
 });
}
const model=new AtlasMap(),pages=new Map();
let dimension='3D',mode='explore',view='atlas',selected=null,operation,inspection,lastQuery;
const viewer=new MapViewer($('network'),{onNode:selectNode,onLink:selectLink,onFallback:()=>{dimension='2D';syncDimension()}});
viewer.mode(dimension);
function syncDimension(){for(const b of $('dimension').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.dimension===dimension))}
syncDimension();
const MAX_NODES=matchMedia('(max-width:760px)').matches?240:500;
const policy=()=>Object.fromEntries(Array.from(document.querySelectorAll('#filter-options input'),e=>[e.name,e.checked]));
function status(text='',busy=false){$('status').replaceChildren(...(text?[busy?spinner(text):el('span',text)]:[]))}
function begin(text){
 operation?.abort();operation=new AbortController();const signal=operation.signal;
 status(text,true);$('status').append(button('Cancel',()=>{operation.abort();status('Cancelled')}));
 return {signal,progress:p=>{if(!signal.aborted){const s=$('status').querySelector('.loading span:last-child');if(s)s.textContent=p.message+(p.visited?' · '+p.visited.toLocaleString():'')}}};
}
function finish(options,text=''){if(!options.signal.aborted)status(text)}
function inspect(){
 inspection?.abort();inspection=new AbortController();$('records').replaceChildren();
 return inspection;
}
function heading(name,description){
 $('detail').replaceChildren(el('h1',name));if(description)$('detail').append(el('p',description));
}
function actions(...buttons){const n=el('div',undefined,'buttons');n.append(...buttons);$('detail').append(n)}
function update(reset=false){
 viewer.update(model,reset);$('map-count').textContent=view==='atlas'?model.nodes.size+' communities':model.nodes.size+' artists · '+model.links.size+' links';
 $('legend').hidden=view==='atlas';$('edge-legend').hidden=view==='atlas';$('connect-map').disabled=view==='atlas'||!staticMode;
}
function reset(next){model.clear();pages.clear();selected=null;view=next;inspect()}
function addNeighborhood(p){
 model.addNode(p.root);let limit=false;
 for(const s of p.steps){if(!model.nodes.has(s.to.id)&&model.nodes.size>=MAX_NODES){limit=true;continue}model.addConnection(p.root.id,s)}
 pages.set(p.root.id,limit?null:p.next);
 return limit;
}
async function overview(){
 const opt=begin('Loading atlas…');lastQuery=null;
 try{
  const a=staticMode?await api('/api/atlas',{},opt):null;if(opt.signal.aborted)return;
  reset('atlas');heading('Explore the atlas','Search an artist to enter their network.');
  if(!a){update(true);finish(opt);return}
  for(const n of a.nodes)model.addNode({...n,community:true});for(const [i,e] of a.links.entries())model.addLink({...e,id:'community:'+i,kind:'community'});
  heading('Musical communities',a.communities.toLocaleString()+' communities detected from the relationship graph. This overview shows '+a.nodes.length+' largest, representing '+a.shown_artists.toLocaleString()+' artists. All artists remain searchable.');
  $('detail').append(el('h2','Enter a community'));for(const n of a.nodes.slice(0,15))$('detail').append(button(n.name+' · '+n.size.toLocaleString(),()=>selectNode(n.id),'list-button'));
  update(true);finish(opt);
 }catch(e){if(!opt.signal.aborted){status(e.message);heading('Explore the atlas','Search an artist to begin.');}}
}
async function openArtist(value,remember=true){
 const opt=begin('Reading connections…');
 try{
  const p=await api('/api/neighbors',{artist:value,...policy()},opt);if(opt.signal.aborted)return;
  reset('local');addNeighborhood(p);lastQuery={artist:p.root.id};update(true);
  if(remember){const u=new URL(location.href);u.searchParams.set('artist',p.root.id);history.replaceState(null,'',u)}
  selectNode(p.root.id);finish(opt,p.total.toLocaleString()+' direct connections');
 }catch(e){finish(opt,e.message)}
}
async function findPath(from,to){
 const opt=begin('Searching connections…');
 try{
  const p=await api('/api/path',{from,to,...policy()},opt);if(opt.signal.aborted)return;
  reset('local');lastQuery={from,to};
  if(!p.found){update(true);heading('No path found','No connection within the search limit.');finish(opt);return}
  model.addNode(p.start);let previous=p.start.id;for(const s of p.steps){model.addConnection(previous,s);previous=s.to.id}update(true);
  heading('Connection path',p.degrees+' '+(p.degrees===1?'degree':'degrees')+' of separation · '+(p.degrees+1)+' artists');
  $('detail').append(button(p.start.name,()=>selectNode(p.start.id),'list-button'));
  let from=p.start;
  for(const [i,s] of p.steps.entries()){
   const sourceArtist=from;const n=el('div',undefined,'path-item'),description=el('p',s.description||connectionText(from,s.to,s));
   description.style.borderLeftColor=category(s.kind)?.color||'#637588';
   n.append(el('small','Link '+(i+1)),description,button(s.to.name,()=>selectNode(s.to.id),'list-button'),listen(...listeningTerms(from,s.to,s)));
   if(staticMode)n.append(document.createTextNode(' · '),button('Evidence',()=>showEvidence(sourceArtist.id,s.to.id),'small-button'));
   $('detail').append(n);from=s.to
  }
  finish(opt);
 }catch(e){finish(opt,e.message)}
}
function date(d){return d?d.filter(x=>x!==null).map((x,i)=>i?String(x).padStart(2,'0'):String(x)).join('-'):'Unknown'}
function period(r){return (r.begin?date(r.begin):'Unknown start')+' – '+(r.end?date(r.end):r.ended?'Ended; date unknown':'End not recorded')}
function selectNode(id){
 const n=model.nodes.get(id);if(!n)return;
 const controller=inspect();selected=id;
 if(n.community){
  heading(n.name+' community',n.size.toLocaleString()+' artists · named for a representative, not a genre.');
  $('detail').append(el('h2','Representative artists'));for(const a of n.artists)$('detail').append(button(a.name,()=>openArtist(a.id),'list-button'));
  return
 }
 heading(n.name,[n.type,n.disambiguation].filter(x=>x&&x!=='Unknown').join(' · '));
 const expand=button(pages.get(id)===null?'Connections loaded':pages.has(id)?'More connections':'Expand',()=>expandNode(id));
 expand.disabled=pages.get(id)===null||model.nodes.size>=MAX_NODES;
 actions(expand,button('Focus',()=>viewer.focus(id)),...(staticMode?[button('Evidence',()=>showEvidence(id)),button('Timeline',()=>showTimeline(id))]:[]));
 $('detail').append(listen(n.name));
 const adjacent=[...model.links.values()].filter(e=>e.source===id||e.target===id);
 if(adjacent.length){const list=el('details');list.append(el('summary','Mapped connections ('+adjacent.length+')'));for(const e of adjacent){const a=model.nodes.get(e.source===id?e.target:e.source);list.append(button(a.name+' · '+e.kind,()=>selectNode(a.id),'list-button'))}$('detail').append(list)}
 if(staticMode)showTimeline(id,0,'',controller);
}
async function expandNode(id){
 const opt=begin('Expanding network…');
 try{
  const p=await api('/api/neighbors',{artist:id,...policy(),offset:pages.get(id)||0},opt);
  if(opt.signal.aborted)return;const limit=addNeighborhood(p);update();selectNode(id);finish(opt,limit?'Map display limit reached; open an artist to continue.':p.total.toLocaleString()+' direct connections');
 }catch(e){finish(opt,e.message)}
}
function selectLink(id){
 const e=model.links.get(id);if(!e)return;inspect();selected=null;
 const a=model.nodes.get(e.source),b=model.nodes.get(e.target);
 heading(a.name+' ↔ '+b.name,e.description||connectionText(a,b,e));
 if(e.url)$('detail').append(listen(...listeningTerms(a,b,e)));
 if(view==='local')actions(...(staticMode?[button('Shared evidence',()=>showEvidence(a.id,b.id))]:[]),button(a.name,()=>selectNode(a.id)),button(b.name,()=>selectNode(b.id)));
}
async function showEvidence(a,b,offset=0){
 const c=offset?inspection:inspect(),panel=$('records');if(!offset)panel.append(el('h2',b?'Shared evidence':'Evidence'));
 const loading=spinner('Reading records…');panel.append(loading);
 try{
  const p=await api('/api/evidence',{artist:a,...(b?{other:b}:{}),offset},{signal:c.signal});if(c.signal.aborted)return;loading.remove();
  if(!offset)panel.append(el('p',p.total.toLocaleString()+' source records'));
  for(const f of p.records){const n=el('article',undefined,'record');n.append(el('strong',f.title),el('p',f.kind+' · '+f.participants.map(x=>x.name+' ('+x.role+')').join('; ')),listen(f.title,f.participants.find(p=>p.role==='performer')?.name),document.createTextNode(' · '),link(f.source,'Source record'));panel.append(n)}
  if(p.next!==null){const more=button('More records',()=>{more.remove();showEvidence(a,b,p.next)});panel.append(more)}
 }catch(e){if(!c.signal.aborted)loading.replaceWith(el('p',e.message))}
}
async function showTimeline(id,offset=0,year='',provided){
 const c=provided||(offset?inspection:inspect()),panel=$('records');if(!offset){panel.replaceChildren(el('h2','Membership & roles'));const filter=el('form',undefined,'year'),input=el('input');input.type='number';input.placeholder='Year';input.value=year;input.setAttribute('aria-label','Filter by year');const submit=el('button','Filter');submit.type='submit';filter.append(input,submit,button('All dates',()=>showTimeline(id)));filter.onsubmit=e=>{e.preventDefault();showTimeline(id,0,input.value)};panel.append(filter)}
 const loading=spinner('Reading timeline…');panel.append(loading);
 try{
  const p=await api('/api/profile',{artist:id,offset,...policy(),...(year?{year:Number(year)}:{})},{signal:c.signal});if(c.signal.aborted)return;loading.remove();
  if(p.root.type&&selected===id){const text=$('detail').querySelector('p');if(text)text.textContent=[p.root.type,p.root.disambiguation].filter(Boolean).join(' · ');model.addNode(p.root)}
  if(!p.available){panel.append(el('p','Typed membership data is not included in this snapshot.'));return}
  if(!offset)panel.append(el('p',p.total.toLocaleString()+' professional relationships. Unknown dates remain unknown; year filtering excludes only known non-overlapping dates.'));
  for(const r of p.records){const n=el('article',undefined,'record');n.append(button(r.other.name,()=>{if(!model.nodes.has(r.other.id)&&model.nodes.size>=MAX_NODES){openArtist(r.other.id);return}model.addNode(r.other);model.addLink({id:r.id,source:r.direction==='out'?id:r.other.id,target:r.direction==='out'?r.other.id:id,kind:r.kind==='member of band'?'membership':r.kind,title:period(r),url:r.source});update();selectNode(r.other.id)},'list-button'),el('p',r.kind+' · '+(r.direction==='out'?'Outgoing':'Incoming')+' · '+period(r)+(r.attributes.length?' · '+r.attributes.join(', '):'')),listen(r.other.name),document.createTextNode(' · '),link(r.source,'Source record'));panel.append(n)}
  if(p.next!==null){const more=button('More relationships',()=>{more.remove();showTimeline(id,p.next,year)});panel.append(more)}
 }catch(e){if(!c.signal.aborted)loading.replaceWith(el('p',e.message))}
}
function autocomplete(key){
 const input=$(key),options=$(key+'-options');let timer,controller,sequence=0;
 const close=()=>{sequence++;clearTimeout(timer);controller?.abort();options.hidden=true;options.replaceChildren()};
 input.addEventListener('input',()=>{delete input.dataset.id;close();const q=input.value.trim();if(q.length<2)return;const version=sequence;timer=setTimeout(async()=>{controller=new AbortController();options.hidden=false;options.append(spinner('Searching…'));try{const found=await api('/api/artists',{q},{signal:controller.signal});if(version!==sequence)return;options.replaceChildren();for(const a of found)options.append(button(a.name,()=>{input.value=a.name;input.dataset.id=a.id;close();if(mode==='explore')openArtist(a.id)}));if(!found.length)options.append(el('p','No matches'))}catch(e){if(version===sequence&&e.name!=='AbortError')options.replaceChildren(el('p',e.message))}},250)});
 input.addEventListener('keydown',e=>{if(e.key==='Escape')close();if(e.key==='ArrowDown'){options.querySelector('button')?.focus();e.preventDefault()}});
 document.addEventListener('click',e=>{if(e.target!==input&&!options.contains(e.target))close()});
 return close
}
const closeOptions=['from','to'].map(autocomplete);
const inputValue=id=>$(id).dataset.id||$(id).value.trim();
$('search').onsubmit=e=>{e.preventDefault();closeOptions.forEach(fn=>fn());if(mode==='path'){if(inputValue('to'))findPath(inputValue('from'),inputValue('to'));else $('to').focus()}else openArtist(inputValue('from'))};
$('mode').onclick=()=>{mode=mode==='path'?'explore':'path';$('mode').setAttribute('aria-pressed',String(mode==='path'));$('destination').hidden=mode!=='path';$('submit').textContent=mode==='path'?'Connect':'Explore';if(mode==='path')$('to').focus()};
$('overview').onclick=()=>{const u=new URL(location.href);u.searchParams.delete('artist');history.replaceState(null,'',u);overview()};
$('dimension').onclick=e=>{const next=e.target.closest('button')?.dataset.dimension;if(!next||next===dimension)return;dimension=next;viewer.mode(dimension);syncDimension();update(true)};
$('fit').onclick=()=>viewer.fit();
$('layout-button').onclick=()=>{const panel=$('layout-panel');panel.hidden=!panel.hidden;$('layout-button').setAttribute('aria-expanded',String(!panel.hidden))};
function layoutSettings(){viewer.settings={cluster:$('layout-mode').value==='cluster',spacing:Number($('spacing').value),labels:$('labels').checked};viewer.update(model,false)}
for(const id of ['layout-mode','spacing','labels'])$(id).onchange=layoutSettings;
$('relayout').onclick=()=>viewer.update(model,true);
$('connect-map').onclick=async()=>{
 if(!staticMode||view!=='local')return;
 const opt=begin('Connecting map…');
 try{
  const edges=await api('/api/map-links',{artists:[...model.nodes.keys()],...policy()},opt);
  if(opt.signal.aborted)return;for(const e of edges.slice(0,2000))model.addConnection(e.from.id,e);
  update();finish(opt,edges.length.toLocaleString()+' relationships within this map'+(edges.length>2000?' · display capped at 2,000':''));
 }catch(e){finish(opt,e.message)}
};

$('export').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify({nodes:[...model.nodes.values()],links:[...model.links.values()]},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='musicatlas-map.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};
async function filters(){
 const categories=await api('/api/categories');
 const choices=categories||{covers:{bit:8,label:'Covers & tributes'}};
 for(const [key,{bit,label}] of Object.entries(choices)){
  const row=el('label'),input=el('input');input.type='checkbox';input.checked=true;input.value=bit;input.name=key;const dot=el('i');dot.style.background=relationshipTypes[key]?.color||'#888';row.append(input,dot,document.createTextNode(' '+label));$('filter-options').append(row);
 }
 const count=()=>$('filter-count').textContent=document.querySelectorAll('#filter-options input:checked').length+'/'+Object.keys(choices).length;
 const changed=()=>{count();if(lastQuery?.artist)openArtist(lastQuery.artist);else if(lastQuery?.from)findPath(lastQuery.from,lastQuery.to)};
 $('edge-legend').replaceChildren(...Object.entries(choices).map(([key,c])=>{const label=el('span');const swatch=el('i');swatch.style.background=relationshipTypes[key]?.color||'#888';label.append(swatch,document.createTextNode(c.label));return label}));
 count();$('filter-options').onchange=changed;
 for(const [id,value] of [['all-types',true],['no-types',false]])$(id).onclick=()=>{for(const box of $('filter-options').querySelectorAll('input'))box.checked=value;changed()};

}

$('api-link').hidden=!staticMode;
api('/api/stats').then(s=>$('stats').textContent=s.artist.toLocaleString()+' artists · '+s.fact.toLocaleString()+' records').catch(e=>$('stats').textContent=e.message);
const initial=new URL(location.href).searchParams.get('artist');filters().then(()=>initial?openArtist(initial,false):overview()).catch(e=>status(e.message));
