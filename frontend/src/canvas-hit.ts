import {contains,edgeHit} from './geometry';
import type {Box} from './types';

/** Entries are in visual order, selected box first. Nearby edges win over fills. */
export function hitCanvasBox<T extends {box:Box}>(entries:T[],point:[number,number],tolerance:number):T|undefined {
 return entries.find(entry=>!!edgeHit(entry.box,point,tolerance))||entries.find(entry=>contains(entry.box,point));
}
