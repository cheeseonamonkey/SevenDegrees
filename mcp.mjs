import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import client from './web/graph-client.js';

const manifest=new URL(process.env.MUSICATLAS_MANIFEST||process.env.SEVENDEGREES_MANIFEST||'https://cheeseonamonkey.github.io/MusicAtlas/api/v1/manifest.json');
let api;
const call=async(path,params)=>{
 try{
  api ||= client.graphClient(manifest).catch(e=>{api=undefined;throw e});
  const result=await (await api)(path,params);
  return {content:[{type:'text',text:JSON.stringify(result)}]};
 }catch(e){return {isError:true,content:[{type:'text',text:e.message}]}}
};
const server=new McpServer({name:'MusicAtlas',version:'0.1.0'});
const scope=z.enum(['priority','full']).default('priority');
const artist=z.string().min(1).max(200);
const strict=z.boolean().default(false);
const register=(name,description,inputSchema,path)=>server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}},args=>call(path,args));
register('music_stats','Counts for the selected graph snapshot.',{scope},'/api/stats');
register('music_search','Find artist names and stable IDs.',{q:artist,scope},'/api/artists');
register('music_path','Find a source-backed connection path.',{from:artist,to:artist,strict,scope},'/api/path');
register('music_neighbors','Explore direct connections and their evidence, 40 at a time.',{artist,strict,scope,offset:z.number().int().nonnegative().default(0)},'/api/neighbors');
await server.connect(new StdioServerTransport());
