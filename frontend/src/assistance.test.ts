import {describe,it,expect} from 'vitest';
import {applySuggestedTrack,listTrackIssues} from './assistance';
import {interpolatePerson,markCorrected} from './interpolation';
import {prepareGeometryFrame} from './hidden-range';
import {emptyObservation,validateDomain,type Domain,type Proposal,type Video} from './types';

const style={class_name:'person_visible',color:'#22d3ee'};
const videos={v:{id:'v',frame_count:200,width:1920,height:1080} as Video,other:{id:'other',frame_count:200,width:1920,height:1080} as Video};
const empty=():Domain=>({identities:{},segments:{},observations:{},intervals:{},links:{},reviews:{},proposal_reviews:{}});
const proposal=(frame:number,extra:Partial<Proposal>={}):Proposal=>({id:`det-${frame}`,video_id:'v',frame_index:frame,geometry:'person_visible',box:[100+frame,80,180+frame,240],confidence:.9,class_name:'person',cache_key:'run',track_id:'track-1',...extra});
function person(d:Domain,id='p',number=1){d.identities[id]={id,person_id:number,name:`Person ${number}`,class_name:'worker',color:'#aabbcc',box_styles:{person_visible:{class_name:'worker',color:'#aabbcc'},person_ext:{class_name:'full',color:'#ddccbb'}}};d.segments[`s-${id}`]={id:`s-${id}`,identity_uuid:id,video_id:'v',start:0,end:null,status:'verified'};}
function observation(d:Domain,frame:number,id='p'){
 const o=emptyObservation('v',frame,id,`s-${id}`);o.person_visible=[10+frame,20,50+frame,100];o.provenance.person_visible={origin:'manual',proposal_id:null,human_corrected:false};d.observations[o.id]=o;return o;
}
const at=(d:Domain,frame:number,id?:string)=>Object.values(d.observations).find(o=>o.video_id==='v'&&o.frame_index===frame&&(!id||o.identity_uuid===id));

