const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const button=(text,action,cls)=>{const b=el('button',text,cls);b.type='button';b.onclick=action;return b};
const link=(source,text='Source')=>{const a=el('a',text);try{const u=new URL(source);if(u.protocol==='https:'){a.href=u.href;a.target='_blank';a.rel='noopener noreferrer'}}catch{}return a};
const listen=(...terms)=>link(spotifySearch(...terms),'Spotify ↗');
const spinner=text=>{const n=el('span',undefined,'loading');n.append(el('span',undefined,'spinner'),el('span',text));return n};
const staticMode=!!document.querySelector('meta[name="static-graph"]');
let worker;const pending=new Map();let requestID=0;
function ensureWorker(){
 if(worker)return worker;
 worker=new Worker('graph-worker.js');
 worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;if(data.progress){p.progress?.(data.progress);return}pending.delete(data.id);p.clean();data.error?p.reject(Error(data.error)):p.resolve(data.value)};
 worker.onerror=()=>{for(const p of pending.values()){p.clean();p.reject(Error('Graph worker failed'))}pending.clear();worker.terminate();worker=null};
 return worker
}
async function api(path,params={},options={}){
 const {signal,progress}=options;
 if(!staticMode){const r=await fetch(path+'?'+new URLSearchParams(params),{signal});const v=await r.json();if(!r.ok)throw Error(v.error||'Request failed');return v}
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 ensureWorker();
 return new Promise((resolve,reject)=>{
  const id=++requestID,clean=()=>signal?.removeEventListener('abort',abort);
  const abort=()=>{pending.delete(id);clean();worker.postMessage({cancel:id});reject(new DOMException('Aborted','AbortError'))};
  pending.set(id,{resolve,reject,progress,clean});signal?.addEventListener('abort',abort,{once:true});worker.postMessage({id,path,params});
 });
}

