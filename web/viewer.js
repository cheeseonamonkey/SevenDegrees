/* Both renderers consume the same map model. 2D is the default; 3D is optional. */
const palette={Person:'#55c5b5',Group:'#e6b76e',Orchestra:'#e6b76e',Choir:'#e6b76e',Unknown:'#a8b2bf'};
const nodeColor=n=>n.community?'#8aace8':palette[n.type]||'#b8a0eb';
const edgeColor=e=>category(e.kind)?.color||'#637588';
const size=(n,s)=>s.nodeSize*(n.community?Math.min(10,4+Math.log1p(n.size)*.35):Math.min(14,4+Math.sqrt(n.degree||0)*s.degreeSize));
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
 return {nodes,links};
}
function labelSprite(n,s){
 const t=new SpriteText(s.labels&&(!n.community||n.degree>=5)?n.name:'');t.color='#eee';t.textHeight=s.labelSize*Math.min(6,Math.max(2.5,size(n,s)*.65));t.strokeWidth=.5;t.strokeColor='#181818';t.material.depthTest=false;t.material.depthWrite=false;t.material.transparent=true;t.renderOrder=100;return t
}
const safeLabel=value=>{const el=document.createElement('span');el.textContent=value;return el};
class MapViewer {
 constructor(el,{onNode,onLink,onFallback}){
  this.settings={cluster:false,spacing:65,labels:true,nodeSize:1,degreeSize:.6,repulsion:1.4,labelSize:1};this.el=el;this.onNode=onNode;this.onLink=onLink;this.onFallback=onFallback;
  this.resize=new ResizeObserver(()=>this.measure());this.resize.observe(el);
 }
 measure(){
  if(this.three&&this.el.clientWidth&&this.el.clientHeight)this.three.width(this.el.clientWidth).height(this.el.clientHeight);
  this.cy?.resize();
 }
 destroy(){
  this.layout?.stop();this.layout=null;this.three?._destructor();this.cy?.destroy();this.three=this.cy=null;this.current=null;
  this.el.replaceChildren();
 }
 mode(mode){
  if(mode===this.current)return;
  this.destroy();this.current=mode;
  if(mode==='3D'){
   try{
    this.three=new ForceGraph3D(this.el,{controlType:'orbit',rendererConfig:{antialias:true}})
     .backgroundColor('#181818').showNavInfo(false).nodeId('id').nodeLabel(n=>safeLabel(n.name))
     .nodeColor(n=>n.id===this.selected?'#d9c4ff':nodeColor(n)).nodeVal(n=>Math.pow(size(n,this.settings)/4,3)).nodeThreeObjectExtend(true).nodeThreeObject(n=>labelSprite(n,this.settings))
     .nodeResolution(8).nodeOpacity(1).linkColor(edgeColor).linkOpacity(.92).linkWidth(e=>e.weight?Math.min(3,Math.log10(e.weight+1)/2):.35)
     .linkLabel(e=>safeLabel(e.weight?e.weight.toLocaleString()+' links':e.title||e.kind))
     .onNodeClick(n=>this.onNode(n.id)).onLinkClick(e=>this.onLink(e.id)).enableNodeDrag(true)
     .cooldownTicks(100).onEngineStop(()=>{if(this.fitPending){this.fitPending=false;this.fit()}});
    this.measure();
   }catch(e){
    console.warn('3D renderer unavailable',e);this.destroy();this.current=null;this.mode('2D');this.onFallback?.();
   }
  }else{
   this.cy=cytoscape({container:this.el,elements:[],style:[
    {selector:'node',style:{
     'background-color':n=>nodeColor(n.data()),'background-fill':'radial-gradient',
     'background-gradient-stop-colors':n=>'#e5e0ed '+nodeColor(n.data()),
     'background-gradient-stop-positions':'0% 85%','border-width':.7,'border-color':'#999',
     label:n=>this.settings.labels?n.data('name'):'',color:getComputedStyle(document.body).color,
     'font-size':n=>Math.max(9,Math.min(16,size(n.data(),this.settings)*.9*this.settings.labelSize)),
     'min-zoomed-font-size':7,'text-valign':'top','text-margin-y':-3,'text-halign':'center',
     'text-outline-width':2,'text-outline-color':getComputedStyle(document.body).backgroundColor,
     'text-wrap':'wrap','text-max-width':120,'z-index-compare':'manual','z-index':2,
     width:n=>size(n.data(),this.settings)*2.4,height:n=>size(n.data(),this.settings)*2.4
    }},
    {selector:'node[root]',style:{'border-width':2,'border-color':'#b8a0eb','font-weight':600}},
    {selector:'node:selected',style:{'underlay-color':'#b8a0eb','underlay-opacity':.24,'underlay-padding':5,'border-width':2,'border-color':'#b8a0eb','z-index':10}},
    {selector:'edge',style:{'line-color':e=>edgeColor(e.data()),width:1.2,opacity:.9,'curve-style':'bezier','z-index-compare':'manual','z-index':0}},
    {selector:'edge[kind = "cover"],edge[kind = "cover-reference"],edge[kind = "tribute"]',style:{'line-style':'dashed'}}
   ]});
   this.cy.on('tap','node',e=>this.onNode(e.target.id()));
   this.cy.on('tap','edge',e=>this.onLink(e.target.id()));
  }
 }
 select(id){
  this.selected=id;
  if(this.cy){this.cy.nodes().unselect();if(id)this.cy.getElementById(id).select()}
  if(this.three)this.three.nodeColor(n=>n.id===id?'#d9c4ff':nodeColor(n))
 }
 update(model,reset=false,relayout=true){
  const {nodes,links}=layoutData(model,this.settings),{cluster,spacing}=this.settings;
  if(this.three){
   if(!relayout){this.three.nodeThreeObject(n=>labelSprite(n,this.settings));this.three.nodeVal(n=>Math.pow(size(n,this.settings)/4,3));return}
   const previous=reset?new Map():new Map(this.three.graphData().nodes.map(n=>[n.id,n]));
   const data=nodes.map(n=>Object.assign(previous.get(n.id)||{...n.initial},n));
   this.fitPending=reset;
   this.three.graphData({nodes:data,links});
   this.three.nodeThreeObject(n=>labelSprite(n,this.settings));
   this.three.nodeVal(n=>Math.pow(size(n,this.settings)/4,3));
   this.three.d3Force('link').distance(spacing);
   this.three.d3Force('charge').strength(-spacing*3*this.settings.repulsion);
   this.three.d3Force('collision',forceCollide(n=>size(n,this.settings)+8));
   for(const [axis,force] of [['x',forceX],['y',forceY],['z',forceZ]])this.three.d3Force('cluster-'+axis,cluster?force(n=>n.anchor[axis]).strength(.12):null);
   this.three.d3ReheatSimulation();
   if(nodes.length===1)this.fit();
  }else if(this.cy){
   if(!relayout){this.cy.style().update();return}
   this.layout?.stop();this.cy.nodes().stop(true,false);
   const old=reset?new Map():new Map(this.cy.nodes().map(n=>[n.id(),{...n.position()}]));
   const data=nodes.map(n=>({data:n,position:old.get(n.id)||n.initial})).concat(links.map(e=>({data:e})));
   this.cy.json({elements:data});
   this.cy.style().update();this.select(this.selected);
   if(!nodes.length)return;
   const animate=!matchMedia('(prefers-reduced-motion: reduce)').matches;
   const initial=new Map(nodes.map(n=>[n.id,n.initial]));
   // Compute targets from canonical coordinates, then animate from the actual current view.
   this.cy.nodes().positions(n=>initial.get(n.id()));
   if(!cluster&&nodes.length>1)this.cy.layout({name:'cose',animate:false,randomize:false,fit:false,idealEdgeLength:spacing,nodeRepulsion:spacing*100*this.settings.repulsion}).run();
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
