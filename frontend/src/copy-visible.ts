import {boxStyle,legacyExtended,type Domain} from './types';
import {prepareGeometryFrame} from './hidden-range';

export const COPY_COLORS={person_visible:'#22d3ee',person_ext:'#fb923c'} as const;

// Runs inside one store commit so the box, styles and restored gap share Undo.
export function copyVisibleToExtended(d:Domain,videoId:string,identityId:string,frame:number){
 const person=d.identities[identityId];
 if(!person)throw new Error('Select a person first.');
 if(legacyExtended(person))throw new Error('Assign this older track to the correct box type using I first.');
 const row=Object.values(d.observations).find(o=>o.video_id===videoId&&o.identity_uuid===identityId&&o.frame_index===frame);
 if(!row?.person_visible)throw new Error('Draw a Visible box on this frame first.');
 if(row.person_ext)throw new Error('An Extended box already exists here. Select Extended to resize it.');
 const firstExtended=!Object.values(d.observations).some(o=>o.identity_uuid===identityId&&o.person_ext);
 const visible=boxStyle(person,'person_visible'),extended=boxStyle(person,'person_ext');
 person.box_styles??={};
 // Start new pairs with contrasting colors; retain subsequent I-dialog choices.
 person.box_styles.person_visible={...visible,color:firstExtended?COPY_COLORS.person_visible:visible.color};
 person.box_styles.person_ext={...extended,color:firstExtended?COPY_COLORS.person_ext:extended.color};
 if(firstExtended)person.color=COPY_COLORS.person_visible;
 prepareGeometryFrame(d,videoId,identityId,frame,'person_ext');
 row.person_ext=[...row.person_visible];
 row.geometry_link='independent';row.full_quality='estimated';row.review_state='draft';
 row.provenance.person_ext={origin:'copied',proposal_id:null,human_corrected:false};
 // No interpolation here: copying creates just this frame's Extended keyframe.
}
