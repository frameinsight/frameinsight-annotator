import {it,expect} from 'vitest';
import {normalizeSections} from './trim-sections';
it('keeps disjoint sections in source order, merging overlaps without changing input',()=>{const a=[{start:300,end:500},{start:0,end:100},{start:20,end:50}];expect(normalizeSections(a,600)).toEqual([{start:0,end:100},{start:300,end:500}]);expect(a[0].start).toBe(300);});
it('accepts one-frame selections and rejects invalid boundaries',()=>{expect(normalizeSections([{start:5,end:5}],6)).toEqual([{start:5,end:5}]);for(const r of [[],[{start:0,end:6}],[{start:3,end:2}],[{start:1.5,end:2}]])expect(()=>normalizeSections(r,6)).toThrow();});

import {cutSections,frameAtTime,fromKeptSections} from './trim-sections';
it('cuts before the current frame, preserving every frame exactly once',()=>{
 const source=[{start:0,end:23,removed:false}];const first=cutSections(source,6),second=cutSections(first,15);
 expect(second).toEqual([{start:0,end:5,removed:false},{start:6,end:14,removed:false},{start:15,end:23,removed:false}]);
 expect(cutSections(second,15)).toBe(second);expect(cutSections(second,0)).toBe(second);
 expect(cutSections(source,23)).toEqual([{start:0,end:22,removed:false},{start:23,end:23,removed:false}]);
 expect(source).toEqual([{start:0,end:23,removed:false}]);
});
it('preserves removed status when splitting and migrates old kept ranges with their gaps',()=>{
 const rows=fromKeptSections([{start:3,end:5},{start:15,end:20}],24);
 expect(rows).toEqual([{start:0,end:2,removed:true},{start:3,end:5,removed:false},{start:6,end:14,removed:true},{start:15,end:20,removed:false},{start:21,end:23,removed:true}]);
 expect(cutSections(rows,9).slice(2,4)).toEqual([{start:6,end:8,removed:true},{start:9,end:14,removed:true}]);
});
it('maps playback time to the displayed source frame with variable frame durations',()=>{
 const times=[0,.04,.12,.20,.24];
 expect([-.1,0,.039,.04,.119,.12,.239,.24,1].map(t=>frameAtTime(times,t))).toEqual([0,0,0,1,1,2,3,4,4]);
});

import {keptSections} from './trim-sections';
it('combines adjacent kept cuts and never reconnects a removed section',()=>{
 const rows=Array.from({length:200},(_,n)=>({start:n,end:n,removed:false}));
 expect(keptSections(rows)).toEqual([{start:0,end:199}]);
 rows[80].removed=true;expect(keptSections(rows)).toEqual([{start:0,end:79},{start:81,end:199}]);
});
