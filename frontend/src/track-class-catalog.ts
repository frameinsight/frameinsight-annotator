import {boxKeys,boxStyle,type BoxStyle,type Geometry,type Project} from './types';

export type TrackClassCatalog=Record<string,(BoxStyle&{geometry:Geometry})[]>;

// Build the sidebar's class list in one pass over the recording. Calling
// orderedGeometryKeys separately for every track repeatedly walks the same
// (potentially tens of thousands of) observations after each box adjustment.
export function trackClassCatalog(project:Project|null,videoId?:string):TrackClassCatalog {
 if(!project)return {};
 const {identities,observations,intervals}=project.state;
 const keys=new Map(Object.values(identities).map(identity=>[identity.id,new Set<Geometry>(Object.keys(identity.box_styles||{}))]));
 for(const observation of Object.values(observations)){
  if(videoId&&observation.video_id!==videoId)continue;
  const track=keys.get(observation.identity_uuid);if(!track)continue;
  for(const key of boxKeys(observation))track.add(key);
  for(const key of Object.keys(observation.provenance))track.add(key);
 }
 for(const interval of Object.values(intervals))if(interval.geometry&&(!videoId||interval.video_id===videoId))keys.get(interval.identity_uuid)?.add(interval.geometry);
 const rank=new Map<string,number>();
 for(const [index,name] of (project.classes||[]).entries())if(!rank.has(name))rank.set(name,index);
 const result:TrackClassCatalog={};
 for(const [id,geometries] of keys){
  const identity=identities[id];
  if(!geometries.size&&identity.class_name)geometries.add('person_visible');
  result[id]=[...geometries].map(geometry=>({geometry,...boxStyle(identity,geometry)})).sort((a,b)=>(rank.get(a.class_name)??Number.MAX_SAFE_INTEGER)-(rank.get(b.class_name)??Number.MAX_SAFE_INTEGER)||a.class_name.localeCompare(b.class_name));
 }
 return result;
}