const model=new AtlasMap(),pages=new Map();
const MAX_NODES=matchMedia('(max-width:760px)').matches?240:500;
let mode='explore',dimension='2D',operation,inspection,routeSet=[],routeIndex=0,seed=0;
const viewer=new MapViewer($('network'),{onNode:selectNode,onLink:selectLink,onFallback:()=>{dimension='2D';syncDimension()}});
const policy=()=>Object.fromEntries(Array.from(document.querySelectorAll('#filter-options input'),e=>[e.name,e.checked]));
const generation=()=>({seed,ranking:$('ranking').value,variation:Number($('variation').value),fraction:Number($('fraction').value),decay:Number($('decay').value),depth:Number($('depth').value),maxBranch:Number($('max-branch').value),maxConnections:Math.min(MAX_NODES-1,Number($('max-connections').value))});
function status(text='',busy=false){$('status').replaceChildren(...(text?[busy?spinner(text):el('span',text)]:[]))}
function begin(text){
 operation?.abort();operation=new AbortController();const signal=operation.signal;
 status(text,true);$('status').append(button('Cancel',()=>{operation.abort();$('submit').disabled=false;status('Cancelled')}));
 $('submit').disabled=true;
 return {signal,progress:p=>{if(!signal.aborted){const n=$('status').querySelector('.loading span:last-child');if(n)n.textContent=p.message+(p.visited?' · '+p.visited.toLocaleString():'')}}};
}
function finish(opt,text=''){if(!opt.signal.aborted){$('submit').disabled=false;status(text)}}
function inspect(){inspection?.abort();inspection=new AbortController();$('records').replaceChildren();return inspection}
function clearMap(){
 inspect();dimensionRequest++;model.clear();pages.clear();routeSet=[];viewer.destroy();$('network').hidden=true;$('map-tools').hidden=true;$('export').disabled=true;$('detail').replaceChildren();$('result').replaceChildren()
}
function syncDimension(){for(const b of $('dimension').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.dimension===dimension))}
function draw(fit=false){
 $('network').hidden=false;$('map-tools').hidden=false;$('export').disabled=false;
 viewer.mode(dimension);viewer.update(model,fit);
 $('map-count').textContent=model.nodes.size+' artists · '+model.links.size+' links';
}
function heading(name,text){$('result').replaceChildren(el('h2',name));if(text)$('result').append(el('p',text))}
function permalink(id){const u=new URL(location.href);if(id)u.searchParams.set('artist',id);else u.searchParams.delete('artist');history.replaceState(null,'',u)}
function setMode(next,clear=true){
 if(clear){permalink();operation?.abort();closeOptions.forEach(fn=>fn());clearMap();status();$('submit').disabled=false}
 mode=next;$('destination').hidden=next==='explore';$('to').required=next==='path';
 $('generation-settings').hidden=next==='path'||!staticMode;$('submit').textContent=next==='path'?'Find connections':'Explore';
 for(const b of document.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===next));
}
function appendLinks(links){
 for(const e of links){model.addNode(e.from);model.addConnection(e.from.id,e)}
}
function appendPage(p){
 model.addNode(p.root);
 const remaining=Math.max(0,generation().maxConnections-model.links.size);
 let added=0;
 for(const e of p.steps){
  if(added>=remaining||(!model.nodes.has(e.to.id)&&model.nodes.size>=MAX_NODES))break;
  const before=model.links.size;model.addConnection(p.root.id,e);added+=model.links.size-before;
 }
 pages.set(p.root.id,p.next);
}
async function crossLinks(opt){
 if(!staticMode||!$('cross-links').checked||model.nodes.size<3)return false;
 const settings=generation(),remaining=settings.maxConnections-model.links.size;
 if(remaining<=0)return;
 const edges=await api('/api/map-links',{artists:[...model.nodes.keys()],existing:[...model.links.values()].map(e=>[e.source,e.target]),...policy(),...settings,maxConnections:remaining},opt);
 if(!opt.signal.aborted){appendLinks(edges);return edges.length>0}
}
async function openArtist(value,opt){
 const p=await api(staticMode?'/api/generate':'/api/neighbors',{artist:value,...policy(),...generation()},opt);
 if(opt.signal.aborted)return;
 clearMap();model.addNode(p.root);
 if(staticMode)appendLinks(p.links);else appendPage(p);
 heading(p.root.name,p.total.toLocaleString()+' direct connections. Select an artist to expand; select a link for evidence.');
 draw(true);selectNode(p.root.id);permalink(p.root.id);
 const added=await crossLinks(opt);if(opt.signal.aborted)return;
 if(added)draw(false);finish(opt)
}
function renderRoute(index){
 const p=routeSet[index];if(!p)return;routeIndex=index;inspect();model.clear();pages.clear();$('detail').replaceChildren();
 model.addNode(p.start);let from=p.start;
 heading('Connection path',p.degrees+' '+(p.degrees===1?'degree':'degrees')+' of separation');
 if(routeSet.length>1){
  const choice=el('select');choice.setAttribute('aria-label','Connection chain');
  routeSet.forEach((r,i)=>{const option=el('option','Chain '+(i+1)+' of '+routeSet.length+' · '+r.steps.slice(0,-1).map(s=>s.to.name).join(' → '));option.value=i;choice.append(option)});
  choice.value=index;choice.onchange=()=>renderRoute(Number(choice.value));$('result').append(choice)
 }
 const name=a=>{const n=el('div',undefined,'artist');n.append(button(a.name,()=>selectNode(a.id)));return n};
 $('result').append(name(from));
 for(const step of p.steps){
  const a=from,line=el('div',step.description||connectionText(a,step.to,step),'edge');line.style.borderLeftColor=category(step.kind)?.color||'#888';
  line.append(listen(...listeningTerms(a,step.to,step)));
  if(staticMode)line.append(button('Evidence',()=>showEvidence(a.id,step.to.id)));
  $('result').append(line,name(step.to));model.addConnection(a.id,step);from=step.to
 }
 draw(true)
}
async function findPath(from,to,opt){
 const p=await api('/api/path',{from,to,...policy(),limit:staticMode?10:1},opt);
 if(opt.signal.aborted)return;clearMap();permalink();
 if(!p.found){heading('No connection found','No path within the search limit.');finish(opt);return}
 routeSet=[p,...(p.alternatives||[])];renderRoute(0);finish(opt)
}
function selectNode(id){
 const n=model.nodes.get(id);if(!n)return;inspect();
 const panel=$('detail');panel.replaceChildren(el('strong',n.name));
 if(n.community){panel.append(el('small',n.size.toLocaleString()+' artists; representative names, not genres.'));for(const a of n.artists)panel.append(button(a.name,()=>searchArtist(a)));return}
 if(n.type||n.disambiguation)panel.append(el('small',[n.type,n.disambiguation].filter(x=>x&&x!=='Unknown').join(' · ')));
 const expand=button('Expand',()=>expandNode(id));expand.disabled=model.links.size>=generation().maxConnections||pages.get(id)===null;
 panel.append(document.createTextNode(' '),expand,listen(n.name));
 if(staticMode)panel.append(button('Evidence',()=>showEvidence(id)),button('Memberships',()=>showTimeline(id)));
 if(routeSet.length){
  const p=routeSet[routeIndex],chain=[p.start,...p.steps.map(s=>s.to)],i=chain.findIndex(a=>a.id===id);
  if(i>0)panel.append(button('Previous',()=>selectNode(chain[i-1].id)));
  if(i>=0&&i<chain.length-1)panel.append(button('Next',()=>selectNode(chain[i+1].id)))
 }
}
async function expandNode(id){
 const opt=begin('Expanding…');
 try{
  const settings=generation(),remaining=settings.maxConnections-model.links.size;
  if(remaining<=0){finish(opt,'Map connection limit reached.');return}
  if(staticMode){
   const exclude=[...new Set([...model.links.values()].filter(e=>e.source===id||e.target===id).map(e=>e.source===id?e.target:e.source))];
   const p=await api('/api/generate',{artist:id,...policy(),...settings,depth:1,maxConnections:remaining,exclude},opt);
   if(opt.signal.aborted)return;appendLinks(p.links);if(!p.links.length)pages.set(id,null);
  }else{const p=await api('/api/neighbors',{artist:id,...policy(),offset:pages.get(id)||0},opt);if(opt.signal.aborted)return;appendPage(p)}
  await crossLinks(opt);if(opt.signal.aborted)return;draw(false);selectNode(id);finish(opt)
 }catch(e){finish(opt,e.message)}
}
function selectLink(id){
 const e=model.links.get(id);if(!e)return;inspect();const a=model.nodes.get(e.source),b=model.nodes.get(e.target);
 $('detail').replaceChildren(el('p',e.description||connectionText(a,b,e)));
 if(e.url)$('detail').append(listen(...listeningTerms(a,b,e)));
 if(staticMode&&!a.community)$('detail').append(button('Evidence',()=>showEvidence(a.id,b.id)))
}
async function showEvidence(a,b,offset=0){
 const c=offset?inspection:inspect(),panel=$('records');if(!offset)panel.append(el('h2',b?'Shared evidence':'Evidence'));
 const loading=spinner('Reading records…');panel.append(loading);if(!offset)panel.scrollIntoView({block:'start'});
 try{
  const p=await api('/api/evidence',{artist:a,...(b?{other:b}:{}),offset},{signal:c.signal});if(c.signal.aborted)return;loading.remove();
  if(!offset)panel.append(el('p',p.total.toLocaleString()+' source records'));
  for(const f of p.records){const n=el('article',undefined,'evidence-record');n.append(el('strong',f.title),el('p',f.kind+' · '+f.participants.map(x=>x.name+' ('+x.role+')').join('; ')),listen(f.title,f.participants.find(p=>p.role==='performer')?.name),document.createTextNode(' · '),link(f.source,'Source record'));panel.append(n)}
  if(p.next!==null){const more=button('More records',()=>{more.remove();showEvidence(a,b,p.next)});panel.append(more)}
 }catch(e){if(!c.signal.aborted)loading.replaceWith(el('p',e.message))}
}

