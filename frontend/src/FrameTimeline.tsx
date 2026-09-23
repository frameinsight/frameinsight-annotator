import {type timelineBins} from './timeline';

type Bin=ReturnType<typeof timelineBins>[number];
export function FrameTimeline({bins,active,label,color,frame,count,onSeek}:{bins:Bin[];active:boolean;label:string;color:string;frame:number;count:number;onSeek:(frame:number)=>void}){
  const state=(bin:Bin)=>!active?'No track selected':!bin.present?'Hidden':bin.present<bin.end-bin.start?'Present and Hidden in this range':'Present';
  return <section className="timeline presence-timeline" aria-label="Annotation timeline">
    <div className="timeline-title"><strong title={label}>{label}</strong><div className="legend"><span><i style={{background:color}}/>Present</span><span><i className="hidden-color"/>Hidden</span></div><span className="review-progress">{count.toLocaleString()} frames</span></div>
    <div className="timeline-track" role="group" aria-label="Frame ranges">{bins.map((bin,index)=>{
      const present=active&&bin.present>0,hidden=active&&bin.present<bin.end-bin.start;
      const current=frame>=bin.start&&frame<bin.end;
      return <button key={index} aria-label={`Frames ${bin.start}–${bin.end-1}: ${state(bin)}`} title={`Frames ${bin.start}–${bin.end-1}: ${state(bin)}${active&&bin.gap?' · Restore range to fill deleted frames again':''}`} aria-current={current?'step':undefined} className={(hidden?'gap ':present?'present ':'empty ')+(current?'current':'')} style={{background:present&&hidden?`repeating-linear-gradient(135deg,${color} 0 5px,#ef4444 5px 10px)`:hidden?'#ef4444':present?color:'#303030'}} onClick={()=>onSeek(bin.start)}/>;
    })}</div>
    <div className="timeline-scale"><span>0</span><span>{Math.floor(Math.max(0,count-1)/4)}</span><span>{Math.floor(Math.max(0,count-1)/2)}</span><span>{Math.floor(Math.max(0,count-1)*3/4)}</span><span>{Math.max(0,count-1)}</span></div>
    <input className="timeline-seek" aria-label="Seek annotation frame" type="range" min={0} max={Math.max(0,count-1)} step={1} value={frame} disabled={!count} onChange={event=>onSeek(Number(event.target.value))}/>
  </section>;
}
