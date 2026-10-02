import {it,expect} from 'vitest';
import {normalizeSections} from './trim-sections';
it('keeps disjoint sections in source order, merging overlaps without changing input',()=>{const a=[{start:300,end:500},{start:0,end:100},{start:20,end:50}];expect(normalizeSections(a,600)).toEqual([{start:0,end:100},{start:300,end:500}]);expect(a[0].start).toBe(300);});
it('accepts one-frame selections and rejects invalid boundaries',()=>{expect(normalizeSections([{start:5,end:5}],6)).toEqual([{start:5,end:5}]);for(const r of [[],[{start:0,end:6}],[{start:3,end:2}],[{start:1.5,end:2}]])expect(()=>normalizeSections(r,6)).toThrow();});
