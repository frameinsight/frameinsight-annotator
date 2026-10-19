import {describe,it,expect} from 'vitest';
import {cameraTiming,sessionBounds,frameAtSessionTime,sessionTimeForFrame,stepSessionFrame,alignOffset,assignSharedPerson,nextSharedPersonId,appearanceRuns,formatSessionTime,sameSessionContent} from './multicam';
import {emptyObservation,type FrameInfo,type Observation} from './types';
const ledger=(times:number[])=>times.map((seconds,frame_index)=>({frame_index,seconds,pts:seconds*1000,time_base_num:1,time_base_den:1000} as FrameInfo));
const camera=(id:string,offset_seconds=0)=>({id,video_id:id,name:id,offset_seconds});
describe('multi-camera source time alignment',()=>{
 it('normalizes nonzero source timestamps without rounding frame indices',()=>{const t=cameraTiming(ledger([60,60.04,60.09,60.11]),25);expect(t.seconds[0]).toBe(0);expect(frameAtSessionTime(t,.085,0)).toBe(1);expect(frameAtSessionTime(t,.095,0)).toBe(2)});
 it('aligns different frame rates to one instant and steps only the active source',()=>{const a=cameraTiming(ledger([0,.04,.08,.12]),25),b=cameraTiming(ledger([0,.1,.2]),10);expect(frameAtSessionTime(a,.1,0)).toBe(2);expect(frameAtSessionTime(b,.1,0)).toBe(1);expect(stepSessionFrame(a,.1,0,1)).toBeCloseTo(.12);expect(frameAtSessionTime(b,.12,0)).toBe(1)});
 it('shows no recording before a late start or after final frame duration',()=>{const t=cameraTiming(ledger([5,5.1,5.2]),10);expect(frameAtSessionTime(t,1.9,2)).toBeNull();expect(frameAtSessionTime(t,2,2)).toBe(0);expect(frameAtSessionTime(t,2.299,2)).toBe(2);expect(frameAtSessionTime(t,2.3,2)).toBeNull()});
 it('supports negative offsets and unions every recording extent',()=>{const t=cameraTiming(ledger([0,.1,.2]),10);const b=sessionBounds([camera('a',-2),camera('b',3)],{a:t,b:t});expect(b.start).toBe(-2);expect(b.end).toBeCloseTo(3.3);expect(frameAtSessionTime(t,-1.9,-2)).toBe(1)});
 it('aligns selected moments and seeks by exact source timestamp',()=>{const t=cameraTiming(ledger([70,70.04,70.13]),25);const offset=alignOffset(t,2,12);expect(sessionTimeForFrame(t,2,offset)).toBe(12);expect(frameAtSessionTime(t,12,offset)).toBe(2)});
 it('rejects unusable ledgers instead of pretending source frames line up',()=>{expect(()=>cameraTiming([],25)).toThrow();expect(()=>cameraTiming(ledger([0,1,.5]),25)).toThrow();expect(()=>cameraTiming([{...ledger([0])[0],seconds:null}],25)).toThrow();expect(()=>cameraTiming([{...ledger([0])[0],frame_index:2}],25)).toThrow()});
 it('supports one-frame recordings and deterministic duplicate timestamps',()=>{const t=cameraTiming(ledger([9]),20);expect(t.end).toBe(.05);expect(frameAtSessionTime(t,.05,0)).toBeNull();expect(frameAtSessionTime(cameraTiming(ledger([0,0,.04]),25),0,0)).toBe(1)});
 it('keeps frames at exact floating point boundaries',()=>{const t=cameraTiming(ledger([123,123.04,123.08]),25);expect(frameAtSessionTime(t,.04,0)).toBe(1);expect(stepSessionFrame(t,.04,0,-1)).toBe(0)});
});
describe('multi-camera shared identities',()=>{
 it('reassigns one local track without modifying another camera or its annotations',()=>{const a=[{video_id:'a',identity_uuid:'i',person_uuid:'p'},{video_id:'b',identity_uuid:'i',person_uuid:'p'}];const next=assignSharedPerson(a,'a','i','q');expect(next).toEqual([a[1],{video_id:'a',identity_uuid:'i',person_uuid:'q'}]);expect(a[0].person_uuid).toBe('p');expect(assignSharedPerson(next,'a','i',null)).toEqual([a[1]])});
 it('allocates shared numbers independently from local track numbers',()=>{expect(nextSharedPersonId([{id:'a',person_id:1,name:'A',color:'#fff'},{id:'c',person_id:3,name:'C',color:'#fff'}])).toBe(2)});
 it('appearance strips contain real boxes only and keep camera gaps',()=>{const rows:Observation[]=[0,1,4,5].map(f=>({...emptyObservation('a',f,'i','s'),person_visible:[1,2,3,4] as [number,number,number,number]}));rows.push({...emptyObservation('b',2,'i','s'),person_visible:[1,2,3,4]});rows.push(emptyObservation('a',2,'i','s'));expect(appearanceRuns(rows,'a',new Set(['i']))).toEqual([{start:0,end:1},{start:4,end:5}])});
 it('formats negative and hour-long common timelines',()=>{expect(formatSessionTime(-1.234)).toBe('−00:01.234');expect(formatSessionTime(3600)).toBe('60:00.000')});
});

it('metadata undo detects external edits even when a fresh server revision is fetched',()=>{const before={name:'Room',cameras:[camera('a')],people:[],assignments:[]};expect(sameSessionContent(before,structuredClone(before))).toBe(true);expect(sameSessionContent(before,{...before,name:'Another editor renamed this'})).toBe(false);expect(sameSessionContent(before,{...before,cameras:[camera('a',1)]})).toBe(false);});
