import {boxStyle,classColor,type Project,type Identity,type Geometry} from './types';
import {trackColor} from './colors';
export type ColorMode='class'|'track';
/** View preferences never rewrite saved class styles, identities or annotations. */
export function annotationColor(project:Project|null,person:Identity|undefined,geometry:Geometry,mode:ColorMode){
 if(mode==='track'&&person)return person.color||trackColor(person.person_id,person.id);
 return classColor(project,boxStyle(person,geometry).class_name);
}
