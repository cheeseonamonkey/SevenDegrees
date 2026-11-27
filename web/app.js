const $=id=>document.getElementById(id);
const make=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el};
let graphPromise;
async function api(path,params={}){
 if(document.querySelector('meta[name="static-graph"]')){
  graphPromise ||= fetch('graph.json').then(r=>{if(!r.ok)throw Error('Graph unavailable');return r.json()}).then(localGraph);
  const g=await graphPromise;
  if(path==='/api/artists')return g.search(params.q);
  if(path==='/api/path')return g.path(params.from,params.to,params.strict);
  return g.stats();
 }
 const r=await fetch(path+'?'+new URLSearchParams(params));const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data;
}
for(const key of ['from','to']){
 const input=$(key), options=$(key+'-options');let timer,sequence=0;
 const close=()=>{sequence++;clearTimeout(timer);options.replaceChildren()};
 input.addEventListener('input',()=>{delete input.dataset.id;close();const n=sequence;if(!input.value.trim())return;timer=setTimeout(async()=>{try{const artists=await api('/api/artists',{q:input.value});if(n!==sequence)return;for(const a of artists){const b=make('button',a.name);b.type='button';b.addEventListener('click',()=>{input.value=a.name;input.dataset.id=a.id;close()});options.append(b)}}catch{close()}},160)});
 input.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
 document.addEventListener('click',e=>{if(e.target!==input&&!options.contains(e.target))close()});
}
$('search').addEventListener('submit',async e=>{
 e.preventDefault();const result=$('result'),button=e.currentTarget.querySelector('button[type=submit]');button.disabled=true;result.replaceChildren(make('p','Searching the graph…'));
 try{const artist=k=>$(k).dataset.id||$(k).value.trim();const p=await api('/api/path',{from:artist('from'),to:artist('to'),strict:$('strict').checked});
 result.replaceChildren();
 if(!p.found){result.append(make('h2','No path within seven degrees'),make('p','This graph is incomplete. A missing path does not mean the artists are unrelated.'));return}
 result.append(make('h2',p.degrees+' degree'+(p.degrees===1?'':'s')),make('div',p.start.name,'artist'));
 for(const s of p.steps){const edge=make('div',undefined,'edge'),a=make('a','Source ↗');edge.append(make('span',s.kind,'kind'),make('b',s.title));try{const u=new URL(s.source);if(u.protocol==='https:'){a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';edge.append(a)}}catch{}result.append(edge,make('div',s.to.name,'artist'))}
 }catch(err){result.replaceChildren(make('h2','Could not find a connection'),make('p',err.message))}finally{button.disabled=false}
});
api('/api/stats').then(s=>$('stats').textContent=s.artist.toLocaleString()+' connected artists · '+s.fact.toLocaleString()+' evidence records').catch(()=>{});
