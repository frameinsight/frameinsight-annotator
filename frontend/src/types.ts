// Simplified manual workflow: no approval or detector controls; both box types are supported.
export const VISIBLE_ONLY=true;
export type Box=[number,number,number,number];
export type Geometry='person_ext'|'person_visible';
export type BoxStyle={class_name:string;color:string};
export type Identity={id:string;person_id:number|null;name:string;class_name?:string;color?:string;box_styles?:Partial<Record<Geometry,BoxStyle>>};
export type Segment={id:string;video_id:string;identity_uuid:string;start:number;end:number|null;status:'verified'|'unresolved'};
export type Observation={id:string;video_id:string;frame_index:number;identity_uuid:string;segment_id:string;person_ext:Box|null;person_visible:Box|null;full_quality:'unset'|'observed'|'estimated'|'unknown';occluded:boolean|null;truncated:boolean|null;geometry_link:'independent'|'equal';review_state:'draft'|'needs_review'|'approved';evidence_note:string;provenance:Partial<Record<Geometry,{origin:'manual'|'model'|'copied'|'copied_track'|'interpolated';proposal_id:string|null;human_corrected:boolean}>>};
export type Interval={geometry?:Geometry|null;id:string;video_id:string;identity_uuid:string;start:number;end:number|null;reason:'occlusion'|'outside'|'unavailable'|'unknown';evidence_note:string};
export type Link={id:string;source:string;target:string;relation:'same'|'different'|'unresolved';evidence_note:string};
export type Review={id:string;video_id:string;frame_index:number;complete:boolean;checked_all_people:boolean;note:string};
export type ProposalReview={id:string;video_id:string;frame_index:number;proposal_id:string;decision:'rejected';reason:string};
export type Domain={proposal_reviews:Record<string,ProposalReview>;identities:Record<string,Identity>;segments:Record<string,Segment>;observations:Record<string,Observation>;intervals:Record<string,Interval>;links:Record<string,Link>;reviews:Record<string,Review>};
export type Collection=keyof Domain;
export type Video={id:string;name:string;width:number;height:number;frame_count:number;nominal_fps:number;status:string;error?:string;source_hash:string;stream_index:number;session:string;finished_revision?:number;finished_at?:string};
export type Project={class_colors?:Record<string,string>;classes?:string[];id:string;name:string;revision:number;state:Domain;videos:Record<string,Video>};
export type Change={collection:Collection;id:string;before:any;after:any};
export type Operation={id:string;base_revision:number;label:string;video_id:string|null;frame_index:number|null;changes:Change[];compensates?:string|null};
export type Proposal={id:string;video_id:string;frame_index:number;geometry:Geometry;box:Box;confidence:number;class_name:string;cache_key:string};
export type Job={id:string;kind:string;status:string;video_id?:string;progress:number;total?:number;error?:string;phase?:string;export_id?:string;settings?:any;cache_key?:string};
export type FrameInfo={frame_index:number;pts:number|null;seconds:number|null;time_base_num:number;time_base_den:number};
export const uuid=()=>crypto.randomUUID();
export const geometries:Geometry[]=['person_ext','person_visible'];
export function observationIssues(o:Observation):string[]{
 const a=o.person_ext,b=o.person_visible,r:string[]=[];
 if(VISIBLE_ONLY){if(!a&&!b)r.push('Draw a box');return r;}
 if(!b)r.push('Draw B · visible extent');
 if(VISIBLE_ONLY)return r;
 if(o.full_quality==='unknown'){if(a)r.push('Unknown full extent must have no A');if(!o.evidence_note.trim())r.push('Explain why A is unknown');}
 else if(!a)r.push('Draw A or mark full extent unknown');
 if(o.full_quality==='unset')r.push('Review full extent quality');
 if(o.occluded===null)r.push('Review external occlusion');
 if(o.truncated===null)r.push('Review border truncation');
 if(a&&b&&(b[0]<a[0]-.01||b[1]<a[1]-.01||b[2]>a[2]+.01||b[3]>a[3]+.01))r.push('B extends outside A');
 return r;
}
export function emptyObservation(video_id:string,frame_index:number,identity_uuid:string,segment_id:string):Observation{return {id:uuid(),video_id,frame_index,identity_uuid,segment_id,person_ext:null,person_visible:null,full_quality:VISIBLE_ONLY?'unknown':'unset',occluded:null,truncated:null,geometry_link:'independent',review_state:'draft',evidence_note:VISIBLE_ONLY?'Visible-only annotation; full extent is not annotated.':'',provenance:{}};}
// Store commits replace the observation dictionary. Weak keys release old undo/load
// snapshots and avoid rescanning the whole recording on every frame or pointer move.
const frameIndexes=new WeakMap<Domain['observations'],Map<string,Observation[]>>();
const noObservations:Observation[]=[];
export function frameObservations(p:Project|null,vid:string,frame:number):Observation[]{
 if(!p)return noObservations;
 const rows=p.state.observations;
 let index=frameIndexes.get(rows);
 if(!index){index=new Map();for(const o of Object.values(rows)){const key=o.video_id+':'+o.frame_index;const list=index.get(key);if(list)list.push(o);else index.set(key,[o]);}frameIndexes.set(rows,index);}
 return index.get(vid+':'+frame)||noObservations;
}
export function currentObservation(p:Project|null,vid:string,frame:number,identity:string){return frameObservations(p,vid,frame).find(o=>o.identity_uuid===identity);}
export function validateDomain(d:Domain,videos:Record<string,Video>){
 const numbers=new Set<number>(),seen=new Set<string>();
 for(const p of Object.values(d.identities)){if(p.class_name!==undefined&&(!p.class_name.trim()||p.class_name.length>80))throw new Error('Class name must contain 1–80 characters');if(p.color!==undefined&&!/^#[0-9a-f]{6}$/i.test(p.color))throw new Error('Invalid box color');if(p.person_id!==null){if(!Number.isSafeInteger(p.person_id)||p.person_id<=0||numbers.has(p.person_id))throw new Error('Numeric person IDs must be positive and unique');numbers.add(p.person_id)}}
 for(const col of ['segments','intervals','observations','reviews','proposal_reviews'] as const)for(const row of Object.values(d[col])){const e=row as any,v=videos[e.video_id];if(!v)throw new Error('Unknown video');if(e.identity_uuid&&!d.identities[e.identity_uuid])throw new Error('Identity is missing');const start=e.start??e.frame_index;if(start<0||start>=v.frame_count||(e.end!==undefined&&e.end!==null&&(e.end<start||e.end>=v.frame_count)))throw new Error('Frame or segment lies outside the decoded source ledger');}
 for(const o of Object.values(d.observations)){
  const key=o.video_id+':'+o.frame_index+':'+o.identity_uuid;if(seen.has(key))throw new Error('This identity already has an observation in that frame');seen.add(key);
  const seg=d.segments[o.segment_id];if(!seg||seg.identity_uuid!==o.identity_uuid||seg.video_id!==o.video_id||o.frame_index<seg.start||(seg.end!==null&&o.frame_index>seg.end))throw new Error('Observation is outside its visible segment');
  if(Object.values(d.intervals).some(g=>g.video_id===o.video_id&&g.identity_uuid===o.identity_uuid&&g.start<=o.frame_index&&(g.end===null||o.frame_index<=g.end)&&(!g.geometry?(o.person_visible||o.person_ext):o[g.geometry])))throw new Error('A gap overlaps existing observations; resolve its boundaries before this change');
  for(const g of geometries){const b=o[g],v=videos[o.video_id];if(b&&(!b.every(Number.isFinite)||!(0<=b[0]&&b[0]<b[2]&&b[2]<=v.width&&0<=b[1]&&b[1]<b[3]&&b[3]<=v.height)))throw new Error('Boxes must have positive area inside source-image boundaries');}
  if(o.review_state==='approved'&&(observationIssues(o).length||seg.status!=='verified'))throw new Error('Resolve observation and identity issues before approving');
 }
 for(const l of Object.values(d.links))if(!d.identities[l.source]||!d.identities[l.target]||l.source===l.target||!l.evidence_note.trim())throw new Error('Identity links need two distinct identities and evidence');
 for(const r of Object.values(d.reviews))if(r.complete&&(!r.checked_all_people||Object.values(d.observations).some(o=>o.video_id===r.video_id&&o.frame_index===r.frame_index&&((!VISIBLE_ONLY&&o.review_state!=='approved')||observationIssues(o).length||d.segments[o.segment_id]?.status!=='verified'))))throw new Error('Completeness requires an explicit check, valid boxes and verified identities');
}

export const geometryLabel=(g:Geometry)=>g==='person_ext'?'Extended':'Visible';
export const legacyExtended=(p:Identity)=>(!p.box_styles||!Object.keys(p.box_styles).length)&&['person_extended','person_ext','person_exteded'].includes((p.class_name||'').toLowerCase());
export function boxStyle(p:Identity|undefined,g:Geometry):BoxStyle {
 return p?.box_styles?.[g]||{class_name:g==='person_ext'?(p&&legacyExtended(p)?p.class_name!:'person_extended'):(p?.class_name||'person_visible'),color:g==='person_ext'?(p&&legacyExtended(p)?p.color||'#67e2b1':'#67e2b1'):(p?.color||'#baa7ff')};
}

export function classColor(p:Project|null,name:string){return p?.class_colors?.[name]||Object.values(p?.state.identities||{}).flatMap(i=>Object.values(i.box_styles||{})).find(s=>s.class_name===name)?.color||'#baa7ff';}
