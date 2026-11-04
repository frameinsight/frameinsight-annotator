import {it,expect} from 'vitest';
import {currentObservation,frameObservations,inheritFrameIndex,emptyObservation,type Project} from './types';
it('keeps frame/video/identity isolation and follows immutable edits, deletion, and undo',()=>{
 const a=emptyObservation('a',0,'person','segment');const b=emptyObservation('b',0,'person','segment');const c=emptyObservation('a',1,'person','segment');
 const p={state:{observations:{[a.id]:a,[b.id]:b,[c.id]:c}}} as Project;
 expect(frameObservations(p,'a',0)).toEqual([a]);expect(currentObservation(p,'b',0,'person')).toBe(b);expect(currentObservation(p,'a',1,'person')).toBe(c);
 const edited={...a,person_visible:[1,2,3,4] as [number,number,number,number]};
 const q={...p,state:{...p.state,observations:{...p.state.observations,[a.id]:edited}}};
 expect(currentObservation(q,'a',0,'person')).toBe(edited);expect(currentObservation(p,'a',0,'person')).toBe(a);
 const deleted={...q,state:{...q.state,observations:{[b.id]:b,[c.id]:c}}};expect(frameObservations(deleted,'a',0)).toEqual([]);expect(currentObservation(deleted,'a',0,'person')).toBeUndefined();
});

it('updates only changed frame lists across a move, deletion and addition without changing older lookups',()=>{
 const a=emptyObservation('a',0,'first','s'),b=emptyObservation('a',0,'second','s'),c=emptyObservation('b',0,'third','t');
 const p={state:{observations:{[a.id]:a,[b.id]:b,[c.id]:c}}} as Project;const original=frameObservations(p,'a',0),other=frameObservations(p,'b',0);
 const moved={...a,frame_index:2},added=emptyObservation('a',0,'fourth','s');const next={...p,state:{...p.state,observations:{[a.id]:moved,[c.id]:c,[added.id]:added}}};
 inheritFrameIndex(p.state.observations,next.state.observations,[{collection:'observations',id:a.id,before:a,after:moved},{collection:'observations',id:b.id,before:b,after:null},{collection:'observations',id:added.id,before:null,after:added}]);
 expect(frameObservations(next,'a',0)).toEqual([added]);expect(frameObservations(next,'a',2)).toEqual([moved]);expect(frameObservations(next,'b',0)).toBe(other);expect(frameObservations(p,'a',0)).toBe(original);expect(original).toEqual([a,b]);
});
