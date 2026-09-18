import {describe,it,expect} from 'vitest';
import {toScreen,toSource,normalized,resizeBox,moveBox,edgeHit} from './geometry';
import {observationIssues,emptyObservation} from './types';
describe('source geometry',()=>{
 it('round trips zoom, pan and non-integer scales',()=>{for(const scale of [.15,.731,2,11]){const v={scale,x:71.3,y:-91.7};const p=toSource(...toScreen(301.45,129.7,v),v);expect(p[0]).toBeCloseTo(301.45,8);expect(p[1]).toBeCloseTo(129.7,8)}});
 it('clamps boundaries while allowing tiny boxes',()=>{expect(normalized([-5,-5],[.2,.3],640,480)).toEqual([0,0,.2,.3]);expect(resizeBox([10,20,30,40],[100,100],'nw',640,480)).toEqual([29.99,39.99,30,40]);expect(moveBox([10,20,30,40],-100,900,640,480)).toEqual([0,460,20,480])});
 it('edges remain hittable at screen-space tolerance',()=>{expect(edgeHit([10,10,20,20],[9,15],2)).toBe('w')});
 it('requires a visible box without inventing a full extent',()=>{const o=emptyObservation('v',0,'i','s');expect(observationIssues(o)).toContain('Draw a box');o.person_visible=[0,0,12,10];expect(observationIssues(o)).toEqual([]);expect(o.person_ext).toBeNull();expect(o.occluded).toBeNull()});
});