describe('AI track acceptance',()=>{
 it('starts each person at their first detection, uses one numeric ID and never extrapolates before or after it',()=>{
  const d=empty();person(d,'first',1);person(d,'third',3);
  const result=applySuggestedTrack(d,'v',[50,51,52,53].map(f=>proposal(f)),null,style);
  expect(result).toMatchObject({added:4,skipped:0});expect(d.identities[result.identityId].person_id).toBe(2);
  expect(Object.values(d.observations).map(o=>o.frame_index)).toEqual([50,51,52,53]);
  expect(new Set(Object.values(d.observations).map(o=>o.identity_uuid))).toEqual(new Set([result.identityId]));
  expect(Object.values(d.segments).filter(s=>s.identity_uuid===result.identityId).map(s=>[s.start,s.end])).toEqual([[50,53]]);
  for(const o of Object.values(d.observations)){expect(o.person_ext).toBeNull();expect(o.provenance.person_visible).toEqual({origin:'model_track',proposal_id:`det-${o.frame_index}`,human_corrected:false});}
  validateDomain(d,videos);
 });
 it('never overwrites existing manual, interpolated, or approved Visible boxes and leaves Extended independent',()=>{
  const d=empty();person(d);const a=observation(d,0),b=observation(d,1),c=observation(d,2);b.provenance.person_visible={origin:'interpolated',proposal_id:null,human_corrected:false};
  c.person_visible=null;delete c.provenance.person_visible;c.person_ext=[90,70,170,300];c.full_quality='estimated';c.provenance.person_ext={origin:'manual',proposal_id:null,human_corrected:true};
  a.review_state='approved';const before=structuredClone(d),extended=structuredClone(c.provenance.person_ext);
  expect(applySuggestedTrack(d,'v',[0,1,2,3].map(f=>proposal(f)),'p',style)).toEqual({identityId:'p',added:2,skipped:2});
  expect(d.observations[a.id]).toEqual(before.observations[a.id]);expect(d.observations[b.id]).toEqual(before.observations[b.id]);expect(c.person_ext).toEqual(before.observations[c.id].person_ext);expect(c.provenance.person_ext).toEqual(extended);expect(d.identities.p).toEqual(before.identities.p);
  validateDomain(d,videos);
 });
 it('preserves explicit gaps and adds only Visible unavailable barriers around detector misses',()=>{
  const d=empty();person(d);d.intervals.keep={id:'keep',video_id:'v',identity_uuid:'p',start:3,end:4,geometry:'person_visible',reason:'occlusion',evidence_note:'User confirmed occlusion'};
  const ext=observation(d,5);ext.person_visible=null;delete ext.provenance.person_visible;ext.person_ext=[80,40,200,300];ext.full_quality='estimated';
  d.intervals.ext={id:'ext',video_id:'v',identity_uuid:'p',start:8,end:9,geometry:'person_ext',reason:'unknown',evidence_note:'Extended absent'};
  const before=structuredClone(d.intervals),result=applySuggestedTrack(d,'v',[0,1,3,4,7,8,9].map(f=>proposal(f)),'p',style);
  expect(result.added).toBe(5);expect(at(d,3)).toBeUndefined();expect(at(d,4)).toBeUndefined();expect(at(d,8)?.person_visible).toBeTruthy();expect(ext.person_ext).toEqual([80,40,200,300]);
  expect(d.intervals.keep).toEqual(before.keep);expect(d.intervals.ext).toEqual(before.ext);
  expect(Object.values(d.intervals).filter(g=>g.reason==='unavailable').map(g=>[g.start,g.end,g.geometry])).toEqual([[2,2,'person_visible'],[5,6,'person_visible']]);
  for(const f of [0,9])markCorrected(at(d,f)!,'person_visible');interpolatePerson(d,'v','p',[],9,'person_visible');expect(at(d,2)).toBeUndefined();expect(ext.person_visible).toBeNull();validateDomain(d,videos);
 });
 it('keeps detector holes empty without claiming true occlusion and without changing any other person/video',()=>{
  const d=empty();person(d,'otherPerson',1);const otherPerson=observation(d,3,'otherPerson');d.segments.otherVideo={id:'otherVideo',identity_uuid:'otherPerson',video_id:'other',start:0,end:null,status:'verified'};
  const otherVideo=emptyObservation('other',3,'otherPerson','otherVideo');otherVideo.person_visible=[1,2,10,20];d.observations[otherVideo.id]=otherVideo;const before=structuredClone([otherPerson,otherVideo]);
  const {identityId}=applySuggestedTrack(d,'v',[1,2,5,6].map(f=>proposal(f)),null,style);
  expect(Object.values(d.intervals)).toMatchObject([{start:3,end:4,reason:'unavailable',geometry:'person_visible'}]);
  expect(Object.values(d.intervals)[0].evidence_note).toContain('does not establish');expect([otherPerson,otherVideo]).toEqual(before);
  expect(Object.values(d.segments).filter(s=>s.identity_uuid===identityId).map(s=>[s.start,s.end])).toEqual([[1,2],[5,6]]);validateDomain(d,videos);
 });
 it('is idempotent after acceptance and after manual corrections, and refuses linking to another identity',()=>{
  const d=empty(),proposals=[1,2,3].map(f=>proposal(f));const result=applySuggestedTrack(d,'v',proposals,null,style);at(d,1)!.person_visible![0]=95;markCorrected(at(d,1)!,'person_visible');
  const before=structuredClone(d);expect(applySuggestedTrack(d,'v',proposals,null,style)).toEqual({identityId:result.identityId,added:0,skipped:3});expect(d).toEqual(before);
  person(d,'different',20);const unchanged=structuredClone(d);expect(()=>applySuggestedTrack(d,'v',proposals,'different',style)).toThrow('already linked');expect(d).toEqual(unchanged);validateDomain(d,videos);
 });
 it('allows spaced manual corrections to interpolate generated boxes while protecting a corrected middle box',()=>{
  const d=empty(),{identityId}=applySuggestedTrack(d,'v',Array.from({length:11},(_,f)=>proposal(f)),null,style);
  at(d,0)!.person_visible![3]=280;markCorrected(at(d,0)!,'person_visible');at(d,10)!.person_visible![3]=320;markCorrected(at(d,10)!,'person_visible');
  interpolatePerson(d,'v',identityId,[],10,'person_visible');expect(at(d,5)!.person_visible![3]).toBe(300);expect(at(d,5)!.provenance.person_visible?.origin).toBe('interpolated');
  at(d,5)!.person_visible![3]=350;markCorrected(at(d,5)!,'person_visible');interpolatePerson(d,'v',identityId,[],5,'person_visible');expect(at(d,3)!.person_visible![3]).toBe(322);expect(at(d,7)!.person_visible![3]).toBe(338);validateDomain(d,videos);
 });
 it('retains track association when outside manual anchors replace every original detection through interpolation',()=>{
  const d=empty(),proposals=Array.from({length:11},(_,n)=>proposal(n+10));
  const {identityId}=applySuggestedTrack(d,'v',proposals,null,style);
  for(const [frame,bottom] of [[5,280],[25,320]]){
   const segment=prepareGeometryFrame(d,'v',identityId,frame,'person_visible');
   const o=emptyObservation('v',frame,identityId,segment.id);o.person_visible=[100+frame,80,180+frame,bottom];o.provenance.person_visible={origin:'manual',proposal_id:null,human_corrected:false};d.observations[o.id]=o;
  }
  expect(interpolatePerson(d,'v',identityId,[],25,'person_visible')).toBe(19);
  for(const p of proposals){const o=at(d,p.frame_index)!;expect(o.provenance.person_visible).toEqual({origin:'interpolated',proposal_id:p.id,human_corrected:false});expect(o.person_visible![3]).toBeGreaterThan(p.box[3]);}
  expect(at(d,15)!.person_visible![3]).toBe(300);
  const before=structuredClone(d);expect(applySuggestedTrack(d,'v',proposals,null,style)).toEqual({identityId,added:0,skipped:11});expect(d).toEqual(before);expect(Object.keys(d.identities)).toEqual([identityId]);validateDomain(d,videos);
 });
 it('handles duplicate detections and rejected proposals without empty or duplicate identities',()=>{
  const d=empty();d.proposal_reviews.r={id:'r',video_id:'v',frame_index:2,proposal_id:'det-2',decision:'rejected',reason:'Wrong person'};
  expect(applySuggestedTrack(d,'v',[proposal(2)],null,style)).toEqual({identityId:'',added:0,skipped:1});expect(Object.values(d.identities)).toHaveLength(0);
  const better=proposal(1,{id:'better',confidence:.99,box:[1,2,30,40]});expect(applySuggestedTrack(d,'v',[proposal(1),better,proposal(2),proposal(3)],null,style).added).toBe(2);expect(at(d,1)!.person_visible).toEqual(better.box);expect(at(d,1)!.person_visible).not.toBe(better.box);expect(at(d,2)).toBeUndefined();validateDomain(d,videos);
 });
 it('rejects invalid or mixed tracks without partial mutation and leaves unrelated proposal types alone',()=>{
  const d=empty(),before=structuredClone(d);expect(()=>applySuggestedTrack(d,'v',[proposal(1),proposal(2,{box:[1,2,0,4]})],null,style)).toThrow('invalid');expect(d).toEqual(before);
  expect(()=>applySuggestedTrack(d,'v',[proposal(1),proposal(2,{track_id:'another'})],null,style)).toThrow('one suggested track');expect(d).toEqual(before);
  expect(()=>applySuggestedTrack(d,'v',[proposal(1,{track_id:null}),proposal(2,{track_id:null})],null,style)).toThrow('shared track');expect(d).toEqual(before);
  expect(applySuggestedTrack(d,'v',[proposal(1,{geometry:'person_ext'}),proposal(2,{video_id:'other'})],null,style).added).toBe(0);expect(d).toEqual(before);
 });
});

