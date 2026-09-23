import {describe,expect,it} from 'vitest';
import {NEW_BOX_COLORS,isAllowedNewBoxColor} from './colors';
describe('new box color choices',()=>{
 it('accepts each distinct palette color while reserving red, white and black',()=>{
  expect(new Set(NEW_BOX_COLORS).size).toBe(NEW_BOX_COLORS.length);
  for(const color of NEW_BOX_COLORS)expect(isAllowedNewBoxColor(color.toUpperCase())).toBe(true);
  for(const color of ['#ff0000','#ef4444','#ffffff','#000000','red'])expect(isAllowedNewBoxColor(color)).toBe(false);
 });
});
