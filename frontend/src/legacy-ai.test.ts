import {expect,it} from 'vitest';
import {interpolatePerson,markCorrected} from './interpolation';
import {emptyObservation,validateDomain,type Change,type Domain,type Video} from './types';

const videos={v:{id:'v',frame_count:24,width:640,height:360} as Video};
function savedLegacyTrack(){
 const d:Domain={identities:{p:{id:'p',person_id:7,name:'Person 7'}},segments:{s:{id:'s',identity_uuid:'p',video_id:'v',start:0,end:10,status:'verified'}},observations:{},intervals:{},links:{},reviews:{},proposal_reviews:{}};
 for(let frame=0;frame<=10;frame++){
  const o=emptyObservation('v',frame,'p','s');o.person_visible=[100+frame,80,180+frame,240];o.provenance.person_visible={origin:'model_track',proposal_id:`saved-proposal-${frame}`,human_corrected:false};
  o.person_ext=[90+frame,60,190+frame,330];o.full_quality='estimated';o.provenance.person_ext={origin:'manual',proposal_id:null,human_corrected:true};d.observations[o.id]=o;
 }
 return d;
}
const at=(d:Domain,f:number)=>Object.values(d.observations).find(o=>o.frame_index===f)!;

it('keeps previously saved AI boxes editable with independent manual interpolation after AI removal',()=>{
 const d=savedLegacyTrack(),before=structuredClone(d);validateDomain(d,videos);
 for(const [frame,bottom] of [[0,260],[10,300]]){const o=at(d,frame);o.person_visible![3]=bottom;markCorrected(o,'person_visible');interpolatePerson(d,'v','p',[],frame,'person_visible');}
 expect(at(d,5).person_visible![3]).toBe(280);expect(at(d,5).provenance.person_visible?.origin).toBe('interpolated');
 expect(at(d,0).provenance.person_visible).toEqual({origin:'model_track',proposal_id:'saved-proposal-0',human_corrected:true});
 expect(at(d,10).provenance.person_visible?.human_corrected).toBe(true);
 at(d,5).person_visible![3]=320;markCorrected(at(d,5),'person_visible');interpolatePerson(d,'v','p',[],5,'person_visible');
 expect(at(d,3).person_visible![3]).toBe(296);expect(at(d,7).person_visible![3]).toBe(312);
 for(const o of Object.values(d.observations)){expect(o.person_ext).toEqual(before.observations[o.id].person_ext);expect(o.provenance.person_ext).toEqual(before.observations[o.id].provenance.person_ext);}
 expect(d.identities).toEqual(before.identities);validateDomain(d,videos);
});

it('restores a valid legacy model_track snapshot through the ordinary operation inverse shape',()=>{
 const d=savedLegacyTrack(),before=structuredClone(d);
 for(const [frame,bottom] of [[0,260],[10,300]]){at(d,frame).person_visible![3]=bottom;markCorrected(at(d,frame),'person_visible');interpolatePerson(d,'v','p',[],frame,'person_visible');}
 const changes:Change[]=Object.values(d.observations).filter(o=>JSON.stringify(o)!==JSON.stringify(before.observations[o.id])).map(o=>({collection:'observations',id:o.id,before:structuredClone(before.observations[o.id]),after:structuredClone(o)}));
 expect(changes).toHaveLength(11);
 const inverse=JSON.parse(JSON.stringify(changes)).map((c:Change)=>({...c,before:c.after,after:c.before})) as Change[];
 for(const change of inverse){expect(d.observations[change.id]).toEqual(change.before);d.observations[change.id]=structuredClone(change.after);}
 validateDomain(d,videos);expect(d).toEqual(before);expect(at(d,5).provenance.person_visible).toEqual({origin:'model_track',proposal_id:'saved-proposal-5',human_corrected:false});
});
