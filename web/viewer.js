/* Both renderers consume the same map model. 3D is preferred; 2D is a fallback. */
const palette={Person:'#55c5b5',Group:'#e6b76e',Orchestra:'#e6b76e',Choir:'#e6b76e',Unknown:'#a8b2bf'};
const nodeColor=n=>n.community?'#8aace8':palette[n.type]||palette.Unknown;
const edgeColor=e=>category(e.kind)?.color||'#637588';
const size=n=>n.community?Math.max(6,Math.log2(n.size+1)*1.1):Math.min(18,Math.max(5,Math.sqrt(n.degree||1)*1.8+(n.selected?3:0)));
function layoutData(model,settings){
 const nodes=[...model.nodes.values()].map(n=>({...n,degree:0,group:0}));
 const ids=new Map(nodes.map(n=>[n.id,n])),votes=new Map(nodes.map(n=>[n.id,new Map()]));
 const links=[...model.links.values()].map(e=>({...e}));
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
function labelSprite(n,labels){
 const t=new SpriteText(labels?n.name:'');t.color='#f5f8ff';t.textHeight=Math.min(8,Math.max(3,size(n)*.55));t.fontWeight='600';t.strokeWidth=.7;t.strokeColor='#181818';t.material.depthTest=false;t.renderOrder=10;return t
}
const safeLabel=value=>{const el=document.createElement('span');el.textContent=value;return el};
class MapViewer {
 constructor(el,{onNode,onLink,onFallback}){
  this.settings={cluster:true,spacing:65,labels:true};this.el=el;this.onNode=onNode;this.onLink=onLink;this.onFallback=onFallback;
  this.resize=new ResizeObserver(()=>this.measure());this.resize.observe(el);
 }
 measure(){
  if(this.three&&this.el.clientWidth&&this.el.clientHeight)this.three.width(this.el.clientWidth).height(this.el.clientHeight);
  this.cy?.resize();
 }
 destroy(){
  this.three?._destructor();this.cy?.destroy();this.three=this.cy=null;
  this.el.replaceChildren();
 }
 mode(mode){
  if(mode===this.current)return;
  this.destroy();this.current=mode;
  if(mode==='3D'){
   try{
    this.three=new ForceGraph3D(this.el,{controlType:'orbit',rendererConfig:{antialias:true}})
     .backgroundColor('#181818').showNavInfo(false).nodeId('id').nodeLabel(n=>safeLabel(n.name))
     .nodeColor(nodeColor).nodeVal(n=>Math.pow(size(n)/4,3)).nodeThreeObjectExtend(true).nodeThreeObject(n=>labelSprite(n,this.settings.labels))
     .nodeResolution(12).linkColor(edgeColor).linkOpacity(.8).linkWidth(e=>e.weight?Math.min(3,Math.log10(e.weight+1)/2):.35)
     .linkLabel(e=>safeLabel(e.weight?e.weight.toLocaleString()+' links':e.title||e.kind))
     .onNodeClick(n=>this.onNode(n.id)).onLinkClick(e=>this.onLink(e.id)).enableNodeDrag(true)
     .cooldownTicks(100).onEngineStop(()=>{if(this.fitPending){this.fitPending=false;this.fit()}});
    this.measure();
   }catch(e){
    console.warn('3D renderer unavailable',e);this.destroy();this.current=null;this.mode('2D');this.onFallback?.();
   }
  }else{
   this.cy=cytoscape({container:this.el,elements:[],style:[
    {selector:'node',style:{'background-color':n=>nodeColor(n.data()),label:n=>this.settings.labels?n.data('name'):'',color:'#f5f8ff','font-size':n=>Math.max(9,Math.min(16,size(n.data())*.9)),'font-weight':600,'text-valign':'center','text-halign':'center','text-outline-width':2,'text-outline-color':'#181818','text-wrap':'wrap','text-max-width':120,width:n=>size(n.data())*2.4,height:n=>size(n.data())*2.4}},
    {selector:'edge',style:{'line-color':e=>edgeColor(e.data()),width:1.6,opacity:.8,'curve-style':'bezier'}},
    {selector:'edge[kind = "cover"],edge[kind = "cover-reference"],edge[kind = "tribute"]',style:{'line-style':'dashed'}}
   ]});
   this.cy.on('tap','node',e=>this.onNode(e.target.id()));
   this.cy.on('tap','edge',e=>this.onLink(e.target.id()));
  }
 }
 update(model,reset=false){
  const {nodes,links}=layoutData(model,this.settings),{cluster,spacing,labels}=this.settings;
  if(this.three){
   const previous=reset?new Map():new Map(this.three.graphData().nodes.map(n=>[n.id,n]));
   const data=nodes.map(n=>Object.assign(previous.get(n.id)||{...n.initial},n));
   this.fitPending=reset;
   this.three.graphData({nodes:data,links});
   this.three.nodeThreeObject(n=>labelSprite(n,labels));
   this.three.d3Force('link').distance(spacing);
   this.three.d3Force('charge').strength(-spacing*2.5);
   this.three.d3Force('collision',forceCollide(n=>size(n)+4));
   for(const [axis,force] of [['x',forceX],['y',forceY],['z',forceZ]])this.three.d3Force('cluster-'+axis,cluster?force(n=>n.anchor[axis]).strength(.12):null);
   this.three.d3ReheatSimulation();
   if(nodes.length===1)this.fit();
  }else if(this.cy){
   const old=reset?new Map():new Map(this.cy.nodes().map(n=>[n.id(),n.position()]));
   const data=nodes.map(n=>({data:n,position:cluster?n.initial:old.get(n.id)||n.initial})).concat(links.map(e=>({data:e})));
   this.cy.json({elements:data});
   this.cy.style().update();
   this.cy.layout(cluster?{name:'preset',fit:reset,padding:35}:{name:'cose',animate:false,randomize:reset,fit:reset,padding:35,idealEdgeLength:spacing,nodeRepulsion:spacing*100}).run();
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
