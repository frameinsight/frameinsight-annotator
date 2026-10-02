export type TrimSection={start:number;end:number};
export function normalizeSections(sections:TrimSection[],count:number){
 if(!sections.length||sections.length>100)throw new Error('Keep between 1 and 100 sections.');
 const out:TrimSection[]=[];
 for(const r of [...sections].sort((a,b)=>a.start-b.start)){
  if(!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start<0||r.end<r.start||r.end>=count)throw new Error('Choose valid source-frame boundaries.');
  if(out.length&&r.start<=out.at(-1)!.end+1)out.at(-1)!.end=Math.max(out.at(-1)!.end,r.end);else out.push({...r});
 }
 return out;
}

export type CutSection=TrimSection&{removed:boolean};
export function keptSections(rows:CutSection[]):TrimSection[]{
 const kept:TrimSection[]=[];
 for(const r of rows){if(r.removed)continue;const last=kept.at(-1);if(last&&last.end+1===r.start)last.end=r.end;else kept.push({start:r.start,end:r.end});}
 return kept;
}
export function cutSections(rows:CutSection[],frame:number):CutSection[]{
 if(!Number.isSafeInteger(frame))return rows;
 const i=rows.findIndex(r=>frame>r.start&&frame<=r.end);
 if(i<0||rows.length>=200)return rows;
 const r=rows[i];
 return [...rows.slice(0,i),{...r,end:frame-1},{...r,start:frame},...rows.slice(i+1)];
}
export function fromKeptSections(kept:TrimSection[],count:number):CutSection[]{
 const rows:CutSection[]=[];let start=0;
 for(const r of normalizeSections(kept,count)){
  if(start<r.start)rows.push({start,end:r.start-1,removed:true});
  rows.push({...r,removed:false});start=r.end+1;
 }
 if(start<count)rows.push({start,end:count-1,removed:true});
 return rows;
}
export function frameAtTime(timestamps:number[],time:number){
 let low=0,high=timestamps.length;
 while(low<high){const mid=(low+high)>>>1;if(timestamps[mid]<=time+1e-7)low=mid+1;else high=mid;}
 return Math.max(0,low-1);
}
