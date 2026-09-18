import {it,expect} from 'vitest';
import {currentObservation,frameObservations,emptyObservation,type Project} from './types';
it('keeps frame/video/identity isolation and follows immutable edits, deletion, and undo',()=>{
 const a=emptyObservation('a',0,'person','segment');const b=emptyObservation('b',0,'person','segment');const c=emptyObservation('a',1,'person','segment');
 const p={state:{observations:{[a.id]:a,[b.id]:b,[c.id]:c}}} as Project;
 expect(frameObservations(p,'a',0)).toEqual([a]);expect(currentObservation(p,'b',0,'person')).toBe(b);expect(currentObservation(p,'a',1,'person')).toBe(c);
 const edited={...a,person_visible:[1,2,3,4] as [number,number,number,number]};
 const q={...p,state:{...p.state,observations:{...p.state.observations,[a.id]:edited}}};
 expect(currentObservation(q,'a',0,'person')).toBe(edited);expect(currentObservation(p,'a',0,'person')).toBe(a);
 const deleted={...q,state:{...q.state,observations:{[b.id]:b,[c.id]:c}}};expect(frameObservations(deleted,'a',0)).toEqual([]);expect(currentObservation(deleted,'a',0,'person')).toBeUndefined();
});
