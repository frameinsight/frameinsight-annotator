import {describe,it,expect} from 'vitest';
import {deleteGeometryRange,markHiddenRange,prepareGeometryFrame} from './hidden-range';
import {interpolatePerson} from './interpolation';
import {previewRestoreRange,restoreRange} from './restore-range';
import {setBox,emptyObservation,uuid,validateDomain,type Change,type Domain,type Geometry,type Operation,type Video} from './types';

const videos={v:{id:'v',frame_count:2000,width:640,height:360} as Video};
const at=(d:Domain,f:number)=>Object.values(d.observations).find(o=>o.identity_uuid==='p'&&o.video_id==='v'&&o.frame_index===f)!;
function operation(before:Domain,after:Domain):Operation{
 const changes:Change[]=[];for(const collection of Object.keys(before) as (keyof Domain)[])for(const id of new Set([...Object.keys(before[collection]),...Object.keys(after[collection])]))if(JSON.stringify(before[collection][id])!==JSON.stringify(after[collection][id]))changes.push({collection,id,before:structuredClone(before[collection][id]??null),after:structuredClone(after[collection][id]??null)});
 return {id:uuid(),base_revision:0,label:'Fixture edit',video_id:'v',frame_index:1000,changes};
}
function draw(d:Domain,frame:number,left:number,geometry:Geometry='person_visible'){
 const segment=prepareGeometryFrame(d,'v','p',frame,geometry),o=at(d,frame)||emptyObservation('v',frame,'p',segment.id);setBox(o,geometry,[left,80,left+60,geometry==='person_visible'?240:310]);o.provenance[geometry]={origin:'manual',proposal_id:null,human_corrected:true};o.review_state='draft';d.observations[o.id]=o;return o;
}
function setup(legacy=false){
 const d:Domain={identities:{p:{id:'p',person_id:1,name:'Person 1'}},segments:{s:{id:'s',video_id:'v',identity_uuid:'p',start:0,end:null,status:'verified'}},observations:{},intervals:{},reviews:{},links:{},proposal_reviews:{}};
 for(const [f,x] of [[999,100],[1101,200]]){draw(d,f,x);draw(d,f,x-5,'person_ext');}
 for(const geometry of ['person_visible','person_ext'] as Geometry[])interpolatePerson(d,'v','p',[],undefined,geometry);
 const original=structuredClone(d);if(legacy)markHiddenRange(d,'v','p',1000,1100,2000);else deleteGeometryRange(d,'v','p',1000,1100,2000,'person_visible');
 return {d,original,history:[operation(original,d)]};
}
const preview=(d:Domain,start=1000,end=1100,mode:'interpolate'|'original'='interpolate',history:Operation[]=[])=>previewRestoreRange(d,'v','p',start,end,2000,'person_visible',mode,history);
const recover=(d:Domain,start=1000,end=1100,mode:'interpolate'|'original'='interpolate',history:Operation[]=[])=>restoreRange(d,'v','p',start,end,2000,'person_visible',mode,history);

