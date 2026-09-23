import {type Domain,type Geometry,type Observation,geometries,legacyExtended,boxStyle,uuid,getBox,setBox,boxKeys,identityGeometryKeys,geometryForClass,classKey} from './types';

export function assignPerson(d:Domain,source:string,target:string,videoId:string,frame:number,personId:number|null,className:string,color:string,geometry:Geometry='person_visible',sourceGeometry:Geometry=geometry){
 const candidate=structuredClone(d);
 assign(candidate,source,target,videoId,frame,personId,className,color,geometry,sourceGeometry);
 Object.assign(d,candidate);
}
export function convertLegacyExtended(d:Domain,id:string){
 const p=d.identities[id];if(!p||!legacyExtended(p))return;
 const rows=Object.values(d.observations).filter(o=>o.identity_uuid===id);
 if(rows.some(o=>o.person_ext))throw new Error('This legacy track already contains extended boxes; review it before conversion.');
 const style=boxStyle(p,'person_ext');
 for(const o of rows){o.person_ext=o.person_visible;o.person_visible=null;o.provenance.person_ext=o.provenance.person_visible;delete o.provenance.person_visible;o.full_quality=o.person_ext?'estimated':'unknown';o.geometry_link='independent';o.review_state='draft';o.evidence_note+='\nConverted legacy person_extended class into extended box geometry.';}
 for(const gap of Object.values(d.intervals))if(gap.identity_uuid===id)gap.geometry='person_ext';
 p.box_styles={person_ext:style};p.class_name='person_visible';p.color='#baa7ff';
}
function scopeLegacyGaps(d:Domain,id:string){
 const present=identityGeometryKeys(d,id);
 for(const gap of Object.values(d.intervals))if(gap.identity_uuid===id&&!gap.geometry){
  gap.geometry=present[0]||'person_visible';
  for(const geometry of present.slice(1)){const key=uuid();d.intervals[key]={...gap,id:key,geometry};}
 }
}
function remapObservation(o:Observation,mapping:Map<Geometry,Geometry>){
 const values=[...mapping].map(([from,to])=>({from,to,box:getBox(o,from),provenance:o.provenance[from]}));
 for(const v of values)if(v.from!==v.to){setBox(o,v.from,null);delete o.provenance[v.from];}
 for(const v of values){if(v.box)setBox(o,v.to,v.box);if(v.provenance)o.provenance[v.to]=v.provenance;}
 o.geometry_link='independent';o.review_state='draft';
}
function assign(d:Domain,source:string,target:string,videoId:string,frame:number,personId:number|null,className:string,color:string,geometry:Geometry,sourceGeometry:Geometry){
 if(!d.identities[source]||!d.identities[target])throw new Error('Choose an existing track');
 if(personId!==null&&(!Number.isSafeInteger(personId)||personId<=0))throw new Error('Person ID must be a positive integer');
 if(!className.trim()||className.trim().length>80)throw new Error('Class name must contain 1–80 characters');
 if(!/^#[0-9a-f]{6}$/i.test(color))throw new Error('Choose a valid box color');
 const namedGeometry=identityGeometryKeys(d,target).find(key=>boxStyle(d.identities[target],key).class_name===className.trim());
 if(namedGeometry)geometry=namedGeometry;
 else if(geometry.startsWith('class:')&&geometry!==classKey(className))geometry=geometryForClass(d.identities[target],className);
 if(legacyExtended(d.identities[target])&&geometry==='person_visible'&&className.trim()===d.identities[target].class_name)geometry='person_ext';
 if(legacyExtended(d.identities[source])&&sourceGeometry==='person_visible')sourceGeometry='person_ext';
 convertLegacyExtended(d,source);if(source!==target)convertLegacyExtended(d,target);
 const mine=Object.values(d.observations).filter(o=>o.identity_uuid===source),other=Object.values(d.observations).filter(o=>o.identity_uuid===target);
 const sourceKeys=[...new Set([...identityGeometryKeys(d,source),sourceGeometry])];
 if(source===target){
  if(sourceGeometry!==geometry){
   if(mine.some(o=>getBox(o,sourceGeometry)&&getBox(o,geometry)))throw new Error('This track already has that class on the same frame. No boxes were replaced.');
   scopeLegacyGaps(d,source);
   for(const o of mine)if(getBox(o,sourceGeometry)||o.provenance[sourceGeometry])remapObservation(o,new Map([[sourceGeometry,geometry]]));
   for(const gap of Object.values(d.intervals))if(gap.identity_uuid===source&&gap.geometry===sourceGeometry)gap.geometry=geometry;
   if(d.identities[source].box_styles)delete d.identities[source].box_styles![sourceGeometry];
  }
 }else{
  if(Object.values(d.links).some(l=>l.relation==='different'&&((l.source===source&&l.target===target)||(l.source===target&&l.target===source))))throw new Error('These identities were marked different. Resolve that decision in Identity tools first.');
  const mapping=new Map(sourceKeys.map(g=>[g,g===sourceGeometry?geometry:geometryForClass(d.identities[target],boxStyle(d.identities[source],g).class_name)]));
  const label=(g:Geometry)=>g===sourceGeometry?className.trim():boxStyle(d.identities[source],g).class_name;
  for(const a of mine){
   const seen=new Set<string>(),match=other.find(b=>b.video_id===a.video_id&&b.frame_index===a.frame_index);
   for(const g of boxKeys(a)){
    const name=label(g);
    if(seen.has(name)||match&&boxKeys(match).some(key=>boxStyle(d.identities[target],key).class_name===name))throw new Error('This ID already has the same box type or class on the same frame. No boxes were replaced.');
    seen.add(name);
   }
  }
  scopeLegacyGaps(d,source);scopeLegacyGaps(d,target);
  const styles={...d.identities[target].box_styles};
  for(const [from,to] of mapping)if(!styles[to]&&mine.some(o=>getBox(o,from)))styles[to]=boxStyle(d.identities[source],from);
  d.identities[target].box_styles=styles;
  for(const o of mine){
   const match=other.find(b=>b.video_id===o.video_id&&b.frame_index===o.frame_index);
   remapObservation(o,mapping);
   if(match){for(const g of boxKeys(o)){setBox(match,g,getBox(o,g));match.provenance[g]=o.provenance[g];if(g==='person_ext')match.full_quality=o.full_quality;}match.review_state='draft';match.geometry_link='independent';match.evidence_note+=[o.evidence_note,'Linked complementary classes under one track ID.'].filter(Boolean).map(n=>'\n'+n).join('');delete d.observations[o.id];}
   else{o.identity_uuid=target;o.review_state='draft';}
  }
  for(const seg of Object.values(d.segments))if(seg.identity_uuid===source)seg.identity_uuid=target;
  for(const gap of Object.values(d.intervals))if(gap.identity_uuid===source){gap.identity_uuid=target;if(gap.geometry)gap.geometry=mapping.get(gap.geometry)||gap.geometry;}
  for(const link of Object.values(d.links)){if(link.source===source)link.source=target;if(link.target===source)link.target=target;if(link.source===link.target)delete d.links[link.id];}
  delete d.identities[source];
  const segments=Object.values(d.segments).filter(s=>s.identity_uuid===target&&s.status==='verified').sort((a,b)=>a.video_id.localeCompare(b.video_id)||a.start-b.start);
  let previous=segments[0];
  for(const seg of segments.slice(1)){
   if(previous.video_id===seg.video_id&&seg.start<=(previous.end??Infinity)){
    const end=previous.end===null||seg.end===null?null:Math.max(previous.end,seg.end);
    const hasGap=Object.values(d.intervals).some(g=>!g.geometry&&g.identity_uuid===target&&g.video_id===seg.video_id&&g.start<=(end??Infinity)&&(g.end??Infinity)>=previous.start);
    if(!hasGap){previous.end=end;for(const o of Object.values(d.observations))if(o.segment_id===seg.id)o.segment_id=previous.id;delete d.segments[seg.id];continue;}
   }
   previous=seg;
  }
 }
 const identity=d.identities[target];identity.person_id=personId;identity.box_styles={...identity.box_styles,[geometry]:{class_name:className.trim(),color:color.toLowerCase()}};if(geometry==='person_visible'){identity.class_name=className.trim();identity.color=color.toLowerCase();}
 const segments=Object.values(d.segments).filter(s=>s.identity_uuid===target&&s.video_id===videoId).sort((a,b)=>a.start-b.start);
 const first=segments[0];
 if(first&&first.status==='verified'&&frame<first.start&&!Object.values(d.intervals).some(g=>g.identity_uuid===target&&g.video_id===videoId&&g.start<=first.start&&(g.end===null||g.end>=frame)))first.start=frame;
}
