const $=id=>document.getElementById(id);
const make=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el};
const staticMode=!!document.querySelector('meta[name="static-graph"]');
let worker,nextRequest=0,mode='explore',network,requestVersion=0,searchController,evidenceController;
const pending=new Map();
function staticAPI(path,params,{signal,progress}={}){
 if(signal?.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
 if(!worker){
  worker=new Worker('graph-worker.js');
  worker.onmessage=({data})=>{
   const p=pending.get(data.id);if(!p)return;
   if(data.progress){p.progress?.(data.progress);return}
   pending.delete(data.id);p.cleanup();data.error?p.reject(Error(data.error)):p.resolve(data.value)
  };
  worker.onerror=()=>{for(const p of pending.values()){p.cleanup();p.reject(Error('Graph worker failed'))}pending.clear();worker.terminate();worker=undefined};
 }
 return new Promise((resolve,reject)=>{
  const id=++nextRequest;
  const abort=()=>{pending.delete(id);worker?.postMessage({cancel:id});reject(new DOMException('Aborted','AbortError'))};
  const cleanup=()=>signal?.removeEventListener('abort',abort);
  pending.set(id,{resolve,reject,progress,cleanup});signal?.addEventListener('abort',abort,{once:true});
  worker.postMessage({id,path,params});
 });
}
async function api(path,params={},options={}){
 if(staticMode)return staticAPI(path,params,options);
 const r=await fetch(path+'?'+new URLSearchParams(params),{signal:options.signal});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data;
}
function loading(text='Loading…'){
 const el=make('p',undefined,'loading');el.setAttribute('role','status');el.append(make('span',undefined,'spinner'),make('span',text));return el
}
function autocomplete(key){
 const input=$(key),options=$(key+'-options');let timer,sequence=0,controller;
 const close=()=>{sequence++;clearTimeout(timer);controller?.abort();options.replaceChildren()};
 input.addEventListener('input',()=>{
  delete input.dataset.id;close();const n=sequence,q=input.value.trim();if(!q)return;
  timer=setTimeout(async()=>{
   controller=new AbortController();options.replaceChildren(loading('Finding artists…'));
   try{
    const artists=await api('/api/artists',{q},{signal:controller.signal});if(n!==sequence)return;
    options.replaceChildren();
    for(const a of artists){const b=make('button',a.name);b.type='button';b.addEventListener('click',()=>{input.value=a.name;input.dataset.id=a.id;close()});options.append(b)}
    if(!artists.length)options.append(make('p','No matching artists'));
   }catch(e){if(n===sequence&&e.name!=='AbortError')options.replaceChildren(make('p',e.message))}
  },250)
 });
 input.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
 document.addEventListener('click',e=>{if(e.target!==input&&!options.contains(e.target))close()});
 return close;
}
const closeOptions=['from','to'].map(autocomplete);
const artist=k=>$(k).dataset.id||$(k).value.trim();
const link=(source)=>{const a=make('a','Evidence');try{const u=new URL(source);if(u.protocol==='https:'){a.href=u.href;a.target='_blank';a.rel='noopener noreferrer'}}catch{}return a};
const MAP_LIMIT=240;
const expanded=new Map(),expanding=new Set();
function clearGraph(){
 if(network){network.destroy();network=undefined}
 expanded.clear();expanding.clear();clearEvidence();$('network').hidden=true;$('map-tools').hidden=true;$('detail').replaceChildren()
}
function renderPath(p){
 const result=$('result');if(!p.found){result.replaceChildren(make('h2','No connection found'),make('p','No path found within the search limit.'));return}
 result.replaceChildren(make('h2','Connection path'),make('div',p.start.name,'artist'));
 let previous=p.start;
 const elements=[node(previous,true)];
 for(const s of p.steps){
  const line=make('div',s.kind+' · '+s.title,'edge');line.append(link(s.source));result.append(line,make('div',s.to.name,'artist'));
  elements.push(node(s.to),edge(previous.id,s));previous=s.to;
 }
 createMap(elements,'breadthfirst');
}
const node=(a,root=false)=>({data:{id:a.id,label:a.name,...(root?{root:true}:{})}});
const edge=(from,s)=>({data:{id:'edge:'+JSON.stringify([from,s.to.id].sort()),source:from,target:s.to.id,kind:s.kind,title:s.title,url:s.source}});
function updateCount(){$('map-count').textContent=network.nodes().length+' artists · '+network.edges().length+' links'}
function createMap(elements,layout='cose'){
 $('network').hidden=false;$('map-tools').hidden=false;
 const color=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
 network=cytoscape({container:$('network'),elements,layout:{name:layout,animate:false},style:[
  {selector:'node',style:{label:'data(label)','font-size':10,'background-color':color,'text-valign':'bottom','text-margin-y':5,color:getComputedStyle(document.body).color,width:14,height:14}},
  {selector:'node[root]',style:{width:27,height:27,'font-weight':'bold'}},
  {selector:'edge',style:{width:1.5,'line-color':'#888','curve-style':'straight'}},
  {selector:'edge[kind = "cover"], edge[kind = "cover-reference"], edge[kind = "tribute"]',style:{'line-style':'dashed'}}
 ]});
 network.on('tap','edge',e=>{const d=e.target.data();clearEvidence();$('detail').replaceChildren(make('span',d.kind+' · '+d.title+' '),link(d.url));if(staticMode)$('detail').append(document.createTextNode(' '),evidenceButton(d.source,d.target))});
 network.on('tap','node',e=>{const d=e.target.data();showArtist(d)});
 updateCount();
}
function clearEvidence(){evidenceController?.abort();$('evidence-panel').replaceChildren()}
function evidenceButton(a,b){
 const button=make('button',b?'All shared records':'All evidence');button.type='button';
 button.addEventListener('click',()=>showEvidence(a,b,0));return button
}
async function showEvidence(a,b,offset){
 evidenceController?.abort();const controller=new AbortController();evidenceController=controller;
 const panel=$('evidence-panel');
 if(!offset)panel.replaceChildren();
 const progress=loading('Loading source records…');panel.append(progress);
 try{
  const params={artist:a,offset};if(b)params.other=b;
  const page=await api('/api/evidence',params,{signal:controller.signal});
  if(controller.signal.aborted)return;progress.remove();
  if(!offset)panel.append(make('h2',page.total.toLocaleString()+(b?' shared records':' evidence records')));
  for(const f of page.records){
   const item=make('article',undefined,'evidence-record');
   item.append(make('strong',f.title),make('p',f.kind+' · '+f.participants.map(p=>p.name+' ('+p.role+')').join('; ')),link(f.source));
   panel.append(item);
  }
  if(page.next!==null){const more=make('button','Load more records');more.type='button';more.addEventListener('click',()=>{more.remove();showEvidence(a,b,page.next)});panel.append(more)}
 }catch(e){if(!controller.signal.aborted){progress.replaceWith(make('p',e.message))}}
}
function showArtist(d){
 clearEvidence();const done=expanded.get(d.id)===null;
 const button=make('button',done?'All connections loaded':expanded.has(d.id)?'Load more connections':'Expand connections');
 button.disabled=done||expanding.has(d.id)||network.nodes().length>=MAP_LIMIT;button.addEventListener('click',()=>expandArtist(d,button));
 const source=link('https://musicbrainz.org/artist/'+encodeURIComponent(d.id));source.textContent='MusicBrainz';
 $('detail').replaceChildren(make('strong',d.label+' '),button,document.createTextNode(' '),source);if(staticMode)$('detail').append(document.createTextNode(' '),evidenceButton(d.id));
}
function appendNeighborhood(p){
 let added=0,limited=false;
 network.batch(()=>{
  for(const s of p.steps){
   if(network.getElementById(s.to.id).empty()){
    if(network.nodes().length>=MAP_LIMIT){limited=true;continue}
    network.add(node(s.to));added++;
   }
   const e=edge(p.root.id,s);
   if(network.getElementById(e.data.id).empty())network.add(e);
  }
 });
 updateCount();
 return {added,limited};
}
async function expandArtist(d,button){
 if(!network||expanded.get(d.id)===null||expanding.has(d.id))return;
 const current=network,version=requestVersion;button.disabled=true;button.replaceChildren(make('span',undefined,'spinner'),document.createTextNode(' Expanding…'));expanding.add(d.id);
 try{
  const p=await api('/api/neighbors',{artist:d.id,strict:$('strict').checked,offset:expanded.get(d.id)||0});
  if(network!==current||version!==requestVersion)return;
  const {added,limited}=appendNeighborhood(p);
  expanded.set(d.id,p.next);if(added)network.layout({name:'cose',animate:false,fit:false}).run();
  expanding.delete(d.id);showArtist(d);$('detail').append(make('p',p.total.toLocaleString()+' direct connections; '+added+' new artists mapped.'+(limited?' Map limit reached.':'')));
 }catch(e){if(network===current){button.disabled=false;button.textContent='Retry expansion';$('detail').append(make('p',e.message))}}finally{if(network===current)expanding.delete(d.id)}
}
function renderNetwork(p){
 $('result').replaceChildren(make('h2',p.root.name),make('p',p.steps.length+' of '+p.total.toLocaleString()+' direct connections shown. Select an artist to expand it; select a link for evidence.'));
 createMap([node(p.root,true)],'grid');
 appendNeighborhood(p);expanded.set(p.root.id,p.next);
 network.layout({name:'concentric',concentric:n=>n.data('root')?2:1,levelWidth:()=>1,minNodeSpacing:22,animate:false}).run();
}
$('fit').addEventListener('click',()=>network?.fit(undefined,25));
$('export').addEventListener('click',()=>{
 if(!network)return;
 const url=URL.createObjectURL(new Blob([JSON.stringify(network.elements().jsons(),null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='musicatlas-map.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
});
function setMode(next){for(const close of closeOptions)close();searchController?.abort();mode=next;requestVersion++;$('submit').disabled=false;clearGraph();$('destination').hidden=mode==='explore';$('submit').textContent=mode==='path'?'Find connections':'Explore';for(const b of document.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));$('result').replaceChildren()}
for(const b of document.querySelectorAll('[data-mode]'))b.addEventListener('click',()=>setMode(b.dataset.mode));
$('search').addEventListener('submit',async e=>{
 e.preventDefault();searchController?.abort();for(const close of closeOptions)close();
 const controller=new AbortController();searchController=controller;
 const version=++requestVersion,button=$('submit'),result=$('result');
 button.disabled=true;clearGraph();const status=loading('Reading graph…');result.replaceChildren(status);
 const options={signal:controller.signal,progress:p=>{if(version===requestVersion)status.lastChild.textContent=p.message+(p.visited!==undefined?' · '+p.visited.toLocaleString()+' artists examined':'')}};
 try{
  const strict=$('strict').checked;
  const p=mode==='path'?await api('/api/path',{from:artist('from'),to:artist('to'),strict},options):await api('/api/neighbors',{artist:artist('from'),strict},options);
  if(version!==requestVersion)return;mode==='path'?renderPath(p):renderNetwork(p)
 }catch(err){if(version===requestVersion&&err.name!=='AbortError')result.replaceChildren(make('p',err.message))}
 finally{if(version===requestVersion)button.disabled=false}
});
if(staticMode)$('api-link').hidden=false;
api('/api/stats').then(s=>{$('stats').textContent=s.artist.toLocaleString()+' artists · '+s.fact.toLocaleString()+' evidence records'}).catch(e=>{$('stats').textContent=e.message});
$('strict').addEventListener('change',()=>setMode(mode));
