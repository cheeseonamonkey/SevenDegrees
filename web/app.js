const $=id=>document.getElementById(id);
const make=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el};
const staticMode=!!document.querySelector('meta[name="static-graph"]');
let worker,nextRequest=0,mode='path',network,requestVersion=0;
const pending=new Map();
function staticAPI(path,params){
 if(!worker){
  worker=new Worker('graph-worker.js');
  worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.value)};
  worker.onerror=()=>{for(const p of pending.values())p.reject(Error('Graph worker failed'));pending.clear();worker.terminate();worker=undefined};
 }
 return new Promise((resolve,reject)=>{const id=++nextRequest;pending.set(id,{resolve,reject});worker.postMessage({id,path,params:{...params,scope:$('scope').value}})});
}
async function api(path,params={}){
 if(staticMode)return staticAPI(path,params);
 const r=await fetch(path+'?'+new URLSearchParams(params));const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data;
}
function autocomplete(key){
 const input=$(key),options=$(key+'-options');let timer,sequence=0;
 const close=()=>{sequence++;clearTimeout(timer);options.replaceChildren()};
 input.addEventListener('input',()=>{delete input.dataset.id;close();const n=sequence;if(!input.value.trim())return;timer=setTimeout(async()=>{try{const artists=await api('/api/artists',{q:input.value});if(n!==sequence)return;for(const a of artists){const b=make('button',a.name);b.type='button';b.addEventListener('click',()=>{input.value=a.name;input.dataset.id=a.id;close()});options.append(b)}}catch(e){if(n===sequence){options.append(make('p',e.message))}}},200)});
 input.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
 document.addEventListener('click',e=>{if(e.target!==input&&!options.contains(e.target))close()});
 return close;
}
const closeOptions=['from','to'].map(autocomplete);
const artist=k=>$(k).dataset.id||$(k).value.trim();
const link=(source)=>{const a=make('a','Evidence');try{const u=new URL(source);if(u.protocol==='https:'){a.href=u.href;a.target='_blank';a.rel='noopener noreferrer'}}catch{}return a};
function clearGraph(){if(network){network.destroy();network=undefined}$('network').hidden=true;$('detail').replaceChildren()}
function renderPath(p){
 const result=$('result');if(!p.found){result.replaceChildren(make('h2','No path within seven degrees'),make('p','No path in the selected dataset.'));return}
 result.replaceChildren(make('h2',p.degrees+' degree'+(p.degrees===1?'':'s')),make('div',p.start.name,'artist'));
 for(const s of p.steps){const edge=make('div',s.kind+' · '+s.title,'edge');edge.append(link(s.source));result.append(edge,make('div',s.to.name,'artist'))}
}
function renderNetwork(p){
 $('result').replaceChildren(make('h2',p.root.name),make('p',p.steps.length+' of '+p.total.toLocaleString()+' direct connections. Select an edge for evidence; select an artist to explore it.'));
 const elements=[{data:{id:p.root.id,label:p.root.name,root:true}}];
 p.steps.forEach((s,i)=>{elements.push({data:{id:s.to.id,label:s.to.name}},{data:{id:'e'+i,source:p.root.id,target:s.to.id,kind:s.kind,title:s.title,url:s.source}})});
 $('network').hidden=false;
 const color=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
 network=cytoscape({container:$('network'),elements,layout:{name:'concentric',concentric:n=>n.data('root')?2:1,levelWidth:()=>1,minNodeSpacing:22},style:[
 {selector:'node',style:{label:'data(label)','font-size':10,'background-color':color,'text-valign':'bottom','text-margin-y':5,color:getComputedStyle(document.body).color,width:14,height:14}},
 {selector:'node[root]',style:{width:27,height:27,'font-weight':'bold'}},
 {selector:'edge',style:{width:1.5,'line-color':'#888','curve-style':'straight'}}
 ]});
 network.on('tap','edge',e=>{const d=e.target.data();$('detail').replaceChildren(make('span',d.kind+' · '+d.title+' '),link(d.url))});
 network.on('tap','node',e=>{const d=e.target.data();if(d.root)return;$('from').value=d.label;$('from').dataset.id=d.id;$('search').requestSubmit()});
}
function setMode(next){mode=next;requestVersion++;$('submit').disabled=false;clearGraph();$('destination').hidden=mode==='explore';$('submit').textContent=mode==='path'?'Find path':'Explore';for(const b of document.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));$('result').replaceChildren()}
for(const b of document.querySelectorAll('[data-mode]'))b.addEventListener('click',()=>setMode(b.dataset.mode));
$('search').addEventListener('submit',async e=>{
 e.preventDefault();const version=++requestVersion,button=$('submit'),result=$('result');button.disabled=true;clearGraph();result.replaceChildren(make('p','Searching…'));
 try{const strict=$('strict').checked;const p=mode==='path'?await api('/api/path',{from:artist('from'),to:artist('to'),strict}):await api('/api/neighbors',{artist:artist('from'),strict});
 if(version!==requestVersion)return;mode==='path'?renderPath(p):renderNetwork(p)
 }catch(err){if(version===requestVersion)result.replaceChildren(make('p',err.message))}finally{if(version===requestVersion)button.disabled=false}
});
async function refreshStats(){
 const scope=$('scope').value;try{const s=await api('/api/stats');if(scope!==$('scope').value)return;$('stats').textContent=s.artist.toLocaleString()+' artists · '+s.fact.toLocaleString()+' evidence records'}catch(e){$('stats').textContent=e.message}
}
if(staticMode){
 $('api-link').hidden=false;
 fetch('api/v1/manifest.json').then(r=>r.json()).then(m=>{
  $('scope-row').hidden=false;
  $('scope').querySelector('[value=full]').disabled=!m.full;
  if(m.full)$('scope-note').textContent='Full graph: '+(m.full.bytes/1048576).toFixed(0)+' MiB download; recommended for desktop.';
  else if(m.corpus_stats)$('scope-note').textContent='Full corpus: '+m.corpus_stats.artist.toLocaleString()+' artists / '+m.corpus_stats.fact.toLocaleString()+' facts (release download).';
 }).catch(()=>{});
 $('scope').addEventListener('change',()=>{for(const close of closeOptions)close();for(const k of ['from','to'])delete $(k).dataset.id;setMode(mode);refreshStats()});
}
refreshStats();
