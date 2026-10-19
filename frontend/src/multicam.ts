import type {FrameInfo,Observation} from './types';
import {boxKeys} from './types';

export type SessionCamera={id:string;name:string;video_id:string;offset_seconds:number};
export type SessionPerson={id:string;person_id:number;name:string;color:string};
export type CameraAssignment={video_id:string;identity_uuid:string;person_uuid:string};
export type CameraSession={id:string;project_id:string;mode:'multicamera';name:string;revision:number;created_at:string;updated_at:string;cameras:SessionCamera[];people:SessionPerson[];assignments:CameraAssignment[]};
export type SessionContent=Pick<CameraSession,'name'|'cameras'|'people'|'assignments'>;
export type CameraTiming={seconds:number[];end:number;frameDuration:number};

/** Source presentation timestamps, normalized once per recording; never map by another camera's frame number. */
export function cameraTiming(ledger:FrameInfo[],fps:number):CameraTiming{
 if(!ledger.length)throw new Error('This camera has no decoded frames.');
 const raw=ledger.map((f,i)=>{if(f.frame_index!==i||f.seconds===null||!Number.isFinite(f.seconds))throw new Error('Camera timestamps are incomplete. Reprocess this video before synchronizing.');return f.seconds;});
 const seconds=raw.map(t=>t-raw[0]);
 for(let i=1;i<seconds.length;i++)if(seconds[i]<seconds[i-1])throw new Error('Camera timestamps are not in playback order.');
 const deltas=seconds.slice(1).map((t,i)=>t-seconds[i]).filter(t=>t>0).sort((a,b)=>a-b);
 const frameDuration=deltas.length?deltas[Math.floor(deltas.length/2)]:(Number.isFinite(fps)&&fps>0?1/fps:1/25);
 return {seconds,end:seconds[seconds.length-1]+frameDuration,frameDuration};
}

export function sessionBounds(cameras:SessionCamera[],timings:Record<string,CameraTiming>){
 const available=cameras.filter(c=>timings[c.video_id]);
 if(!available.length)return {start:0,end:0};
 return {start:Math.min(...available.map(c=>c.offset_seconds)),end:Math.max(...available.map(c=>c.offset_seconds+timings[c.video_id].end))};
}

/** Return the frame covering this session instant, or null outside the recording. */
export function frameAtSessionTime(timing:CameraTiming|undefined,time:number,offset:number):number|null{
 if(!timing||!Number.isFinite(time))return null;
 const local=time-offset;
 if(local< -1e-8||local>=timing.end-1e-8)return null;
 let low=0,high=timing.seconds.length;
 while(low<high){const mid=(low+high)>>>1;if(timing.seconds[mid]<=local+1e-8)low=mid+1;else high=mid;}
 return Math.max(0,low-1);
}
export function sessionTimeForFrame(timing:CameraTiming,frame:number,offset:number){return timing.seconds[Math.max(0,Math.min(timing.seconds.length-1,Math.trunc(frame)))]+offset;}
export function alignOffset(timing:CameraTiming,frame:number,sessionTime:number){return sessionTime-timing.seconds[Math.max(0,Math.min(timing.seconds.length-1,Math.trunc(frame)))];}
export function stepSessionFrame(timing:CameraTiming|undefined,time:number,offset:number,direction:-1|1){
 if(!timing)return time;
 const current=frameAtSessionTime(timing,time,offset);
 const next=current===null?(time<offset?0:timing.seconds.length-1):Math.max(0,Math.min(timing.seconds.length-1,current+direction));
 return sessionTimeForFrame(timing,next,offset);
}
export function sessionContent(session:CameraSession):SessionContent{return structuredClone({name:session.name,cameras:session.cameras,people:session.people,assignments:session.assignments});}
export function assignSharedPerson(assignments:CameraAssignment[],videoId:string,identityUuid:string,personUuid:string|null){
 const rest=assignments.filter(a=>!(a.video_id===videoId&&a.identity_uuid===identityUuid));
 return personUuid?[...rest,{video_id:videoId,identity_uuid:identityUuid,person_uuid:personUuid}]:rest;
}
export function personForTrack(session:CameraSession,videoId:string,identityUuid:string){
 const assignment=session.assignments.find(a=>a.video_id===videoId&&a.identity_uuid===identityUuid);
 return assignment?session.people.find(p=>p.id===assignment.person_uuid):undefined;
}
export function nextSharedPersonId(people:SessionPerson[]){const used=new Set(people.map(p=>p.person_id));let next=1;while(used.has(next))next++;return next;}
export type AppearanceRun={start:number;end:number};
export function appearanceRuns(observations:Iterable<Observation>,videoId:string,identityIds:Set<string>):AppearanceRun[]{
 const frames=[...new Set([...observations].filter(o=>o.video_id===videoId&&identityIds.has(o.identity_uuid)&&boxKeys(o).length>0).map(o=>o.frame_index))].sort((a,b)=>a-b);
 const runs:AppearanceRun[]=[];
 for(const frame of frames){const last=runs[runs.length-1];if(last&&frame===last.end+1)last.end=frame;else runs.push({start:frame,end:frame});}
 return runs;
}
export function formatSessionTime(seconds:number){const sign=seconds<0?'−':'';const ms=Math.round(Math.abs(seconds)*1000);return `${sign}${Math.floor(ms/60000).toString().padStart(2,'0')}:${Math.floor(ms/1000)%60<10?'0':''}${Math.floor(ms/1000)%60}.${(ms%1000).toString().padStart(3,'0')}`;}

/** History may only compensate the state it produced, never another editor's work. */
export function sameSessionContent(a:SessionContent,b:SessionContent):boolean{
 const stable=(value:any):any=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
 return JSON.stringify(stable(a))===JSON.stringify(stable(b));
}
