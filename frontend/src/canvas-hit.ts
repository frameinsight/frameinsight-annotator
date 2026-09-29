import {contains,edgeHit} from './geometry';
import type {Box} from './types';

/** Entries are in visual order, selected box first. Nearby edges win over fills. */
export function hitCanvasBox<T extends {box:Box}>(entries:T[],point:[number,number],tolerance:number,preferred?:(entry:T)=>boolean):T|undefined {
 const edges=entries.filter(entry=>!!edgeHit(entry.box,point,tolerance));
 const fills=entries.filter(entry=>contains(entry.box,point));
 return (preferred&&edges.find(preferred))||edges[0]||(preferred&&fills.find(preferred))||fills[0];
}
