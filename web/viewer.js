/* Both renderers consume the same map model. 2D is the default; 3D is optional. */
const palette={Person:'#55c5b5',Group:'#e6b76e',Orchestra:'#e6b76e',Choir:'#e6b76e',Unknown:'#a8b2bf'};
const nodeColor=n=>palette[n.type]||'#b8a0eb';
const edgeColor=e=>category(e.kind)?.color||'#637588';
const size=(n,s)=>s.nodeSize*Math.min(14,4+Math.sqrt(n.degree||0)*s.degreeSize);
function layoutData(model,settings){
 const nodes=[...model.nodes.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(n=>({...n,degree:0,group:0}));
 const ids=new Map(nodes.map(n=>[n.id,n])),votes=new Map(nodes.map(n=>[n.id,new Map()]));
 const links=[...model.links.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(e=>({...e}));
 for(const e of links){
  const bit=category(e.kind)?.bit||0;
  for(const id of [e.source,e.target]){
   const n=ids.get(id);if(!n)continue;n.degree++;
   const v=votes.get(id);v.set(bit,(v.get(bit)||0)+1);
  }
 }
 for(const n of nodes)n.group=[...votes.get(n.id)].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0]||0;
 const groups=[...new Set(nodes.map(n=>n.group))],centers=new Map();
 const radius=groups.length>1?settings.spacing*Math.sqrt(nodes.length)*.65:0;
 groups.forEach((g,i)=>{const a=2*Math.PI*i/groups.length;centers.set(g,{x:Math.cos(a)*radius,y:Math.sin(a)*radius,z:0})});
 const counts=new Map();
 for(const n of nodes){
  const i=counts.get(n.group)||0;counts.set(n.group,i+1);
  const c=centers.get(n.group),angle=i*2.3999632297,r=Math.sqrt(i)*settings.spacing*.45;
  n.anchor=c;n.initial={x:c.x+Math.cos(angle)*r,y:c.y+Math.sin(angle)*r,z:Math.sin(i*1.7)*r*.3};
 }
 // Layouts are views over the same evidence graph, never new relationships.
 if(settings.layout==='interesting'||settings.layout==='radial'){
  const neighbors=new Map(nodes.map(n=>[n.id,[]]));
  for(const e of links){neighbors.get(e.source)?.push(e.target);neighbors.get(e.target)?.push(e.source)}
  const root=nodes.find(n=>n.root)||nodes[0],depths=new Map(),layers=[];
  if(root){
   depths.set(root.id,0);layers.push([root.id]);
   for(let d=0;d<layers.length;d++){
    const next=[];
    for(const id of layers[d]){
     const adjacent=neighbors.get(id).slice().sort((a,b)=>(ids.get(b).interest||0)-(ids.get(a).interest||0)||a.localeCompare(b));
     for(const to of adjacent)if(!depths.has(to)){depths.set(to,d+1);next.push(to)}
    }
    if(next.length)layers.push(next)
   }
   const disconnected=nodes.filter(n=>!depths.has(n.id));if(disconnected.length)layers.push(disconnected.map(n=>n.id));
   let radius=0;
   for(const [d,ring] of layers.entries()){
    if(d)radius=Math.max(radius+settings.spacing*1.25,ring.length*settings.spacing/(2*Math.PI));
    for(const [i,id] of ring.entries()){
     const n=ids.get(id),angle=i*2*Math.PI/ring.length+d*.32;
     n.anchor={x:Math.cos(angle)*radius,y:Math.sin(angle)*radius,z:0};
     n.initial={...n.anchor};
    }
   }
  }
 }
 for(const e of links){
  const a=ids.get(e.source),b=ids.get(e.target),bit=category(e.kind)?.bit||0;
  const hub=Math.min(2,Math.log1p(Math.max(a?.degree||0,b?.degree||0))*.28);
  e.distance=settings.spacing*(settings.layout==='interesting'?1+hub+(bit===2?-.16:bit===8?.16:0):1);
  e.strength=settings.layout==='interesting'?Math.max(.12,.8/Math.sqrt(Math.max(1,Math.min(a?.degree||1,b?.degree||1)))):undefined;
 }
 return {nodes,links};
}
function labelSprite(n,s){
 const t=new SpriteText(s.labels?n.name:'');t.color='#fff';t.backgroundColor='#181818';t.padding=1;t.fontWeight='600';t.textHeight=s.labelSize*Math.min(11,Math.max(6,size(n,s)));t.strokeWidth=.25;t.strokeColor='#181818';t.material.opacity=1;t.material.alphaTest=.05;t.material.depthTest=false;t.material.depthWrite=false;t.material.transparent=true;t.renderOrder=100;t.visible=s.labels;return t
}
const safeLabel=value=>{const el=document.createElement('span');el.textContent=value;return el};
function hoverText(model,item,edge=false){
 if(!item||!model)return '';
 if(edge){
  const e=model.links.get(item.id),a=model.nodes.get(e?.source),b=model.nodes.get(e?.target);
  if(!a||!b)return '';
  return (category(e.kind)?.label||e.kind)+' · '+(e.description||connectionText(a,b,e))
 }
 const n=model.nodes.get(item.id);if(!n)return '';
 const info=[n.name,n.disambiguation,n.type!=='Unknown'?n.type:null].filter(Boolean);
 const count=item.degree;
 if(Number.isFinite(n.connections))info.push(n.connections.toLocaleString()+' known connections');
 if(Number.isFinite(count))info.push(count+' in this map');
 return info.join(' · ')
}
class MapViewer {
 constructor(el,{onNode,onLink,onFallback}){
  this.settings={layout:'interesting',spacing:65,labels:true,nodeSize:1,degreeSize:.6,repulsion:1.4,labelSize:1};this.el=el;this.onNode=onNode;this.onLink=onLink;this.onFallback=onFallback;
  this.resize=new ResizeObserver(()=>this.measure());this.resize.observe(el);
 }
 measure(){
  if(this.three&&this.el.clientWidth&&this.el.clientHeight)this.three.width(this.el.clientWidth).height(this.el.clientHeight);
  this.cy?.resize();
 }
 destroy(){
  this.clearHover();this.el.onpointerleave=null;
  if(this.labelFrame)cancelAnimationFrame(this.labelFrame);this.labelFrame=null;this.layout?.stop();this.layout=null;this.layoutWorker?.terminate();this.layoutWorker=null;this.three?._destructor();this.cy?.destroy();this.three=this.cy=null;this.current=null;
  this.tooltip=null;this.el.replaceChildren();
 }
 mode(mode){
  if(mode===this.current)return;
  this.destroy();this.current=mode;
  if(mode==='3D'){
   try{
    this.three=new ForceGraph3D(this.el,{controlType:'orbit',rendererConfig:{antialias:true}})
     .backgroundColor('#181818').showNavInfo(false).nodeId('id').nodeLabel(n=>safeLabel(hoverText(this.model,n)))
     .nodeColor(n=>n.id===this.selected?'#d9c4ff':nodeColor(n)).nodeVal(n=>Math.pow(size(n,this.settings)/4,3)).nodeThreeObjectExtend(true).nodeThreeObject(n=>labelSprite(n,this.settings))
     .nodeResolution(8).nodeOpacity(1).linkColor(edgeColor).linkOpacity(.92).linkWidth(e=>this.hoveredEdge===e.id?1.2:.35)
     .linkLabel(e=>safeLabel(hoverText(this.model,e,true)))
     .onLinkHover(e=>{this.hoveredEdge=e?.id;this.three?.linkWidth(l=>l.id===this.hoveredEdge?1.2:.35)})
     .onNodeClick(n=>this.onNode(n.id)).onLinkClick(e=>this.onLink(e.id)).enableNodeDrag(true)
     .cooldownTicks(100).onEngineStop(()=>{if(this.fitPending){this.fitPending=false;this.fit()}});
    this.measure();
   }catch(e){
    console.warn('3D renderer unavailable',e);this.destroy();this.current=null;this.mode('2D');this.onFallback?.();
   }
  }else{
   this.labelZoom=1;this.cy=cytoscape({container:this.el,elements:[],style:[
    {selector:'node',style:{
     'background-color':n=>nodeColor(n.data()),'background-fill':'radial-gradient',
     'background-gradient-stop-colors':n=>'#e5e0ed '+nodeColor(n.data()),
     'background-gradient-stop-positions':'0% 85%','border-width':.7,'border-color':'#999',
     label:n=>this.settings.labels&&(this.cy?.nodes().length<=30||this.labelZoom>=.6||n.selected()||n.data('root')||n.data('degree')>=4)?n.data('name'):'',color:getComputedStyle(document.body).color,
     'text-opacity':1,'text-background-color':getComputedStyle(document.body).backgroundColor,'text-background-opacity':1,'text-background-padding':2,'font-weight':600,
     'font-size':n=>Math.max(12/Math.max(.05,this.labelZoom||1),Math.min(21,size(n.data(),this.settings)*1.5*this.settings.labelSize)),
     'min-zoomed-font-size':0,'text-valign':'top','text-margin-y':-3,'text-halign':'center',
     'text-outline-width':1,'text-outline-color':getComputedStyle(document.body).backgroundColor,
     'text-wrap':'none','z-index-compare':'manual','z-index':2,
     width:n=>size(n.data(),this.settings)*2.4,height:n=>size(n.data(),this.settings)*2.4
    }},
    {selector:'node[root]',style:{'border-width':2,'border-color':'#b8a0eb','font-weight':600}},
    {selector:'node:selected',style:{label:n=>this.settings.labels?n.data('name'):'','underlay-color':'#b8a0eb','underlay-opacity':.24,'underlay-padding':5,'border-width':2,'border-color':'#b8a0eb','z-index':10}},
    {selector:'edge',style:{'line-color':e=>edgeColor(e.data()),width:1.2,opacity:.9,'curve-style':'bezier','z-index-compare':'manual','z-index':0}},
    {selector:'edge.hover-link',style:{width:3,'z-index':1,opacity:1}},
    {selector:'node.hover-node',style:{'border-width':2,'border-color':'#b8a0eb','z-index':9,label:n=>n.data('name')}},
    {selector:'edge[kind = "cover"],edge[kind = "cover-reference"],edge[kind = "tribute"]',style:{'line-style':'dashed'}}
   ]});
   this.cy.on('zoom',()=>{
    const zoom=this.cy.zoom(),bucket=Math.max(.05,Math.round(zoom*20)/20);
    if(bucket===this.labelZoom)return;this.labelZoom=bucket;
    if(this.labelFrame)return;
    this.labelFrame=requestAnimationFrame(()=>{this.labelFrame=null;this.cy?.style().update()})
   });
   this.tooltip=document.createElement('div');this.tooltip.className='graph-tooltip';this.tooltip.hidden=true;this.tooltip.setAttribute('role','tooltip');this.el.append(this.tooltip);
   this.cy.on('mouseover','node,edge',e=>this.showHover(e));
   this.cy.on('mousemove','node,edge',e=>this.moveHover(e));
   this.cy.on('mouseout grab drag pan zoom','node,edge',()=>this.clearHover());
   this.cy.on('pan zoom',()=>this.clearHover());
   this.el.onpointerleave=()=>this.clearHover();
   this.cy.on('tap','node',e=>this.onNode(e.target.id()));
   this.cy.on('tap','edge',e=>this.onLink(e.target.id()));
  }
 }
 clearHover(){
  this.hoveredEdge=null;
  if(this.hoverElements){this.hoverElements.removeClass('hover-node hover-link');this.hoverElements=null}
  if(this.tooltip)this.tooltip.hidden=true;
 }
 showHover(event){
  if(!this.tooltip||event.originalEvent?.pointerType==='touch')return;
  this.clearHover();
  const target=event.target,edge=target.isEdge();
  const content=hoverText(this.model,target.data(),edge);if(!content)return;
  this.hoverElements=edge?target.union(target.connectedNodes()):target.union(target.connectedEdges());
  this.hoverElements.nodes().addClass('hover-node');this.hoverElements.edges().addClass('hover-link');
  this.tooltip.textContent=content;this.tooltip.hidden=false;this.moveHover(event)
 }
 moveHover(event){
  if(!this.tooltip||this.tooltip.hidden)return;
  const r=event.renderedPosition;if(!r)return;
  const w=this.tooltip.offsetWidth,h=this.tooltip.offsetHeight;
  this.tooltip.style.left=Math.max(4,Math.min(this.el.clientWidth-w-4,r.x+12))+'px';
  this.tooltip.style.top=Math.max(4,Math.min(this.el.clientHeight-h-4,r.y+14))+'px'
 }
 select(id){
  this.clearHover();
  this.selected=id;
  if(this.cy){this.cy.nodes().unselect();if(id)this.cy.getElementById(id).select();this.cy.style().update()}
  if(this.three)this.three.nodeColor(n=>n.id===id?'#d9c4ff':nodeColor(n))
 }
 update(model,reset=false,relayout=true){
  this.clearHover();this.model=model;
  const {nodes,links}=layoutData(model,this.settings),{layout,spacing}=this.settings;
  const cluster=layout==='cluster',radial=layout==='radial',interesting=layout==='interesting';
  if(this.three){
   if(!relayout){this.three.nodeThreeObject(n=>labelSprite(n,this.settings));this.three.nodeVal(n=>Math.pow(size(n,this.settings)/4,3));return}
   const previous=reset?new Map():new Map(this.three.graphData().nodes.map(n=>[n.id,n]));
   const data=nodes.map(n=>Object.assign(previous.get(n.id)||{...n.initial},n));
   this.fitPending=reset;
   this.three.graphData({nodes:data,links});
   this.three.nodeThreeObject(n=>labelSprite(n,this.settings));
   this.three.nodeVal(n=>Math.pow(size(n,this.settings)/4,3));
   this.three.d3Force('link').distance(e=>e.distance||spacing).strength(e=>radial?.035:e.strength??.25);
   this.three.d3Force('charge').strength(-spacing*3*this.settings.repulsion);
   this.three.d3Force('collision',forceCollide(n=>size(n,this.settings)+8));
   for(const [axis,force] of [['x',forceX],['y',forceY],['z',forceZ]])this.three.d3Force('cluster-'+axis,(cluster||radial||interesting)?force(n=>n.anchor[axis]).strength(radial?.8:cluster?.12:.035):null);
   this.three.d3ReheatSimulation();
   if(nodes.length===1)this.fit();
  }else if(this.cy){
   if(!relayout){this.cy.style().update();return}
   this.layout?.stop();this.layoutWorker?.terminate();this.layoutWorker=null;this.cy.nodes().stop(true,false);
   const old=reset?new Map():new Map(this.cy.nodes().map(n=>[n.id(),{...n.position()}]));
   const initial=new Map(old),siblings=new Map();
   // Start new artists near their existing parent, rather than at the map center.
   for(const e of model.links.values()){
    const a=initial.has(e.source)?e.source:initial.has(e.target)?e.target:null;
    if(a===null)continue;const b=a===e.source?e.target:e.source;
    if(initial.has(b))continue;
    const i=siblings.get(a)||0,p=initial.get(a),angle=i*2.3999632297,r=spacing*(1+Math.sqrt(i)*.35);
    siblings.set(a,i+1);initial.set(b,{x:p.x+Math.cos(angle)*r,y:p.y+Math.sin(angle)*r});
   }
   for(const n of nodes)if(!initial.has(n.id))initial.set(n.id,n.initial);
   const data=nodes.map(n=>({data:n,position:initial.get(n.id)})).concat(links.map(e=>({data:e})));
   this.cy.json({elements:data});
   this.cy.style().update();this.select(this.selected);
   if(!nodes.length)return;
   const animate=!matchMedia('(prefers-reduced-motion: reduce)').matches;
   if(!radial&&(interesting||nodes.length>200)){
    // Barnes-Hut repulsion off-thread, with soft anchors for existing positions.
    const worker=new Worker('layout-worker.min.js');this.layoutWorker=worker;
    const cy=this.cy;
    if(reset)cy.fit(undefined,35);
    worker.onmessage=({data:positions})=>{
     if(this.layoutWorker!==worker)return;
     worker.terminate();this.layoutWorker=null;
     this.layout=cy.layout({name:'preset',positions,fit:reset,padding:35,animate:animate&&nodes.length<1500,animationDuration:240});this.layout.run();
    };
    worker.onerror=()=>{if(this.layoutWorker===worker){worker.terminate();this.layoutWorker=null;console.warn('Large-map layout unavailable; retaining placed nodes')}};
    worker.postMessage({nodes:nodes.map(n=>{const p=nodes.length<=200?n.initial:initial.get(n.id);return {id:n.id,x:p.x,y:p.y,x0:p.x,y0:p.y,old:old.has(n.id),radius:size(n,this.settings)*1.2,anchor:n.anchor}}),links:links.map(e=>({source:e.source,target:e.target,distance:e.distance,strength:e.strength})),spacing,repulsion:this.settings.repulsion,layout});
    return
   }
   const canonical=new Map(nodes.map(n=>[n.id,n.initial]));
   // Compute targets from canonical coordinates, then animate from the actual current view.
   this.cy.nodes().positions(n=>canonical.get(n.id()));
   if(!cluster&&!radial&&nodes.length>1)this.cy.layout({name:'cose',animate:false,randomize:false,fit:false,idealEdgeLength:spacing,nodeRepulsion:spacing*100*this.settings.repulsion}).run();
   const target=Object.fromEntries(this.cy.nodes().map(n=>[n.id(),{...n.position()}]));
   if(animate&&!reset)this.cy.nodes().positions(n=>old.get(n.id())||target[n.id()]);
   this.layout=this.cy.layout({name:'preset',positions:target,fit:reset,padding:35,animate:animate&&!reset,animationDuration:240});
   this.layout.run();
  }
 }
 fit(){if(this.three)this.three.zoomToFit(350,55);else this.cy?.fit(undefined,35)}
 focus(id){
  if(this.three){
   const n=this.three.graphData().nodes.find(n=>n.id===id);
   if(!n||![n.x,n.y,n.z].every(Number.isFinite))return;
   const camera=this.three.cameraPosition(),dx=camera.x-n.x,dy=camera.y-n.y,dz=camera.z-n.z,dist=Math.hypot(dx,dy,dz)||1;
   this.three.cameraPosition({x:n.x+dx/dist*110,y:n.y+dy/dist*110,z:n.z+dz/dist*110},{x:n.x,y:n.y,z:n.z},400);
  }else if(this.cy){const n=this.cy.getElementById(id);if(n.length)this.cy.animate({center:{eles:n},zoom:1.5},{duration:300})}
 }
}
class AtlasMap {
 nodes=new Map();links=new Map();
 clear(){this.nodes.clear();this.links.clear()}
 addNode(n){this.nodes.set(n.id,{...this.nodes.get(n.id),...n})}
 addLink(e){this.links.set(e.id,{...e})}
 addConnection(from,s){this.addNode(s.to);this.addLink({id:'link:'+JSON.stringify([...([from,s.to.id].sort()),s.kind]),source:from,target:s.to.id,kind:s.kind,title:s.title,url:s.source,performer:s.performer,producer:s.producer,original:s.original,description:s.description})}
}