describe('track review issues',()=>{
 it('flags uncertain confidence, detector gaps, movement/size changes and explicit tracker warnings',()=>{
  const rows=[proposal(50),proposal(51,{confidence:.2,box:[1200,600,1400,1000]}),proposal(55,{track_issue:'Reappearance after occlusion'})];
  const issues=listTrackIssues(rows);expect(issues.map(i=>i.kind)).toEqual(['low_confidence','motion_jump','size_jump','gap','size_jump','tracker_warning']);
  expect(issues.find(i=>i.kind==='gap')).toMatchObject({frame_index:55,start_frame:52,end_frame:54,track_id:'track-1'});
  expect(rows.map(p=>p.frame_index)).toEqual([50,51,55]);
 });
 it('never compares separate people, runs, or videos and does not flag normal late arrival',()=>{
  expect(listTrackIssues([proposal(50),proposal(51),proposal(100,{track_id:'second'}),proposal(150,{cache_key:'other-run'}),proposal(190,{video_id:'other'})])).toEqual([]);
  expect(listTrackIssues([proposal(1,{track_id:null}),proposal(10,{track_id:null})])).toEqual([]);
 });
 it('supports a review confidence threshold without changing or removing the source proposals',()=>{
  const rows=[proposal(1,{confidence:.6})],before=structuredClone(rows);expect(listTrackIssues(rows,{confidenceThreshold:.5})).toEqual([]);expect(listTrackIssues(rows,{confidenceThreshold:.7})).toHaveLength(1);expect(rows).toEqual(before);
 });
});
