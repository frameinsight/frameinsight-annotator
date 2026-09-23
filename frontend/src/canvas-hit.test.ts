import {describe,it,expect} from 'vitest';
import {hitCanvasBox} from './canvas-hit';
import type {Box} from './types';
describe('canvas context hit selection',()=>{
 const big={id:'selected',box:[0,0,100,100] as Box},small={id:'other',box:[30,30,60,60] as Box};
 it('prefers the selected visible box inside overlapping fills',()=>expect(hitCanvasBox([big,small],[45,45],2)?.id).toBe('selected'));
 it('lets the edge of a nested box select that box',()=>expect(hitCanvasBox([big,small],[30,45],2)?.id).toBe('other'));
 it('uses source-space edge tolerance and does not select empty canvas',()=>{expect(hitCanvasBox([big],[-2,50],3)?.id).toBe('selected');expect(hitCanvasBox([big],[110,110],3)).toBeUndefined()});
});
