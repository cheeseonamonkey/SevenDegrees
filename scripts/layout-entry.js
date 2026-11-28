// Large 2D maps use the same force library as the 3D viewer, off the UI thread.
import {forceSimulation,forceLink,forceManyBody,forceCollide,forceX,forceY} from 'd3-force-3d';
self.onmessage=({data:{nodes,links,spacing,repulsion,cluster}})=>{
 const n=nodes.length;
 const simulation=forceSimulation(nodes,2).stop()
  .force('link',forceLink(links).id(a=>a.id).distance(spacing))
  .force('charge',forceManyBody().strength(-spacing*2.5*repulsion).theta(.95))
  .force('collide',forceCollide(a=>a.radius+4))
  .force('x',forceX(a=>cluster?a.anchor.x:a.x0).strength(a=>cluster?.12:a.old?.08:.015))
  .force('y',forceY(a=>cluster?a.anchor.y:a.y0).strength(a=>cluster?.12:a.old?.08:.015));
 simulation.tick(n>3000?35:n>1000?60:100);
 self.postMessage(Object.fromEntries(nodes.map(a=>[a.id,{x:a.x,y:a.y}])));
};
