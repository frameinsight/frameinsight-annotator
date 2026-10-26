import {identityVideoScopes,type Domain} from './types';

/** Delete one camera's local track without touching a shared legacy identity elsewhere. */
export function deleteCameraTrack(domain:Domain,videoId:string,identityId:string){
 if(!domain.identities[identityId])throw new Error('This track no longer exists.');
 const scopes=identityVideoScopes(domain).get(identityId)!;
 if(scopes.size&&!scopes.has(videoId))throw new Error('This track is not in this camera.');
 let observations=0;
 for(const collection of ['observations','segments','intervals'] as const){
  for(const row of Object.values(domain[collection])){
   if(row.video_id!==videoId||row.identity_uuid!==identityId)continue;
   if(collection==='observations')observations++;
   delete domain[collection][row.id];
  }
 }
 if(!identityVideoScopes(domain).get(identityId)?.size){
  for(const link of Object.values(domain.links))if(link.source===identityId||link.target===identityId)delete domain.links[link.id];
  delete domain.identities[identityId];
 }
 return observations;
}
