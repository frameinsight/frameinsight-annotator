import {describe,expect,it} from 'vitest';
import {trackClassCatalog} from './track-class-catalog';
import {boxStyle,emptyObservation,orderedGeometryKeys,type Project} from './types';

function fixture():Project {
 return {id:'project',name:'Fixture',revision:0,videos:{},classes:['Helmet','Visible','Full'],state:{identities:{
  one:{id:'one',person_id:1,name:'Track 1',class_name:'Visible',box_styles:{person_ext:{class_name:'Full',color:'#00aaaa'}}},
  two:{id:'two',person_id:2,name:'Track 2',class_name:'Legacy'},
  three:{id:'three',person_id:3,name:'Track 3'},
 },segments:{},observations:{},intervals:{},links:{},reviews:{},proposal_reviews:{}}};
}
describe('track class catalog',()=>{
 it('matches per-track ordering, video filtering, legacy slots, provenance and hidden classes',()=>{
  const project=fixture(),first=emptyObservation('video-a',0,'one','segment');
  first.person_visible=[0,0,10,10];first.boxes={'class:Helmet':[0,0,10,5]};
  first.provenance['class:Provenance only']={origin:'manual',proposal_id:null,human_corrected:false};
  const other=emptyObservation('video-b',0,'one','segment');other.boxes={'class:Other video':[0,0,10,10]};
  project.state.observations={first,other};
  project.state.intervals.gap={id:'gap',video_id:'video-a',identity_uuid:'three',start:0,end:4,geometry:'class:Hidden',reason:'occlusion',evidence_note:''};
  for(const videoId of [undefined,'video-a','video-b']){
   const expected=Object.fromEntries(Object.values(project.state.identities).map(identity=>[identity.id,orderedGeometryKeys(project,identity.id,videoId).map(geometry=>({geometry,...boxStyle(identity,geometry)}))]));
   expect(trackClassCatalog(project,videoId)).toEqual(expected);
  }
  expect(trackClassCatalog(project,'video-a').one.map(item=>item.class_name)).toEqual(['Helmet','Visible','Full','Provenance only']);
 });
 it('reads a 40,600-observation recording once, independent of its 20 tracks',()=>{
  const project=fixture();project.state.identities={};
  for(let track=0;track<20;track++){
   const id='track-'+track;project.state.identities[id]={id,person_id:track+1,name:id};
   for(let frame=0;frame<2030;frame++){
    const observation=emptyObservation('video',frame,id,'segment');observation.boxes={'class:Person':[1,2,10,20]};
    project.state.observations[observation.id]=observation;
   }
  }
  let visits=0;
  project.state.observations=new Proxy(project.state.observations,{get(target,key,receiver){if(typeof key==='string'&&Object.hasOwn(target,key))visits++;return Reflect.get(target,key,receiver);}});
  const result=trackClassCatalog(project,'video');
  expect(visits).toBe(40600);
  expect(Object.keys(result)).toHaveLength(20);
  for(const classes of Object.values(result))expect(classes.map(item=>item.geometry)).toEqual(['class:Person']);
 });
});
