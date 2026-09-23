import {describe,it,expect} from 'vitest';
import {classKey,getBox,setBox,boxKeys,boxStyle,geometryForClass,identityGeometryKeys,emptyObservation,validateDomain,type Box,type Change,type Domain,type Geometry,type Operation,type Video} from './types';
import {interpolatePerson,markCorrected} from './interpolation';
import {deleteGeometryRange,markHiddenRange,prepareGeometryFrame} from './hidden-range';
import {previewRestoreRange,restoreRange} from './restore-range';
import {copyClassTrack} from './copy-visible';
import {assignPerson} from './identity';
import {timelineBins} from './timeline';

const names=['Visible outline','Estimated body','Face'],keys=names.map(classKey),videos={v:{id:'v',frame_count:20,width:640,height:360} as Video};
const at=(d:Domain,f:number,id='p')=>Object.values(d.observations).find(o=>o.identity_uuid===id&&o.frame_index===f)!;
function fixture(){
 const d:Domain={identities:{p:{id:'p',name:'Person 1',person_id:1,class_name:names[0],box_styles:Object.fromEntries(keys.map((key,i)=>[key,{class_name:names[i],color:['#112233','#445566','#778899'][i]}]))}},segments:{s:{id:'s',video_id:'v',identity_uuid:'p',start:0,end:null,status:'verified'}},observations:{},intervals:{},links:{},reviews:{},proposal_reviews:{}};
 for(const f of [0,10])for(const [i,g] of keys.entries())draw(d,f,g,[100+f*10+i*5,60+i*10,180+f*10+i*5,300-i*30]);
 interpolatePerson(d,'v','p',[],undefined,false);return d;
}
function draw(d:Domain,frame:number,g:Geometry,box:Box){const segment=prepareGeometryFrame(d,'v','p',frame,g),o=at(d,frame)||emptyObservation('v',frame,'p',segment.id);setBox(o,g,box);o.provenance[g]={origin:'manual',proposal_id:null,human_corrected:true};d.observations[o.id]=o;return o;}
function operation(before:Domain,after:Domain):Operation{
 const changes:Change[]=[];for(const collection of Object.keys(before) as (keyof Domain)[])for(const id of new Set([...Object.keys(before[collection]),...Object.keys(after[collection])]))if(JSON.stringify(before[collection][id])!==JSON.stringify(after[collection][id]))changes.push({collection,id,before:structuredClone(before[collection][id]??null),after:structuredClone(after[collection][id]??null)});
 return {id:crypto.randomUUID(),base_revision:0,label:'Test edit',video_id:'v',frame_index:5,changes};
}
function undo(d:Domain,op:Operation){for(const c of op.changes){if(c.before===null)delete d[c.collection][c.id];else (d[c.collection] as any)[c.id]=structuredClone(c.before);}}

