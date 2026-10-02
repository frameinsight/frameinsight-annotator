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
