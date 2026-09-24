import {describe,expect,it} from 'vitest';
import {NEW_BOX_COLORS,isAllowedNewBoxColor,trackColor,unusedBoxColor} from './colors';
describe('new box color choices',()=>{
 it('accepts each distinct palette color while reserving red, white and black',()=>{
  expect(new Set(NEW_BOX_COLORS).size).toBe(NEW_BOX_COLORS.length);
  for(const color of NEW_BOX_COLORS)expect(isAllowedNewBoxColor(color.toUpperCase())).toBe(true);
  for(const color of ['#ff0000','#ef4444','#ffffff','#000000','red'])expect(isAllowedNewBoxColor(color)).toBe(false);
 });
});

it('track colors are stable and distinguish neighboring IDs without changing saved class colors',()=>{
 expect(trackColor(7,'a')).toBe(trackColor(7,'a'));
 expect(trackColor(7,'a')).not.toBe(trackColor(8,'b'));
 expect(trackColor(null,'draft-id')).toBe(trackColor(null,'draft-id'));
 expect(trackColor(1,'a')).not.toBe(trackColor(13,'b'));
});

it('suggests unused colors even when the palette is exhausted',()=>{
 const used=[...NEW_BOX_COLORS];
 expect(used).not.toContain(unusedBoxColor(used,()=>0));
 const extra=unusedBoxColor(used,()=>0);
 expect(unusedBoxColor([...used,extra],()=>0)).not.toBe(extra);
 expect(unusedBoxColor([NEW_BOX_COLORS[0].toUpperCase()],()=>0)).toBe(NEW_BOX_COLORS[1]);
});