describe('arbitrary classes under one track',()=>{
 it('interpolates three classes independently, preserves manual corrections and indexes all classes',()=>{
  const d=fixture(),before=structuredClone(d);expect(boxKeys(at(d,5))).toHaveLength(3);expect(identityGeometryKeys(d,'p')).toEqual(keys);expect(at(d,5).person_visible).toBeNull();expect(at(d,5).person_ext).toBeNull();
  setBox(at(d,5),keys[1],[170,70,260,340]);markCorrected(at(d,5),keys[1]);interpolatePerson(d,'v','p',[],5,keys[1]);expect(getBox(at(d,3),keys[1])![0]).toBeCloseTo(144);
  for(const f of Array.from({length:11},(_,i)=>i))for(const g of [keys[0],keys[2]]){expect(getBox(at(d,f),g)).toEqual(getBox(at(before,f),g));expect(at(d,f).provenance[g]).toEqual(at(before,f).provenance[g]);}
  expect(timelineBins(d,'v',20,'p',keys[2]).filter(bin=>bin.generated)).toHaveLength(9);validateDomain(d,videos);
 });
 it('deletes and explicitly refills only one class while preserving endpoint corrections and other classes',()=>{
  const d=fixture(),before=structuredClone(d);deleteGeometryRange(d,'v','p',3,7,20,keys[2]);draw(d,3,keys[2],[150,80,210,240]);draw(d,7,keys[2],[230,80,290,240]);const blocked=structuredClone(d);
  interpolatePerson(d,'v','p',[],undefined,keys[2]);expect(getBox(at(d,5),keys[2])).toBeNull();expect(previewRestoreRange(d,'v','p',3,7,20,keys[2],'interpolate')).toMatchObject({restoredBoxes:3,keptBoxes:2});
  restoreRange(d,'v','p',3,7,20,keys[2],'interpolate');expect(getBox(at(d,5),keys[2])![0]).toBe(190);for(const g of [keys[0],keys[1]])for(let f=0;f<=10;f++)expect(getBox(at(d,f),g)).toEqual(getBox(at(before,f),g));
  const op=operation(blocked,d);undo(d,op);expect(d).toEqual(blocked);validateDomain(d,videos);
 });
 it('recovers dynamic original boxes from edit history and retains later corrections',()=>{
  const d=fixture(),before=structuredClone(d);deleteGeometryRange(d,'v','p',3,7,20,keys[1]);const deletion=operation(before,d);draw(d,5,keys[1],[300,80,390,310]);
  expect(previewRestoreRange(d,'v','p',3,7,20,keys[1],'original',[deletion])).toMatchObject({restoredBoxes:4,keptBoxes:1});restoreRange(d,'v','p',3,7,20,keys[1],'original',[deletion]);expect(getBox(at(d,4),keys[1])).toEqual(getBox(at(before,4),keys[1]));expect(getBox(at(d,5),keys[1])![0]).toBe(300);validateDomain(d,videos);
 });
 it('scopes an old all-class gap to every known class without adding unused fixed slots',()=>{
  const d=fixture();markHiddenRange(d,'v','p',3,7,20);restoreRange(d,'v','p',3,7,20,keys[0],'interpolate');
  expect(Object.values(d.intervals).map(g=>g.geometry).sort()).toEqual([keys[1],keys[2]].sort());expect(boxKeys(at(d,5))).toEqual([keys[0]]);validateDomain(d,videos);
 });
 it('copies once to a fourth class, preserves existing target boxes, and permits spaced corrections',()=>{
  const d=fixture(),before=structuredClone(d),target=classKey('Helmet');draw(d,5,target,[300,50,350,110]);
  expect(copyClassTrack(d,'v','p',keys[2],'Helmet','#aabbcc')).toEqual({count:10,geometry:target});expect(getBox(at(d,5),target)![0]).toBe(300);expect(boxStyle(d.identities.p,target)).toEqual({class_name:'Helmet',color:'#aabbcc'});
  draw(d,0,target,[150,40,190,110]);draw(d,10,target,[200,50,250,120]);interpolatePerson(d,'v','p',[],undefined,target);expect(getBox(at(d,3),target)![0]).toBe(240);expect(getBox(at(d,7),target)![0]).toBe(260);
  for(const g of keys)for(let f=0;f<=10;f++)expect(getBox(at(d,f),g)).toEqual(getBox(at(before,f),g));expect(copyClassTrack(d,'v','p',keys[2],'Helmet').count).toBe(0);validateDomain(d,videos);
 });
 it('rejects same-class same-frame collisions across legacy and dynamic storage without mutation',()=>{
  const d=fixture();d.identities.old={id:'old',person_id:2,name:'Old',class_name:names[0]};d.segments.old={id:'old',video_id:'v',identity_uuid:'old',start:0,end:null,status:'verified'};const o=emptyObservation('v',0,'old','old');o.person_visible=[1,1,20,30];d.observations[o.id]=o;const before=structuredClone(d);
  expect(()=>assignPerson(d,'old','p','v',0,1,names[0],'#112233',keys[0],'person_visible')).toThrow('same box type or class');expect(d).toEqual(before);
 });
 it('reuses a legacy class at a later frame under the same ID and preserves exact undo',()=>{
  const d=fixture();d.identities.old={id:'old',person_id:2,name:'Old',class_name:'Hand'};d.segments.old={id:'old',video_id:'v',identity_uuid:'old',start:15,end:null,status:'verified'};const o=emptyObservation('v',15,'old','old');o.person_visible=[100,20,140,80];o.provenance.person_visible={origin:'manual',proposal_id:null,human_corrected:true};d.observations[o.id]=o;const before=structuredClone(d);
  assignPerson(d,'old','p','v',15,1,'Hand','#abcdef',classKey('Hand'),'person_visible');expect(Object.keys(d.identities)).toEqual(['p']);expect(at(d,15).person_visible).toBeNull();expect(getBox(at(d,15),classKey('Hand'))).toEqual(o.person_visible);expect(geometryForClass(d.identities.p,'Hand')).toBe(classKey('Hand'));validateDomain(d,videos);undo(d,operation(before,d));expect(d).toEqual(before);
 });
 it('reclassifies only the selected class channel and rejects an occupied target',()=>{
  const d=fixture(),before=structuredClone(d),target=classKey('Torso');assignPerson(d,'p','p','v',0,1,'Torso','#ffaa00',target,keys[1]);expect(getBox(at(d,5),keys[1])).toBeNull();expect(getBox(at(d,5),target)).toEqual(getBox(at(before,5),keys[1]));expect(getBox(at(d,5),keys[0])).toEqual(getBox(at(before,5),keys[0]));
  const saved=structuredClone(d);expect(()=>assignPerson(d,'p','p','v',0,1,names[0],'#112233',keys[0],target)).toThrow('same frame');expect(d).toEqual(saved);validateDomain(d,videos);
 });
 it('validates generic source pixel bounds and rejects shadow copies of reserved slot fields',()=>{
  const d=fixture();setBox(at(d,5),keys[2],[-1,0,20,30]);expect(()=>validateDomain(d,videos)).toThrow('positive area');setBox(at(d,5),keys[2],[0,0,20,30]);at(d,5).boxes!.person_visible=[0,0,20,30];expect(()=>validateDomain(d,videos)).toThrow('class key');
 });
 it('normalizes a converted legacy extended target before joining later same-class boxes',()=>{
  const d=fixture();d.identities.old={id:'old',person_id:2,name:'Old',class_name:'person_extended',color:'#abcdef'};d.segments.old={id:'old',video_id:'v',identity_uuid:'old',start:0,end:null,status:'verified'};const legacy=emptyObservation('v',0,'old','old');legacy.person_visible=[20,20,100,300];d.observations[legacy.id]=legacy;
  const source=classKey('person_extended');d.identities.p.box_styles![source]={class_name:'person_extended',color:'#abcdef'};draw(d,15,source,[100,20,180,300]);
  assignPerson(d,'p','old','v',15,2,'person_extended','#abcdef',geometryForClass(d.identities.old,'person_extended'),source);
  expect(getBox(at(d,0,'old'),'person_ext')).toEqual([20,20,100,300]);expect(getBox(at(d,15,'old'),'person_ext')).toEqual([100,20,180,300]);expect(getBox(at(d,15,'old'),'person_visible')).toBeNull();expect(geometryForClass(d.identities.old,'person_extended')).toBe('person_ext');validateDomain(d,videos);
 });
 it('rejects relabeling a legacy slot into its occupied same-track class without mutation',()=>{
  const d=fixture();d.identities.old={id:'old',person_id:2,name:'Old',box_styles:{person_visible:{class_name:'Visible',color:'#112233'},person_ext:{class_name:'Full',color:'#abcdef'}}};d.segments.old={id:'old',video_id:'v',identity_uuid:'old',start:0,end:null,status:'verified'};const o=emptyObservation('v',0,'old','old');o.person_visible=[20,40,60,100];o.person_ext=[10,10,80,150];d.observations[o.id]=o;const before=structuredClone(d);
  expect(()=>assignPerson(d,'old','old','v',0,2,'Full','#abcdef','person_visible','person_visible')).toThrow('same frame');expect(d).toEqual(before);validateDomain(d,videos);
 });
 it('rekeys a renamed dynamic class even when a dialog still carries its prior key',()=>{
  const d=fixture();assignPerson(d,'p','p','v',0,1,'Torso','#abcdef',keys[1],keys[1]);expect(getBox(at(d,5),classKey('Torso'))).not.toBeNull();expect(getBox(at(d,5),keys[1])).toBeNull();expect(d.identities.p.box_styles![classKey('Torso')]!.class_name).toBe('Torso');validateDomain(d,videos);
 });
});
