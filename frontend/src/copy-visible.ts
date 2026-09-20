import {boxStyle,legacyExtended,uuid,type Domain} from './types';
import {prepareGeometryFrame} from './hidden-range';

export const COPY_COLORS={person_visible:'#22d3ee',person_ext:'#fb923c'} as const;

// One commit copies the selected person in this video; boxes, styles and gaps share Undo.
export function copyVisibleToExtended(d:Domain,videoId:string,identityId:string){
 const person=d.identities[identityId];
 if(!person)throw new Error('Select a person first.');
 if(legacyExtended(person))throw new Error('Assign this older track to the correct box type using I first.');
 const observations=Object.values(d.observations).filter(o=>o.video_id===videoId&&o.identity_uuid===identityId);
 const rows=observations.filter(o=>o.person_visible&&!o.person_ext);
 if(!rows.length)return 0;
 const firstExtended=!Object.values(d.observations).some(o=>o.identity_uuid===identityId&&o.person_ext);
 const visible=boxStyle(person,'person_visible'),extended=boxStyle(person,'person_ext');
 person.box_styles??={};
 // Start new pairs with contrasting colors; retain subsequent I-dialog choices.
 person.box_styles.person_visible={...visible,color:firstExtended?COPY_COLORS.person_visible:visible.color};
 person.box_styles.person_ext={...extended,color:firstExtended?COPY_COLORS.person_ext:extended.color};
 if(firstExtended)person.color=COPY_COLORS.person_visible;
 for(const row of rows){
  prepareGeometryFrame(d,videoId,identityId,row.frame_index,'person_ext');
  row.person_ext=[...row.person_visible!];
  row.geometry_link='independent';row.full_quality='estimated';row.review_state='draft';
  row.provenance.person_ext={origin:'copied_track',proposal_id:null,human_corrected:false};
 }
 // Keep holes in the source track empty when the copied boxes are later resized.
 // Existing Extended boxes remain occupied, even where Visible is absent.
 const occupied=observations.filter(o=>o.person_visible||o.person_ext).map(o=>o.frame_index).sort((a,b)=>a-b);
 for(let i=1;i<occupied.length;i++){
  const start=occupied[i-1]+1,end=occupied[i]-1;if(start>end)continue;
  if(Object.values(d.intervals).some(g=>g.video_id===videoId&&g.identity_uuid===identityId&&(!g.geometry||g.geometry==='person_ext')&&g.start<=start&&(g.end===null||g.end>=end)))continue;
  const id=uuid();d.intervals[id]={id,video_id:videoId,identity_uuid:identityId,start,end,geometry:'person_ext',reason:'unknown',evidence_note:'No source Visible box during whole-track copying; retained as an empty interval.'};
 }
 return rows.length;
}