function period(r){
 const date=d=>d?.filter(x=>x!==null).join('-');
 return (date(r.begin)||'Unknown start')+' – '+(date(r.end)||(r.ended?'Ended; date unknown':'End not recorded'))
}
async function showTimeline(id,offset=0,year=''){
 const c=offset?inspection:inspect(),panel=$('records');
 if(!offset){
  panel.append(el('h2','Memberships & roles'));
  const form=el('form',undefined,'year'),input=el('input');input.type='number';input.placeholder='Year';input.value=year;input.setAttribute('aria-label','Year');
  const submit=el('button','Filter');submit.type='submit';form.append(input,submit);form.onsubmit=e=>{e.preventDefault();showTimeline(id,0,input.value)};panel.append(form)
 }
 const loading=spinner('Reading timeline…');panel.append(loading);if(!offset)panel.scrollIntoView({block:'start'});
 try{
  const p=await api('/api/profile',{artist:id,offset,...policy(),...(year?{year:Number(year)}:{})},{signal:c.signal});if(c.signal.aborted)return;loading.remove();
  if(!offset)panel.append(el('p',p.total+' relationships. Unknown dates remain unknown.'));
  for(const r of p.records){const n=el('article',undefined,'evidence-record');n.append(button(r.other.name,()=>searchArtist(r.other)),el('p',r.kind+' · '+period(r)+(r.attributes.length?' · '+r.attributes.join(', '):'')),listen(r.other.name),document.createTextNode(' · '),link(r.source,'Source record'));panel.append(n)}
  if(p.next!==null){const more=button('More relationships',()=>{more.remove();showTimeline(id,p.next,year)});panel.append(more)}
 }catch(e){if(!c.signal.aborted)loading.replaceWith(el('p',e.message))}
}
function autocomplete(key){
 const input=$(key),options=$(key+'-options');let timer,controller,sequence=0;
 const close=()=>{sequence++;clearTimeout(timer);controller?.abort();options.replaceChildren()};
 input.addEventListener('input',()=>{delete input.dataset.id;close();const q=input.value.trim();if(q.length<2)return;const version=sequence;timer=setTimeout(async()=>{controller=new AbortController();options.append(spinner('Searching…'));try{const found=await api('/api/artists',{q},{signal:controller.signal});if(version!==sequence)return;options.replaceChildren();const pick=a=>{input.value=a.name;input.dataset.id=a.id;close()};
    const display=a=>a.name+(a.disambiguation?' — '+a.disambiguation:a.type&&a.type!=='Unknown'?' · '+a.type:'');
    for(const a of found){
     const row=el('div',undefined,'suggestion');row.append(button(display(a),()=>pick(a)));
     if(a.matches>1){row.append(button('+'+(a.matches-1),async()=>{try{const all=await api('/api/artists',{q:a.name,expand:true});if(version!==sequence)return;row.replaceChildren(...all.map((v,i)=>button(display(v)+(v.disambiguation?'':' · '+v.id.slice(0,8)),()=>pick(v))))}catch(e){if(version===sequence)row.append(el('small',e.message))}}))}
     options.append(row)
    }if(!found.length)options.append(el('p','No matches'))}catch(e){if(version===sequence&&e.name!=='AbortError')options.replaceChildren(el('p',e.message))}},250)});
 input.addEventListener('keydown',e=>{if(e.key==='Escape')close();if(e.key==='ArrowDown'){options.querySelector('button')?.focus();e.preventDefault()}});
 document.addEventListener('click',e=>{if(e.target!==input&&!options.contains(e.target))close()});
 return close
}

