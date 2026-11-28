/* Shared display and query policy. No source relationship is inferred from its label. */
const relationshipTypes={
  "collaborations": {
    "bit": 1,
    "label": "Collaborations",
    "kinds": [
      "recording",
      "performance",
      "featured",
      "collaboration"
    ],
    "color": "#63b9ef"
  },
  "memberships": {
    "bit": 2,
    "label": "Memberships",
    "kinds": [
      "membership",
      "member of band",
      "founder",
      "subgroup"
    ],
    "color": "#e7b966"
  },
  "production": {
    "bit": 4,
    "label": "Production",
    "kinds": [
      "production"
    ],
    "color": "#61d1a4"
  },
  "covers": {
    "bit": 8,
    "label": "Covers & tributes",
    "kinds": [
      "cover",
      "cover-reference",
      "tribute"
    ],
    "color": "#c4a0f5"
  },
  "professional": {
    "bit": 16,
    "label": "Other musical roles",
    "kinds": [
      "is person",
      "artist rename",
      "teacher",
      "conductor position",
      "artistic director",
      "supporting musician",
      "instrumental supporting musician",
      "vocal supporting musician",
      "artist-in-residence",
      "composer-in-residence"
    ],
    "color": "#ed9690"
  }
};
const category=kind=>Object.values(relationshipTypes).find(c=>c.kinds.includes(kind));
function relationshipMask(params={}){
 let mask=params.mask??(params.strict?23:31);
 for(const [key,{bit}] of Object.entries(relationshipTypes)){
  if(params[key]===undefined)continue;
  if(typeof params[key]!=='boolean')throw Error(key+' must be a boolean');
  mask=params[key]?mask|bit:mask&~bit;
 }
 return mask;
}
const listeningTerms=(a,b,e)=>['recording','featured','production','performance','cover','cover-reference','tribute'].includes(e.kind)?[e.title,e.performer===a.id?a.name:b.name]:[b.name];
const spotifySearch=(...terms)=>'https://open.spotify.com/search/'+encodeURIComponent(terms.filter(Boolean).join(' '));
function connectionText(a,b,e){
 const song=e.title?'“'+e.title+'”':'a recording';
 switch(e.kind){
 case 'cover':return e.performer===a.id&&e.original===b.id?a.name+' covered '+b.name+'’s '+song:e.performer===b.id&&e.original===a.id?b.name+' covered '+a.name+'’s '+song:a.name+' and '+b.name+' are connected by a cover of '+song;
 case 'cover-reference':return e.performer===a.id?a.name+' recorded a cover of '+song+', also recorded by '+b.name:e.performer===b.id?b.name+' recorded a cover of '+song+', also recorded by '+a.name:a.name+' and '+b.name+' recorded versions of '+song+' (cover relationship)';
 case 'tribute':return a.name+' and '+b.name+' are linked by the tribute '+song;
 case 'membership':case 'member of band':return a.type==='Person'&&b.type==='Group'?a.name+' was or is a member of '+b.name:b.type==='Person'&&a.type==='Group'?b.name+' was or is a member of '+a.name:a.name+' and '+b.name+' share a band-membership relationship';
 case 'production':return e.producer===a.id?a.name+' produced or contributed to '+b.name+'’s '+song:e.producer===b.id?b.name+' produced or contributed to '+a.name+'’s '+song:a.name+' and '+b.name+' share a production credit on '+song;
 case 'featured':return a.name+' and '+b.name+' appear on '+song+' as credited artists (including a featured artist)';
 case 'recording':return a.name+' and '+b.name+' are credited together on '+song;
 case 'performance':return a.name+' and '+b.name+' share a performance credit on '+song;
 case 'collaboration':return a.name+' collaborated with '+b.name;
 default:return a.name+' and '+b.name+' are linked by '+e.kind;
 }
}
if(typeof module!=='undefined')module.exports={relationshipTypes,relationshipMask,category,spotifySearch,connectionText,listeningTerms};
