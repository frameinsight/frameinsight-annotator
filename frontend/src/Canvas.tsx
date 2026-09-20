import {forwardRef,useEffect,useImperativeHandle,useLayoutEffect,useRef,useState} from 'react';
import {Stage,Layer,Image as KImage,Rect,Text,Group,Line} from 'react-konva';
import {useStore} from './store';
import {VISIBLE_ONLY,boxStyle,geometryLabel} from './types';
import {type Box,type Geometry,type Proposal,geometries,currentObservation,frameObservations} from './types';
import {type View,toSource,normalized,edgeHit,contains,resizeBox,moveBox,clamp} from './geometry';
export type CanvasHandle={finish:()=>void;cancel:()=>void;fit:()=>void;space:(down:boolean)=>boolean;isReady:()=>boolean};
type Gesture={kind:'draw'|'move'|'resize'|'pan'|'click';start:[number,number];screen:[number,number];box:Box|null;original:Box|null;edge:string;videoId:string;frame:number;activeId:string;geometry:Geometry;moved:boolean;alt:boolean;view:View};

const colors={person_ext:'#67e2b1',person_visible:'#baa7ff'};
const imageCache=new Map<string,HTMLImageElement>();
function fetchImage(key:string,url:string):Promise<HTMLImageElement>{const cached=imageCache.get(key);if(cached)return Promise.resolve(cached);return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{imageCache.set(key,img);while(imageCache.size>15)imageCache.delete(imageCache.keys().next().value!);resolve(img)};img.onerror=()=>reject(new Error('Exact frame unavailable'));img.src=url;});}
export const EditorCanvas=forwardRef<CanvasHandle,{proposals:Proposal[];showGhosts:boolean;showProposals:boolean;showBoth:boolean;dimOutside:boolean;selectedProposal:Proposal|null;onSelectProposal:(p:Proposal)=>void}>(({proposals,showGhosts,showProposals,showBoth,dimOutside,selectedProposal,onSelectProposal},ref)=>{
 const {project,videoId,frame,activeId,geometry,hiddenIds}=useStore();const video=project?.videos[videoId];
 const host=useRef<HTMLDivElement>(null),gesture=useRef<Gesture|null>(null),spaceDown=useRef(false),panned=useRef(false),cycle=useRef(0);
 const [size,setSize]=useState({w:800,h:600}),[view,setView]=useState<View>({x:0,y:0,scale:1}),[image,setImage]=useState<{key:string;image:HTMLImageElement}|null>(null),[error,setError]=useState(''),[preview,setPreview]=useState<Box|null>(null),[cursor,setCursor]=useState('crosshair');
 const displayedGeometries=showBoth?geometries:[geometry];
 const requestedKey=videoId+':'+frame;const displayedImage=imageCache.get(requestedKey)||(image?.key===requestedKey?image.image:undefined);const ready=!!displayedImage&&!!video;
 useLayoutEffect(()=>{const ro=new ResizeObserver(entries=>{const r=entries[0].contentRect;setSize({w:r.width,h:r.height})});if(host.current)ro.observe(host.current);return()=>ro.disconnect()},[]);
 const autoFit=useRef(true),fittedVideo=useRef('');
 const fit=()=>{autoFit.current=true;fitView()};
 const fitView=()=>{if(!video?.width)return;const scale=Math.min((size.w-48)/video.width,(size.h-48)/video.height);setView({scale,x:(size.w-video.width*scale)/2,y:(size.h-video.height*scale)/2})};
 useLayoutEffect(()=>{
  if(fittedVideo.current!==videoId){fittedVideo.current=videoId;autoFit.current=true;}
  if(autoFit.current&&!gesture.current)fitView();
 },[videoId,video?.width,size.w,size.h]);
 useEffect(()=>{let cancelled=false;setError('');if(!videoId||!video?.frame_count)return;const key=requestedKey;
 fetchImage(key,`/api/videos/${videoId}/frames/${frame}`).then(img=>{if(!cancelled)setImage({key,image:img});for(const delta of [1,-1,2,-2,3]){const f=frame+delta;if(f>=0&&f<video.frame_count)void fetchImage(videoId+':'+f,`/api/videos/${videoId}/frames/${f}`).catch(()=>{});}}).catch(e=>{if(!cancelled)setError(String(e))});return()=>{cancelled=true};},[requestedKey,video?.frame_count]);
 const observations=frameObservations(project,videoId,frame).filter(o=>!hiddenIds[o.identity_uuid]);
 const active=currentObservation(project,videoId,frame,activeId);
 const ghost=showGhosts&&!hiddenIds[activeId]?currentObservation(project,videoId,frame-1,activeId):null;
 const boxEntries=observations.flatMap(o=>displayedGeometries.flatMap(g=>o[g]?[{o,g,box:o[g]!}]:[])).sort((a,b)=>Number(b.o.identity_uuid===activeId&&b.g===geometry)-Number(a.o.identity_uuid===activeId&&a.g===geometry));
 // Display-only mask. Follow live gesture coordinates without editing the domain.
 const focusBoxes:Box[]=dimOutside&&activeId&&!hiddenIds[activeId]?displayedGeometries.flatMap(g=>{
  const editing=preview&&gesture.current?.activeId===activeId&&gesture.current.videoId===videoId&&gesture.current.frame===frame;
  const linked=active?.geometry_link==='equal'&&gesture.current?.geometry==='person_ext';
  const box=editing&&(gesture.current?.geometry===g||linked)?preview:active?.[g];
  return box?[box]:[];
 }):[];
 const point=(e:{clientX:number;clientY:number}):[number,number]=>{const r=host.current!.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top]};
 function finish(){
  const g=gesture.current;if(!g)return;gesture.current=null;setPreview(null);
  const s=useStore.getState();
  if(g.kind==='pan')return;
  if(g.moved&&g.box&&g.box[2]>g.box[0]&&g.box[3]>g.box[1]){
   s.setBox(g.geometry,g.box,undefined,g);return;
  }
  if(g.moved)return;
  const candidates=showProposals?proposals.filter(p=>contains(p.box,g.start)):[];
  if(g.alt&&candidates.length){cycle.current=(cycle.current+1)%candidates.length;s.toast(`Proposal ${cycle.current+1} / ${candidates.length} · ${candidates[cycle.current].geometry} · ${Math.round(candidates[cycle.current].confidence*100)}%. Click to preview track.`);return;}
  const hit=boxEntries.find(b=>b.g===geometry&&edgeHit(b.box,g.start,7/view.scale));
  if(hit){useStore.setState({activeId:hit.o.identity_uuid,geometry:hit.g});return;}
  if(candidates.length){onSelectProposal(candidates[cycle.current%candidates.length]);cycle.current=0;return;}
 }
 useImperativeHandle(ref,()=>({finish,cancel:()=>{gesture.current=null;setPreview(null)},fit,space:(down)=>{spaceDown.current=down;if(down){panned.current=false;setCursor('grab');return false;}setCursor('crosshair');return panned.current;},isReady:()=>ready}));
 function down(e:React.PointerEvent){
  if(e.button!==0||!ready||!video)return;e.currentTarget.setPointerCapture(e.pointerId);host.current?.focus();
  autoFit.current=false;
  const screen=point(e),p=toSource(...screen,view);let kind:Gesture['kind']='click',box:Box|null=null,edge='',who=activeId,g=geometry;
  if(spaceDown.current){kind='pan';setCursor('grabbing');}
  else if(activeId&&(!active?.[geometry]||e.altKey)){kind='draw';}
  else{const hit=boxEntries.find(b=>b.g===geometry&&edgeHit(b.box,p,7/view.scale));
   if(hit){kind='resize';box=hit.box;edge=edgeHit(box,p,7/view.scale);who=hit.o.identity_uuid;g=hit.g;useStore.setState({activeId:who,geometry:g});}
   else if(active?.[geometry]&&contains(active[geometry],p)){kind='move';box=active[geometry];}
  }
  gesture.current={kind,start:p,screen,box,original:box,edge,videoId,frame,activeId:who,geometry:g,moved:false,alt:e.altKey,view};
 }
 function move(e:React.PointerEvent){
  if(!ready||!video)return;const screen=point(e),g=gesture.current,p=toSource(...screen,g?.view||view);
  if(!g){if(spaceDown.current){setCursor('grab');return;}if(activeId&&!active?.[geometry]){setCursor('crosshair');return;}const hit=boxEntries.find(b=>b.g===geometry&&edgeHit(b.box,p,7/view.scale));if(hit){const edge=edgeHit(hit.box,p,7/view.scale);setCursor(edge.length===2?(edge==='nw'||edge==='se'?'nwse-resize':'nesw-resize'):(edge==='n'||edge==='s'?'ns-resize':'ew-resize'));}else setCursor(active?.[geometry]&&contains(active[geometry],p)?'move':'crosshair');return;}
  if(Math.hypot(screen[0]-g.screen[0],screen[1]-g.screen[1])>3)g.moved=true;
  if(!g.moved)return;
  if(g.kind==='pan'){panned.current=true;setView({...g.view,x:g.view.x+screen[0]-g.screen[0],y:g.view.y+screen[1]-g.screen[1]});return;}
  if(g.kind==='draw')g.box=normalized(g.start,p,video.width,video.height);
  else if(g.kind==='resize')g.box=resizeBox(g.original!,p,g.edge,video.width,video.height);
  else if(g.kind==='move')g.box=moveBox(g.original!,p[0]-g.start[0],p[1]-g.start[1],video.width,video.height);
  setPreview(g.box);
 }
 function wheel(e:React.WheelEvent){e.preventDefault();if(gesture.current)return;autoFit.current=false;const screen=point(e),p=toSource(...screen,view),scale=clamp(view.scale*Math.exp(-e.deltaY*.0015),.04,20);setView({scale,x:screen[0]-p[0]*scale,y:screen[1]-p[1]*scale});}
 const drawBox=(box:Box,g:Geometry,key:string,label:string,selected=false,opacity=1,dashed=false,color=colors[g])=>{
  const [x1,y1,x2,y2]=box;return <Group key={key} opacity={opacity}><Rect x={x1} y={y1} width={x2-x1} height={y2-y1} stroke={color} strokeWidth={(selected?2:1.3)/view.scale} dash={(!VISIBLE_ONLY&&g==='person_visible')||dashed?[6/view.scale,4/view.scale]:undefined}/>{label&&<><Rect x={x1} y={y1-19/view.scale} width={Math.max(34,label.length*6.1+10)/view.scale} height={18/view.scale} fill={selected?color:'#151d24'}/><Text x={x1+4/view.scale} y={y1-16/view.scale} text={label} fontFamily="monospace" fontSize={11/view.scale} fill={selected?(parseInt(color.slice(1,3),16)*.299+parseInt(color.slice(3,5),16)*.587+parseInt(color.slice(5,7),16)*.114>145?'#10161b':'#ffffff'):color}/></>}{selected&&[[x1,y1],[x2,y1],[x1,y2],[x2,y2],[(x1+x2)/2,y1],[(x1+x2)/2,y2],[x1,(y1+y2)/2],[x2,(y1+y2)/2]].map(([x,y],i)=><Rect key={i} x={x-3/view.scale} y={y-3/view.scale} width={6/view.scale} height={6/view.scale} fill="#10161b" stroke={color} strokeWidth={1/view.scale}/>)}</Group>;
 };
 return <div className="canvas-host" ref={host} tabIndex={0} role="application" aria-label="Video annotation canvas" data-testid="canvas" data-frame={ready?frame:'loading'} data-scale={view.scale} data-offset-x={view.x} data-offset-y={view.y} onPointerDown={down} onPointerMove={move} onPointerUp={finish} onPointerCancel={()=>{gesture.current=null;setPreview(null)}} onWheel={wheel} style={{cursor}}>
  {ready?<Stage width={size.w} height={size.h} listening={false}><Layer listening={false}><Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}><KImage image={displayedImage} width={video.width} height={video.height}/></Group></Layer>{focusBoxes.length>0&&<Layer listening={false}><Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
   <Rect width={video.width} height={video.height} fill="black" opacity={.38}/>
   {focusBoxes.map(([x1,y1,x2,y2],i)=><Rect key={i} x={x1} y={y1} width={x2-x1} height={y2-y1} fill="black" globalCompositeOperation="destination-out"/>)}
  </Group></Layer>}<Layer listening={false}><Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
   {ghost&&displayedGeometries.map(g=>ghost[g]&&drawBox(ghost[g]!,g,'ghost'+g,'',false,.22,true,boxStyle(project?.state.identities[ghost.identity_uuid],g).color))}
   {showProposals&&proposals.map((p,i)=><Group key={p.id} opacity={selectedProposal?.id===p.id||selectedProposal?.track_id&&selectedProposal.track_id===p.track_id?1:.65}><Rect x={p.box[0]} y={p.box[1]} width={p.box[2]-p.box[0]} height={p.box[3]-p.box[1]} stroke="#f2bd6b" strokeWidth={(selectedProposal?.id===p.id?2.5:1.2)/view.scale} dash={[4/view.scale,4/view.scale]}/><Text text={`AI ${p.track_id?.split(':').at(-1)||"?"} · ${Math.round(p.confidence*100)}%`} x={p.box[0]} y={p.box[1]+3/view.scale} fontSize={10/view.scale} fill="#ffcf87"/></Group>)}
   {boxEntries.slice().reverse().map(({o,g,box})=>{const selected=o.identity_uuid===activeId&&g===geometry;const editing=gesture.current?.activeId===o.identity_uuid&&gesture.current.geometry===g;const linkedPreview=preview&&o.geometry_link==='equal'&&gesture.current?.geometry==='person_ext'&&gesture.current.activeId===o.identity_uuid;const b=editing&&preview?preview:linkedPreview?preview:box;const person=project!.state.identities[o.identity_uuid];return drawBox(b,g,o.id+g,`${boxStyle(person,g).class_name} · ${person?.person_id??person?.name??'Draft'}${!VISIBLE_ONLY&&o.review_state==='approved'?' ✓':''}`,selected,g===geometry?1:.45,false,boxStyle(person,g).color);})}
   {preview&&gesture.current?.kind==='draw'&&!active?.[gesture.current.geometry]&&drawBox(preview,gesture.current.geometry,'drawing',geometryLabel(gesture.current.geometry),true,1,false,boxStyle(project?.state.identities[activeId],geometry).color)}
  </Group></Layer></Stage>:<div className="canvas-loading">{error|| (video?'Loading exact source frame…':'Import a video to begin')}</div>}
  {ready&&<div className="canvas-corner">{video.width} × {video.height}<span>{Math.round(view.scale*100)}%</span><span>Source pixels</span></div>}
  {ready&&!activeId&&<div className="canvas-hint">Press <kbd>N</kbd> to start a person · Drag to draw</div>}
 </div>;
});
