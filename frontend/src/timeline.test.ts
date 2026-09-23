import {describe,it,expect} from 'vitest';
import type {Domain} from './types';
import {timelineBins} from './timeline';
import {emptyObservation} from './types';
const state=():Domain=>({identities:{},segments:{},observations:{},intervals:{},links:{},reviews:{},proposal_reviews:{}});
describe('aggregated frame review timeline',()=>{
 it('never marks a bin complete when one of its source frames is incomplete',()=>{
  const d=state();for(let f=0;f<613;f++)d.reviews['v:'+f]={id:'v:'+f,video_id:'v',frame_index:f,complete:true,checked_all_people:true,note:''};
  expect(timelineBins(d,'v',613,'').every(b=>b.complete)).toBe(true);
  d.reviews['v:612'].complete=false;const bins=timelineBins(d,'v',613,'');
  expect(bins.at(-1)?.complete).toBe(false);expect(bins.filter(b=>b.complete)).toHaveLength(239);
  d.reviews['v:2'].complete=false;const next=timelineBins(d,'v',613,'');
  expect(next[0].complete).toBe(true);expect(next[1].complete).toBe(false);
 });
 it('handles an empty video and gaps intersecting any part of a bin',()=>{
  const d=state();expect(timelineBins(d,'v',0,'p')).toEqual([]);
  d.intervals.g={id:'g',video_id:'v',identity_uuid:'p',start:1,end:1,reason:'occlusion',evidence_note:''};
  expect(timelineBins(d,'v',613,'p')[0].gap).toBe(true);
  expect(timelineBins(d,'other',613,'p')[0].gap).toBe(false);
 });
});
it('shows selected person keyframes separately from generated boxes and other people',()=>{
 const d=state();
 for(const [frame,who,generated] of [[0,'p',false],[1,'p',true],[2,'q',false]] as const){const o=emptyObservation('v',frame,who,'s');o.person_visible=[0,0,10,10];o.provenance.person_visible={origin:generated?'interpolated':'manual',proposal_id:null,human_corrected:false};d.observations[o.id]=o;}
 const bins=timelineBins(d,'v',3,'p','person_visible');
 expect(bins[0].manual).toBe(true);expect(bins[0].generated).toBe(false);
 expect(bins[1].generated).toBe(true);expect(bins[1].manual).toBe(false);
 expect(bins[2].draft).toBe(false);
});
it('a visible deletion is not an extended gap',()=>{
 const d=state();d.intervals.g={id:'g',video_id:'v',identity_uuid:'p',start:1,end:1,reason:'unknown',evidence_note:'',geometry:'person_visible'};
 expect(timelineBins(d,'v',24,'p','person_visible')[1].gap).toBe(true);
 expect(timelineBins(d,'v',24,'p','person_ext')[1].gap).toBe(false);
});
