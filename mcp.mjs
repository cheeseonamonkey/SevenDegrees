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
const artist=z.string().min(1).max(200);
const strict=z.boolean().default(false);
const mask=z.number().int().min(0).max(31).optional();
const flags=Object.fromEntries(['collaborations','memberships','production','covers','professional'].map(key=>[key,z.boolean().optional()]));
const register=(name,description,inputSchema,path)=>server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}},args=>call(path,args));
register('music_stats','Counts for the full indexed corpus.',{},'/api/stats');
register('music_search','Find artist names and stable IDs.',{q:artist},'/api/artists');
register('music_path','Find a source-backed connection path.',{from:artist,to:artist,strict,mask,...flags},'/api/path');
register('music_neighbors','Explore direct connections and their evidence, 40 at a time.',{artist,strict,mask,...flags,offset:z.number().int().nonnegative().default(0)},'/api/neighbors');
register('music_evidence','Read all original evidence for an artist or shared records for two artists, paginated.',{artist,other:artist.optional(),offset:z.number().int().nonnegative().default(0)},'/api/evidence');
register('music_profile','Get typed artist profiles and date-qualified band memberships or other musical relationships.',{artist,offset:z.number().int().nonnegative().default(0),year:z.number().int().optional(),mask,...flags},'/api/profile');
await server.connect(new StdioServerTransport());