const closeOptions=['from','to'].map(autocomplete);
async function picked(id,opt){
 const input=$(id),value=input.value.trim();if(input.dataset.id)return input.dataset.id;
 if(!staticMode)return value;
 const found=await api('/api/artists',{q:value},opt),exact=found.find(a=>a.name.toLowerCase()===value.toLowerCase());
 return exact?.id||value
}
async function submit(){
 closeOptions.forEach(fn=>fn());$('settings').open=false;$('filters').open=false;
 const opt=begin(mode==='path'?'Finding connections…':'Reading graph…');
 try{
  if(mode==='path'){const [from,to]=await Promise.all([picked('from',opt),picked('to',opt)]);if(!opt.signal.aborted)await findPath(from,to,opt)}
  else{seed=(Math.random()*4294967296)>>>0;const from=await picked('from',opt);if(!opt.signal.aborted)await openArtist(from,opt)}
 }catch(e){finish(opt,e.message)}
}
function searchArtist(a){setMode('explore');$('from').value=a.name;$('from').dataset.id=a.id;submit()}
$('search').onsubmit=e=>{e.preventDefault();submit()};
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{if(mode!==b.dataset.mode)setMode(b.dataset.mode)};
$('reset').onclick=()=>{
 setMode('explore');for(const id of ['from','to']){$(id).value='';delete $(id).dataset.id}
 $('search').reset();$('filter-options').onchange();layoutSettings();$('settings').open=false;$('filters').open=false;dimension='2D';syncDimension();$('from').focus()
};
let bundle,dimensionRequest=0;
$('dimension').onclick=async e=>{
 const next=e.target.closest('button')?.dataset.dimension;if(!next)return;const request=++dimensionRequest;if(next===dimension)return;
 if(next==='3D'&&typeof ForceGraph3D==='undefined'){
  try{bundle ||= new Promise((resolve,reject)=>{const script=el('script');script.src='force-graph-3d.min.js';script.onload=resolve;script.onerror=()=>reject(Error('3D unavailable'));document.head.append(script)});await bundle}catch(e){bundle=null;status(e.message);return}
 }
 if(request!==dimensionRequest||!model.nodes.size)return;
 dimension=next;syncDimension();draw(true)
};
$('fit').onclick=()=>viewer.fit();
function layoutSettings(){
 viewer.settings={cluster:$('layout-mode').value==='cluster',spacing:Number($('spacing').value),labels:$('labels').checked,nodeSize:Number($('node-size').value),degreeSize:Number($('degree-size').value),repulsion:Number($('repulsion').value),labelSize:Number($('label-size').value)};
 if(model.nodes.size)draw(true)
}
$('layout-settings').onchange=layoutSettings;
$('export').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify({nodes:[...model.nodes.values()],links:[...model.links.values()]},null,2)],{type:'application/json'}));const a=el('a');a.href=u;a.download='musicatlas-map.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};
$('overview').onclick=async()=>{
 $('settings').open=false;setMode('explore');const opt=begin('Reading communities…');
 try{
  const a=await api('/api/atlas',{},opt);if(opt.signal.aborted)return;
  if(!a){finish(opt,'No community index in this snapshot.');return}
  const nodes=a.nodes.slice(0,40),ids=new Set(nodes.map(n=>n.id));
  for(const n of nodes)model.addNode({...n,community:true});
  for(const [i,e] of a.links.filter(e=>ids.has(e.source)&&ids.has(e.target)).slice(0,90).entries())model.addLink({...e,id:'community:'+i,kind:'community'});
  heading('Musical communities','Select a community to explore representative artists.');draw(true);finish(opt)
 }catch(e){finish(opt,e.message)}
};
function filters(categories){
 const choices=categories||relationshipTypes;
 for(const [key,c] of Object.entries(choices)){
  const row=el('label'),input=el('input');input.type='checkbox';input.checked=true;input.defaultChecked=true;input.name=key;
  const swatch=el('i',undefined,'swatch');swatch.style.background=c.color||relationshipTypes[key]?.color||'#888';row.append(input,swatch,document.createTextNode(c.label));$('filter-options').append(row)
 }
 const count=()=>$('filter-count').textContent='('+document.querySelectorAll('#filter-options input:checked').length+'/'+Object.keys(choices).length+')';
 count();$('filter-options').onchange=()=>{count();if(model.nodes.size||$('submit').disabled){operation?.abort();clearMap();$('submit').disabled=false;status('Relationships changed. Run the search again.')}}
}
filters(relationshipTypes);$('api-link').hidden=!staticMode;$('overview').hidden=!staticMode;$('generation-settings').hidden=!staticMode;
api('/api/stats').then(s=>$('stats').textContent=s.artist.toLocaleString()+' artists · '+s.fact.toLocaleString()+' evidence records').catch(e=>$('stats').textContent=e.message);
setMode('explore',false);
const initial=new URL(location.href).searchParams.get('artist');if(initial){$('from').value=initial;$('from').dataset.id=initial;submit()}
