const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
module.exports=directory=>{
const root=path.resolve(directory);
let transferred=0,rangeRequests=0,fullPacks=0;
const server=http.createServer((req,res)=>{
 let file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return}
 const size=fs.statSync(file).size,range=req.headers.range;
 const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[ext]||'application/octet-stream');
 let start=0,end=size-1;
 if(range){
  const m=/^bytes=(\d+)-(\d+)$/.exec(range);
  if(!m||Number(m[2])>=size||Number(m[1])>Number(m[2])){res.writeHead(416).end();return}
  start=Number(m[1]);end=Number(m[2]);rangeRequests++;
  res.writeHead(206,{'Content-Range':'bytes '+start+'-'+end+'/'+size,'Content-Length':end-start+1});
 }else{
  if(file.endsWith('.bin'))fullPacks++;
  res.writeHead(200,{'Content-Length':size});
 }
 transferred+=end-start+1;
 fs.createReadStream(file,{start,end}).pipe(res);
});
return {server,metrics:()=>({transferred,rangeRequests,fullPacks})};
};
