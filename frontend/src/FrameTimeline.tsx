import {Button} from './components/ui/button';
import {ChevronLeft,ChevronRight,Diamond} from 'lucide-react';
import {type timelineBins} from './timeline';
import {Slider} from './components/ui/slider';
import type {ReactNode} from 'react';

type Bin=ReturnType<typeof timelineBins>[number];
export function FrameTimeline({bins,active,label,color,frame,count,onSeek,controls,keyframes=[]}:{bins:Bin[];active:boolean;label:string;color:string;frame:number;count:number;onSeek:(frame:number)=>void;controls?:ReactNode;keyframes?:number[]}){
  const previous=keyframes.filter(f=>f<frame).at(-1),next=keyframes.find(f=>f>frame);
  const state=(bin:Bin)=>!active?'No track selected':!bin.present?'Hidden':bin.present<bin.end-bin.start?'Present and Hidden in this range':'Present';
  return <section className="timeline presence-timeline" aria-label="Annotation timeline">
    <div className="timeline-title" data-testid="timeline-header">
      <div className="timeline-leading" data-testid="timeline-leading"><strong title={label}>{label}</strong><div className="legend"><span><i style={{background:color}}/>Present</span><span><i className="hidden-color"/>Hidden</span></div></div>
      {controls}
      <div className="review-progress flex items-center gap-2"><div className="flex items-center gap-1 text-xs" aria-label="Keyframe navigation"><Button variant="ghost" size="icon-xs" aria-label="Previous keyframe" title="Previous anchor box ([)" disabled={previous===undefined} onClick={()=>previous!==undefined&&onSeek(previous)}><ChevronLeft/></Button><span title="Anchor boxes guide interpolation. Copies from a single frame and imported boxes may also be anchors."><Diamond className="inline size-3 mr-1"/>{keyframes.includes(frame)?'Keyframe':'Keyframes'} · {keyframes.length}</span><Button variant="ghost" size="icon-xs" aria-label="Next keyframe" title="Next anchor box (])" disabled={next===undefined} onClick={()=>next!==undefined&&onSeek(next)}><ChevronRight/></Button></div><span data-testid="timeline-trailing">{count.toLocaleString()} frames</span></div>
    </div>
    <div className="timeline-track" role="group" aria-label="Frame ranges">{bins.map((bin,index)=>{
      const present=active&&bin.present>0,hidden=active&&bin.present<bin.end-bin.start;
      const current=frame>=bin.start&&frame<bin.end;
      return <button key={index} aria-label={`Frames ${bin.start}–${bin.end-1}: ${state(bin)}`} title={`Frames ${bin.start}–${bin.end-1}: ${state(bin)}${active&&bin.gap?' · Restore range to fill deleted frames again':''}`} aria-current={current?'step':undefined} className={(hidden?'gap ':present?'present ':'empty ')+(current?'current':'')} style={{background:present&&hidden?`repeating-linear-gradient(135deg,${color} 0 5px,#ef4444 5px 10px)`:hidden?'#ef4444':present?color:'#303030'}} onClick={()=>onSeek(bin.start)}>{active&&bin.manual&&<span aria-label="Contains keyframe" style={{display:'block',color:'#111',fontSize:12,lineHeight:1}}>◆</span>}</button>;
    })}</div>
    <div className="timeline-scale"><span>0</span><span>{Math.floor(Math.max(0,count-1)/4)}</span><span>{Math.floor(Math.max(0,count-1)/2)}</span><span>{Math.floor(Math.max(0,count-1)*3/4)}</span><span>{Math.max(0,count-1)}</span></div>
    <Slider className="mt-2" aria-label="Seek annotation frame" min={0} max={Math.max(1,count-1)} step={1} value={[frame]} disabled={count<2} onValueChange={values=>onSeek(values[0])}/>
  </section>;
}