describe('explicit deleted-range recovery',()=>{
 it('fills the exact 1000–1100 deletion after endpoint drawing, preserving endpoints and Extended',()=>{
  const {d}=setup();draw(d,1000,120);draw(d,1100,220);const before=structuredClone(d);interpolatePerson(d,'v','p');expect(at(d,1050).person_visible).toBeNull();
  expect(preview(d)).toMatchObject({canRestore:true,restoredBoxes:99,keptBoxes:2,anchorFrames:[1000,1100],remainingBlockedFrames:0});expect(d).toEqual(before);
  recover(d);expect(at(d,1050).person_visible).toEqual([170,80,230,240]);expect(at(d,1050).provenance.person_visible?.origin).toBe('interpolated');expect(Object.values(d.intervals)).toHaveLength(0);
  for(const o of Object.values(d.observations)){expect(o.person_ext).toEqual(before.observations[o.id].person_ext);expect(o.provenance.person_ext).toEqual(before.observations[o.id].provenance.person_ext);}
  expect(at(d,1000).person_visible).toEqual(at(before,1000).person_visible);expect(at(d,1100).person_visible).toEqual(at(before,1100).person_visible);validateDomain(d,videos);
 });
 it('keeps outside interval portions and requires local anchors for a partial recovery',()=>{
  const {d}=setup();expect(preview(d,1030,1050).error).toContain('outside');draw(d,1030,130);draw(d,1050,170);
  recover(d,1030,1050);expect(Object.values(d.intervals).map(g=>[g.start,g.end]).sort((a,b)=>a[0]!-b[0]!)).toEqual([[1000,1029],[1051,1100]]);expect(at(d,1040).person_visible![0]).toBe(150);expect(at(d,1020).person_visible).toBeNull();expect(at(d,1060).person_visible).toBeNull();validateDomain(d,videos);
 });
 it('restores original geometry and provenance, keeps later edits, and never overwrites present boxes',()=>{
  const {d,original,history}=setup();const beforeEdit=structuredClone(d);draw(d,1050,300);at(d,1040).person_ext=[300,60,400,330];at(d,1040).evidence_note='Later independent correction';history.push(operation(beforeEdit,d));const before=structuredClone(d);
  expect(preview(d,1000,1100,'original',history)).toMatchObject({restoredBoxes:100,keptBoxes:1});recover(d,1000,1100,'original',history);
  expect(at(d,1040).person_visible).toEqual(at(original,1040).person_visible);expect(at(d,1040).provenance.person_visible).toEqual(at(original,1040).provenance.person_visible);expect(at(d,1040).person_ext).toEqual(at(before,1040).person_ext);expect(at(d,1040).evidence_note).toBe('Later independent correction');expect(at(d,1050)).toEqual(at(before,1050));validateDomain(d,videos);
 });
 it('does not use stale originals after a later deletion of an already-empty range',()=>{
  const {d,history}=setup(),before=structuredClone(d);deleteGeometryRange(d,'v','p',1000,1100,2000,'person_visible');history.push(operation(before,d));const unchanged=structuredClone(d);
  expect(preview(d,1000,1100,'original',history).canRestore).toBe(false);expect(()=>recover(d,1000,1100,'original',history)).toThrow('not available');expect(d).toEqual(unchanged);
 });
 it('accepts chronological persistent history including undo and redo without inventing older boxes',()=>{
  const {d,original,history}=setup();const deleted=structuredClone(d);history.push(operation(deleted,original));history.push(operation(original,deleted));
  expect(preview(d,1000,1100,'original',history).restoredBoxes).toBe(101);recover(d,1000,1100,'original',history);expect(at(d,1050).person_visible).toEqual(at(original,1050).person_visible);validateDomain(d,videos);
 });
 it('undoing a fill retains the original deletion coordinates instead of treating generated boxes as originals',()=>{
  const {d,original,history}=setup();const beforeDrawing=structuredClone(d);draw(d,1000,120);draw(d,1100,220);history.push(operation(beforeDrawing,d));const blocked=structuredClone(d);
  recover(d);const generated=structuredClone(d),fill=operation(blocked,generated);history.push(fill);const undo=operation(generated,blocked);undo.compensates=fill.id;history.push(undo);
  expect(at(generated,1050).person_visible).not.toEqual(at(original,1050).person_visible);recover(blocked,1000,1100,'original',history);expect(at(blocked,1050).person_visible).toEqual(at(original,1050).person_visible);expect(at(blocked,1000).person_visible).toEqual([120,80,180,240]);validateDomain(blocked,videos);
 });
 it('reports missing history and restores only recoverable frames without removing other gaps',()=>{
  const {d,original}=setup();const one=structuredClone(original);deleteGeometryRange(one,'v','p',1040,1040,2000,'person_visible');const history=[operation(original,one)];
  const p=preview(d,1000,1100,'original',history);expect(p).toMatchObject({restoredBoxes:1,remainingBlockedFrames:100});expect(p.warnings[0]).toContain('100 deleted frames');recover(d,1000,1100,'original',history);expect(at(d,1040).person_visible).toEqual(at(original,1040).person_visible);expect(at(d,1041).person_visible).toBeNull();validateDomain(d,videos);
 });
 for(const mode of ['interpolate','original'] as const)it(`handles legacy split segments and unscoped gaps during ${mode} recovery`,()=>{
  const {d,original,history}=setup(true);expect(Object.values(d.segments)).toHaveLength(2);recover(d,1000,1100,mode,history);
  expect(Object.values(d.intervals)).toMatchObject([{start:1000,end:1100,geometry:'person_ext'}]);expect(Object.values(d.segments)).toHaveLength(1);expect(at(d,1050).person_visible).toEqual(at(original,1050).person_visible);expect(at(d,1050).person_ext).toBeNull();expect(at(d,1101).person_ext).toEqual(at(original,1101).person_ext);validateDomain(d,videos);
 });
 it('does not modify another identity or another video and restores the entire command through an exact inverse',()=>{
  const {d}=setup();d.identities.other={id:'other',person_id:2,name:'Other'};d.segments.other={id:'other',video_id:'v',identity_uuid:'other',start:0,end:null,status:'verified'};const o=emptyObservation('v',1050,'other','other');o.person_visible=[300,80,400,250];d.observations[o.id]=o;
  d.segments.camera={id:'camera',video_id:'camera',identity_uuid:'p',start:0,end:null,status:'verified'};const camera=emptyObservation('camera',1050,'p','camera');camera.person_visible=[20,20,100,200];d.observations[camera.id]=camera;
  const untouched=structuredClone(o),before=structuredClone(d);recover(d);expect(d.observations[o.id]).toEqual(untouched);expect(d.observations[camera.id]).toEqual(before.observations[camera.id]);const change=operation(before,d);
  for(const c of change.changes){expect(d[c.collection][c.id]??null).toEqual(c.after);if(c.before===null)delete d[c.collection][c.id];else (d[c.collection] as any)[c.id]=structuredClone(c.before);}
  expect(d).toEqual(before);validateDomain(d,{...videos,camera:{...videos.v,id:'camera'}});
 });
 it('keeps unresolved identity boundaries blocked and rejects invalid ranges without mutation',()=>{
  const {d}=setup(true);d.segments[at(d,1101).segment_id].status='unresolved';const before=structuredClone(d);expect(preview(d).error).toContain('verified');expect(()=>recover(d)).toThrow('verified');expect(preview(d,-1,2).canRestore).toBe(false);expect(d).toEqual(before);
 });
 it('preserves unresolved identity status when recovering an entirely deleted legacy segment',()=>{
  const {original}=setup();original.segments.s.status='unresolved';original.segments.s.start=999;original.segments.s.end=1101;
  const d=structuredClone(original);markHiddenRange(d,'v','p',999,1101,2000);expect(Object.values(d.segments)).toHaveLength(0);const history=[operation(original,d)];
  expect(preview(d,999,1101,'original',history).warnings.join(' ')).toContain('unresolved');recover(d,999,1101,'original',history);
  expect(Object.values(d.segments)).toMatchObject([{start:999,end:1101,status:'unresolved'}]);expect(at(d,1050).person_visible).toEqual(at(original,1050).person_visible);expect(at(d,1050).person_ext).toBeNull();validateDomain(d,videos);
 });
});
