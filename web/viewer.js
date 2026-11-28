/* Both renderers consume the same map model. 3D is preferred; 2D is a fallback. */
const palette={Person:'#55c5b5',Group:'#e6b76e',Orchestra:'#e6b76e',Choir:'#e6b76e',Unknown:'#a8b2bf'};
const nodeColor=n=>n.community?'#8aace8':palette[n.type]||palette.Unknown;
const edgeColor=e=>e.kind==='membership'||e.kind==='member of band'?'#cba66d':e.kind?.includes('cover')||e.kind==='tribute'?'#a992d3':'#637588';
const safeLabel=value=>{const el=document.createElement('span');el.textContent=value;return el};
class MapViewer {
 constructor(el,{onNode,onLink,onFallback}){
  this.el=el;this.onNode=onNode;this.onLink=onLink;this.onFallback=onFallback;
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
     .backgroundColor('#10161f').showNavInfo(false).nodeId('id').nodeLabel(n=>safeLabel(n.name))
     .nodeColor(nodeColor).nodeVal(n=>n.community?Math.max(1,Math.log2(n.size+1)*.55):n.selected?3:1)
     .nodeResolution(8).linkColor(edgeColor).linkOpacity(.55).linkWidth(e=>e.weight?Math.min(3,Math.log10(e.weight+1)/2):.35)
     .linkLabel(e=>safeLabel(e.weight?e.weight.toLocaleString()+' links':e.title||e.kind))
     .onNodeClick(n=>this.onNode(n.id)).onLinkClick(e=>this.onLink(e.id)).enableNodeDrag(true)
     .cooldownTicks(100).onEngineStop(()=>{if(this.fitPending){this.fitPending=false;this.fit()}});
    this.measure();
   }catch(e){
    console.warn('3D renderer unavailable',e);this.destroy();this.current=null;this.mode('2D');this.onFallback?.();
   }
  }else{
   this.cy=cytoscape({container:this.el,elements:[],style:[
    {selector:'node',style:{'background-color':n=>nodeColor(n.data()),label:'data(name)',color:'#dce5ef','font-size':10,'text-valign':'bottom','text-margin-y':5,width:n=>n.data('community')?Math.min(30,Math.log2(n.data('size')+1)*1.4):12,height:n=>n.data('community')?Math.min(30,Math.log2(n.data('size')+1)*1.4):12}},
    {selector:'edge',style:{'line-color':e=>edgeColor(e.data()),width:1.2,opacity:.65,'curve-style':'straight'}}
   ]});
   this.cy.on('tap','node',e=>this.onNode(e.target.id()));
   this.cy.on('tap','edge',e=>this.onLink(e.target.id()));
  }
 }
 update(model,reset=false){
  if(this.three){
   const previous=reset?new Map():new Map(this.three.graphData().nodes.map(n=>[n.id,n]));
   const nodes=[...model.nodes.values()].map(n=>Object.assign(previous.get(n.id)||{},n));
   const links=[...model.links.values()].map(e=>({...e}));
   this.fitPending=reset;
   this.three.graphData({nodes,links});
   this.three.d3ReheatSimulation();
   if(nodes.length===1)this.fit();
  }else if(this.cy){
   const old=reset?new Map():new Map(this.cy.nodes().map(n=>[n.id(),n.position()]));
   const data=[...model.nodes.values()].map(n=>({data:{...n},position:old.get(n.id)})).concat([...model.links.values()].map(e=>({data:{...e}})));
   this.cy.json({elements:data});
   this.cy.layout({name:'cose',animate:false,randomize:reset,fit:reset,padding:35}).run();
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
 addConnection(from,s){this.addNode(s.to);this.addLink({id:'link:'+JSON.stringify([from,s.to.id].sort()),source:from,target:s.to.id,kind:s.kind,title:s.title,url:s.source})}
}
