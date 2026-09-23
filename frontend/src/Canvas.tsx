import {CopyToClassIcon,CopyPreviousBoxIcon,DeleteRangeIcon,RestoreRangeIcon} from './components/AnnotationIcons';
import {CanvasLabels,measureLabelText} from './CanvasLabels';
import {LABEL_HEIGHT,layoutLabels,hitLabel,type CanvasBadge} from './canvas-labels';
import {forwardRef,useEffect,useImperativeHandle,useLayoutEffect,useRef,useState} from 'react';
import {Stage,Layer,Image as KImage,Rect,Text,Group} from 'react-konva';
import {ContextMenu} from 'radix-ui';
import {MousePointer2,SquareDashed,Hand,Plus,Maximize,Undo2,Redo2,EyeOff,Focus,Trash2,Tags} from 'lucide-react';
import {hitCanvasBox} from './canvas-hit';
import {hasOpenOverlay} from './shortcut-guards';
import './canvas-controls.css';
import {useStore} from './store';
import {VISIBLE_ONLY,boxStyle,geometryLabel,getBox,boxKeys} from './types';
import {type Box,type Geometry,type Proposal,geometries,currentObservation,frameObservations} from './types';
import {type View,toSource,normalized,edgeHit,contains,resizeBox,moveBox,clamp} from './geometry';
export type CanvasTool='select'|'draw'|'hand';
export type CanvasControlsState={tool:CanvasTool;scale:number;ready:boolean};
export type CanvasHandle={tool:(tool:CanvasTool)=>void;finish:()=>void;cancel:()=>void;fit:()=>void;zoom:(factor:number)=>void;space:(down:boolean)=>boolean;isReady:()=>boolean};
type Gesture={kind:'draw'|'move'|'resize'|'pan'|'click';start:[number,number];screen:[number,number];box:Box|null;original:Box|null;edge:string;videoId:string;frame:number;activeId:string;geometry:Geometry;moved:boolean;alt:boolean;view:View};

function resizeHandles([x1,y1,x2,y2]:Box){return [
 {x:x1,y:y1,edge:'nw'},{x:x2,y:y1,edge:'ne'},{x:x1,y:y2,edge:'sw'},{x:x2,y:y2,edge:'se'},
 {x:(x1+x2)/2,y:y1,edge:'n'},{x:(x1+x2)/2,y:y2,edge:'s'},{x:x1,y:(y1+y2)/2,edge:'w'},{x:x2,y:(y1+y2)/2,edge:'e'},
]}
const resizeCursor=(edge:string)=>edge.length===2?(edge==='nw'||edge==='se'?'nwse-resize':'nesw-resize'):(edge==='n'||edge==='s'?'ns-resize':'ew-resize');

const imageCache=new Map<string,HTMLImageElement>();
function fetchImage(key:string,url:string):Promise<HTMLImageElement>{const cached=imageCache.get(key);if(cached)return Promise.resolve(cached);return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{imageCache.set(key,img);while(imageCache.size>15)imageCache.delete(imageCache.keys().next().value!);resolve(img)};img.onerror=()=>reject(new Error('Exact frame unavailable'));img.src=url;});}
export const EditorCanvas=forwardRef<CanvasHandle,{proposals:Proposal[];showProposals:boolean;hiddenClasses:Record<string,boolean>;dimOutside:boolean;onAction?:(action:string)=>void;onControlsChange?:(state:CanvasControlsState)=>void}>(({proposals,showProposals,hiddenClasses,dimOutside,onAction,onControlsChange},ref)=>{
 const {project,videoId,frame,activeId,geometry,hiddenIds}=useStore();const video=project?.videos[videoId];
 const menuDialog=useRef(false),menuOpen=useRef(false);
 const [tool,setTool]=useState<CanvasTool>('select'),[menuTarget,setMenuTarget]=useState<{identity:string;geometry:Geometry}|null>(null);
 const host=useRef<HTMLDivElement>(null),gesture=useRef<Gesture|null>(null),spaceDown=useRef(false),panned=useRef(false),cycle=useRef(0);
 const [size,setSize]=useState({w:800,h:600}),[view,setView]=useState<View>({x:0,y:0,scale:1}),[image,setImage]=useState<{key:string;image:HTMLImageElement}|null>(null),[error,setError]=useState(''),[preview,setPreview]=useState<Box|null>(null),[cursor,setCursor]=useState('crosshair');

 const requestedKey=videoId+':'+frame;const displayedImage=imageCache.get(requestedKey)||(image?.key===requestedKey?image.image:undefined);const ready=!!displayedImage&&!!video;
 const controlsCallback=useRef(onControlsChange);controlsCallback.current=onControlsChange;
 useEffect(()=>{controlsCallback.current?.({tool,scale:view.scale,ready});},[tool,view.scale,ready]);
 useLayoutEffect(()=>{const ro=new ResizeObserver(entries=>{const r=entries[0].contentRect;setSize({w:r.width,h:r.height})});if(host.current)ro.observe(host.current);return()=>ro.disconnect()},[]);
 const autoFit=useRef(true),fittedVideo=useRef('');
 const fit=()=>{autoFit.current=true;fitView()};
 const fitView=()=>{if(!video?.width)return;const scale=Math.min(Math.max(1,size.w-48)/video.width,Math.max(1,size.h-48)/video.height);setView({scale,x:(size.w-video.width*scale)/2,y:(size.h-video.height*scale)/2})};
 useLayoutEffect(()=>{
  if(fittedVideo.current!==videoId){fittedVideo.current=videoId;autoFit.current=true;}
  if(autoFit.current&&!gesture.current)fitView();
 },[videoId,video?.width,size.w,size.h]);
 useEffect(()=>{let cancelled=false;setError('');if(!videoId||!video?.frame_count)return;const key=requestedKey;
 fetchImage(key,`/api/videos/${videoId}/frames/${frame}`).then(img=>{if(!cancelled)setImage({key,image:img});for(const delta of [1,-1,2,-2,3]){const f=frame+delta;if(f>=0&&f<video.frame_count)void fetchImage(videoId+':'+f,`/api/videos/${videoId}/frames/${f}`).catch(()=>{});}}).catch(e=>{if(!cancelled)setError(String(e))});return()=>{cancelled=true};},[requestedKey,video?.frame_count]);
 const observations=frameObservations(project,videoId,frame).filter(o=>!hiddenIds[o.identity_uuid]);
 const active=currentObservation(project,videoId,frame,activeId);
 const className=boxStyle(project?.state.identities[activeId],geometry).class_name;
 const classShown=!hiddenClasses[className];
 const displayedGeometries=[...new Set([...boxKeys(active),geometry])].filter(g=>!hiddenClasses[boxStyle(project?.state.identities[activeId],g).class_name]);
 const boxEntries=observations.flatMap(o=>boxKeys(o).filter(g=>!hiddenClasses[boxStyle(project?.state.identities[o.identity_uuid],g).class_name]).map(g=>({o,g,box:getBox(o,g)!}))).sort((a,b)=>Number(b.o.identity_uuid===activeId&&b.g===geometry)-Number(a.o.identity_uuid===activeId&&a.g===geometry));
 const hitBox=(p:[number,number])=>hitCanvasBox(boxEntries,p,7/view.scale);
 const selectHit=(hit:typeof boxEntries[number])=>{useStore.getState().selectPerson(hit.o.identity_uuid);useStore.setState({geometry:hit.g});};
 const selectLabel=(badge:CanvasBadge)=>{useStore.getState().selectPerson(badge.identity);useStore.setState({geometry:badge.geometry});};
 const hitBadge=(screen:[number,number])=>hitLabel(badges.filter(badge=>badge.interactive),screen);
 const hitSelectedHandle=(screen:[number,number])=>{
  if(tool!=='select')return;
  const entry=boxEntries.find(({o,g})=>o.identity_uuid===activeId&&g===geometry);if(!entry)return;
  // Only the eight visible handles get priority over labels, never a whole edge.
  const handle=resizeHandles(entry.box).find(({x,y})=>Math.abs(screen[0]-(x*view.scale+view.x))<=5&&Math.abs(screen[1]-(y*view.scale+view.y))<=5);
  return handle?{...entry,edge:handle.edge}:undefined;
 };
 // Display-only mask. Follow live gesture coordinates without editing the domain.
 const focusBoxes:Box[]=dimOutside&&activeId&&!hiddenIds[activeId]?displayedGeometries.flatMap(g=>{
  const editing=preview&&gesture.current?.activeId===activeId&&gesture.current.videoId===videoId&&gesture.current.frame===frame;
  const linked=active?.geometry_link==='equal'&&gesture.current?.geometry==='person_ext';
  const box=editing&&(gesture.current?.geometry===g||linked)?preview:getBox(active,g);
  return box?[box]:[];
 }):[];
 const point=(e:{clientX:number;clientY:number}):[number,number]=>{const r=host.current!.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top]};
 function finish(){
  const g=gesture.current;if(!g)return;gesture.current=null;setPreview(null);
  const s=useStore.getState();
  if(g.kind==='pan'){setCursor(spaceDown.current||tool==='hand'?'grab':'default');return;}
  if(g.moved&&g.box&&g.box[2]>g.box[0]&&g.box[3]>g.box[1]){
   s.setBox(g.geometry,g.box,undefined,g);return;
  }
  if(g.moved)return;
  if(tool==='hand')return;
  const candidates=showProposals?proposals.filter(p=>contains(p.box,g.start)):[];
  if(g.alt&&candidates.length){cycle.current=(cycle.current+1)%candidates.length;s.toast(`Proposal ${cycle.current+1} / ${candidates.length} · ${candidates[cycle.current].geometry} · ${Math.round(candidates[cycle.current].confidence*100)}%. Click to attach.`);return;}
  const hit=hitBox(g.start);
  if(hit){selectHit(hit);return;}
  if(candidates.length){if(!activeId){s.toast('Press N or select a track before accepting a suggestion');return;}const p=candidates[cycle.current%candidates.length];s.setBox(p.geometry,p.box,p);cycle.current=0;return;}
 }
 function chooseTool(value:CanvasTool){finish();spaceDown.current=false;setTool(value);setCursor(value==='hand'?'grab':value==='draw'?'crosshair':'default');host.current?.focus();}
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||e.repeat||!ready||menuOpen.current||hasOpenOverlay())return;const target=e.target as HTMLElement;if(target.closest('input,textarea,select,[role=combobox],[role=slider],[contenteditable=true]'))return;const next=({v:'select',b:'draw',h:'hand'} as Record<string,CanvasTool>)[e.key.toLowerCase()];if(next){e.preventDefault();chooseTool(next);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[tool,ready,view,activeId,geometry]);
 useImperativeHandle(ref,()=>({tool:chooseTool,finish,cancel:()=>{gesture.current=null;setPreview(null)},fit,zoom,space:(down)=>{spaceDown.current=down;if(down){panned.current=false;setCursor('grab');return false;}setCursor(tool==='hand'?'grab':tool==='draw'?'crosshair':'default');return panned.current;},isReady:()=>ready}));
 function down(e:React.PointerEvent){
  if((e.target as HTMLElement).closest('[data-canvas-ui]')||e.button!==0||!ready||!video)return;
  const screen=point(e),pan=spaceDown.current||tool==='hand',handle=!pan&&!e.altKey?hitSelectedHandle(screen):undefined,badge=handle?undefined:hitBadge(screen);
  if(badge&&!pan){onAction?.('pause');gesture.current=null;setPreview(null);selectLabel(badge);host.current?.focus();return;}
  const p=toSource(...screen,view),hit=hitBox(p);
  if(!pan&&(!classShown||hiddenIds[activeId])&&!(tool==='select'&&hit)){useStore.getState().toast('Show the selected class and track to edit its boxes');return;}
  onAction?.('pause');e.currentTarget.setPointerCapture(e.pointerId);host.current?.focus();autoFit.current=false;
  let kind:Gesture['kind']='click',box:Box|null=null,edge='',who=activeId,g=geometry;
  if(pan){kind='pan';setCursor('grabbing');}
  else if(handle){box=handle.box;edge=handle.edge;kind='resize';who=handle.o.identity_uuid;g=handle.g;selectHit(handle);}
  else if(activeId&&(e.altKey||tool==='draw'||!getBox(active,geometry))){kind='draw';}
  else if(hit){box=hit.box;edge=edgeHit(box,p,7/view.scale);kind=edge?'resize':'move';who=hit.o.identity_uuid;g=hit.g;selectHit(hit);}
  else if(activeId&&!getBox(active,geometry)){kind='draw';}
  else if(tool==='draw'&&!activeId){useStore.getState().toast('Create or select a track before drawing a box');}
  gesture.current={kind,start:p,screen,box,original:box,edge,videoId,frame,activeId:who,geometry:g,moved:false,alt:e.altKey,view};
 }
 function move(e:React.PointerEvent){
  if(!ready||!video)return;const screen=point(e),g=gesture.current,p=toSource(...screen,g?.view||view);
  if(!g){if(spaceDown.current||tool==='hand'){setCursor('grab');return;}const handle=!e.altKey&&hitSelectedHandle(screen);if(handle){setCursor(resizeCursor(handle.edge));return;}if(hitBadge(screen)){setCursor('pointer');return;}if(tool==='draw'){setCursor('crosshair');return;}const hit=hitBox(p);if(hit){const edge=edgeHit(hit.box,p,7/view.scale);setCursor(!edge?'move':resizeCursor(edge));}else setCursor(activeId&&!getBox(active,geometry)?'crosshair':'default');return;}
  if(Math.hypot(screen[0]-g.screen[0],screen[1]-g.screen[1])>3)g.moved=true;
  if(!g.moved)return;
  if(g.kind==='pan'){panned.current=true;setView({...g.view,x:g.view.x+screen[0]-g.screen[0],y:g.view.y+screen[1]-g.screen[1]});return;}
  if(g.kind==='draw')g.box=normalized(g.start,p,video.width,video.height);
  else if(g.kind==='resize')g.box=resizeBox(g.original!,p,g.edge,video.width,video.height);
  else if(g.kind==='move')g.box=moveBox(g.original!,p[0]-g.start[0],p[1]-g.start[1],video.width,video.height);
  setPreview(g.box);
 }
 function zoom(factor:number){finish();if(!ready)return;autoFit.current=false;const screen:[number,number]=[size.w/2,size.h/2],p=toSource(...screen,view),scale=clamp(view.scale*factor,.04,20);setView({scale,x:screen[0]-p[0]*scale,y:screen[1]-p[1]*scale});}
 function context(e:React.MouseEvent){if((e.target as HTMLElement).closest('[data-canvas-ui]')){e.preventDefault();return;}onAction?.('pause');gesture.current=null;setPreview(null);spaceDown.current=false;const screen=point(e),badge=hitBadge(screen),hit=badge?undefined:hitBox(toSource(...screen,view));setMenuTarget(badge?{identity:badge.identity,geometry:badge.geometry}:hit?{identity:hit.o.identity_uuid,geometry:hit.g}:null);if(badge)selectLabel(badge);else if(hit)selectHit(hit);menuDialog.current=false;}
 function menuAction(action:string){finish();if(['id','copyClass','hiddenRange','restoreRange'].includes(action)){menuDialog.current=true;onAction?.(action);return;}const s=useStore.getState();if(action==='new'){s.newPerson();setTool('draw');}else if(action==='copy')s.copyPrevious();else if(action==='hide')s.togglePersonVisibility(s.activeId);else if(action==='focus')s.focusPerson(s.activeId);else if(action==='delete')s.setBox(s.geometry,null);else if(action==='undo')s.undo();else if(action==='redo')s.redo();}
 const menuPerson=project?.state.identities[menuTarget?.identity||''];
 const menuIdentity=menuTarget?.identity||activeId,menuGeometry=menuTarget?.geometry||geometry;
 const previous=menuIdentity&&currentObservation(project,videoId,frame-1,menuIdentity);
 const canCopyPrevious=!!getBox(previous||undefined,menuGeometry)&&!getBox(currentObservation(project,videoId,frame,menuIdentity),menuGeometry);
 const item=(label:string,icon:React.ReactNode,action:()=>void,disabled=false,key?:string,danger=false)=><ContextMenu.Item className={danger?'canvas-menu-danger':''} disabled={disabled} onSelect={action}>{icon}<span>{label}</span>{key&&<kbd>{key}</kbd>}</ContextMenu.Item>;
 function wheel(e:React.WheelEvent){e.preventDefault();if(gesture.current)return;autoFit.current=false;const screen=point(e),p=toSource(...screen,view),scale=clamp(view.scale*Math.exp(-e.deltaY*.0015),.04,20);setView({scale,x:screen[0]-p[0]*scale,y:screen[1]-p[1]*scale});}
 const renderBoxes=boxEntries.map(({o,g,box})=>{
  const selected=o.identity_uuid===activeId&&g===geometry;
  const editing=gesture.current?.activeId===o.identity_uuid&&gesture.current.geometry===g;
  const linkedPreview=preview&&o.geometry_link==='equal'&&gesture.current?.geometry==='person_ext'&&gesture.current.activeId===o.identity_uuid;
  return {key:o.id+g,g,box:editing&&preview?preview:linkedPreview?preview:box,person:project!.state.identities[o.identity_uuid],selected};
 });
 if(preview&&gesture.current?.kind==='draw'&&!getBox(active,gesture.current.geometry))renderBoxes.unshift({key:'drawing',g:gesture.current.geometry,box:preview,person:project!.state.identities[activeId],selected:true});
 const labels=renderBoxes.filter(({box})=>box[2]*view.scale+view.x>=0&&box[0]*view.scale+view.x<size.w&&box[3]*view.scale+view.y>=0&&box[1]*view.scale+view.y<size.h).map(({key,g,box,person,selected})=>({key,x:box[0]*view.scale+view.x,y:box[1]*view.scale+view.y,className:boxStyle(person,g).class_name,id:person?.person_id!=null?'#'+person.person_id:person?.name||'Draft',color:boxStyle(person,g).color,selected,identity:person?.id||'',geometry:g,interactive:key!=='drawing'&&!!person}));
 const badges=layoutLabels(labels,{width:size.w,height:size.h},measureLabelText);
 const drawBox=(box:Box,g:Geometry,key:string,selected=false,color=boxStyle(undefined,g).color)=>{
  const [x1,y1,x2,y2]=box;
  return <Group key={key} opacity={selected?1:.75}>
   <Rect x={x1} y={y1} width={x2-x1} height={y2-y1} stroke={color} strokeWidth={(selected?2:1.3)/view.scale} dash={!VISIBLE_ONLY&&g==='person_visible'?[6/view.scale,4/view.scale]:undefined}/>
  </Group>;
 };
 return <ContextMenu.Root onOpenChange={open=>{menuOpen.current=open}}><ContextMenu.Trigger asChild disabled={!ready}><div className="canvas-host" ref={host} tabIndex={0} role="application" aria-label="Video annotation canvas" data-testid="canvas" data-frame={ready?frame:'loading'} data-scale={view.scale} data-tool={tool} data-offset-x={view.x} data-offset-y={view.y} data-labels={JSON.stringify(ready?badges.map(({key,x,y,width,identity,geometry,className,interactive})=>({key,x,y,width,height:LABEL_HEIGHT,identity,geometry,className,interactive})):[])} onContextMenu={context} onPointerDown={down} onPointerMove={move} onPointerUp={finish} onPointerCancel={()=>{gesture.current=null;setPreview(null)}} onWheel={wheel} style={{cursor}}>
  {ready?<Stage width={size.w} height={size.h} listening={false}><Layer listening={false}><Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}><KImage image={displayedImage} width={video.width} height={video.height}/></Group></Layer>{focusBoxes.length>0&&<Layer listening={false}><Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
   <Rect width={video.width} height={video.height} fill="black" opacity={.38}/>
   {focusBoxes.map(([x1,y1,x2,y2],i)=><Rect key={i} x={x1} y={y1} width={x2-x1} height={y2-y1} fill="black" globalCompositeOperation="destination-out"/>)}
  </Group></Layer>}<Layer listening={false}><Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
   {showProposals&&proposals.map((p,i)=><Group key={p.id} opacity={.55}><Rect x={p.box[0]} y={p.box[1]} width={p.box[2]-p.box[0]} height={p.box[3]-p.box[1]} stroke="#f2bd6b" strokeWidth={1/view.scale} dash={[2/view.scale,5/view.scale]}/><Text text={`? ${Math.round(p.confidence*100)}`} x={p.box[0]} y={p.box[1]+3/view.scale} fontSize={10/view.scale} fill="#ffcf87"/></Group>)}
   {renderBoxes.slice().reverse().map(({key,g,box,person,selected})=>drawBox(box,g,key,selected,boxStyle(person,g).color))}
  </Group><CanvasLabels badges={badges}/><Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
   {renderBoxes.filter(({selected})=>selected).flatMap(({key,box,person,g})=>resizeHandles(box).map(({x,y,edge})=><Rect key={key+edge} x={x-3/view.scale} y={y-3/view.scale} width={6/view.scale} height={6/view.scale} fill="#10161b" stroke={boxStyle(person,g).color} strokeWidth={1/view.scale}/>))}
  </Group></Layer></Stage>:<div className="canvas-loading">{error|| (video?'Loading exact source frame…':'Import a video to begin')}</div>}
  {ready&&<div className="canvas-corner">{video.width} × {video.height}<span>{Math.round(view.scale*100)}%</span><span>Source pixels</span></div>}
  {ready&&!activeId&&<div className="canvas-hint">Press <kbd>N</kbd> to start a track · Drag to draw</div>}
 </div></ContextMenu.Trigger><ContextMenu.Portal><ContextMenu.Content className="canvas-context-menu" collisionPadding={10} onKeyDown={e=>{if(e.currentTarget.dataset.state!=='closed')e.stopPropagation()}} onKeyUp={e=>{if(e.currentTarget.dataset.state!=='closed')e.stopPropagation()}} onContextMenu={e=>e.preventDefault()} onCloseAutoFocus={e=>{e.preventDefault();if(!menuDialog.current)host.current?.focus();}}>
  <ContextMenu.Label className="canvas-menu-label">{menuTarget?'Selected box':'Canvas'}{menuTarget&&<strong>Track {menuPerson?.person_id??'—'} · {boxStyle(menuPerson,menuTarget.geometry).class_name}</strong>}</ContextMenu.Label>
  {menuTarget&&<>
   {item('Change ID or class…',<Tags/>,()=>menuAction('id'),!onAction,'I')}
   {item('Copy to class…',<CopyToClassIcon/>,()=>menuAction('copyClass'),!onAction)}
   {item('Copy previous box',<CopyPreviousBoxIcon/>,()=>menuAction('copy'),!canCopyPrevious,'C')}
   <ContextMenu.Separator className="canvas-menu-separator"/>
   {item('Hide track',<EyeOff/>,()=>menuAction('hide'))}
   {item('Focus track',<Focus/>,()=>menuAction('focus'))}
   <ContextMenu.Separator className="canvas-menu-separator"/>
   {item('Delete box on this frame',<Trash2/>,()=>menuAction('delete'),false,'Delete',true)}
   {item('Delete boxes in range…',<DeleteRangeIcon/>,()=>menuAction('hiddenRange'),!onAction,'⇧ Delete')}
   {item('Restore deleted range…',<RestoreRangeIcon/>,()=>menuAction('restoreRange'),!onAction)}
   <ContextMenu.Separator className="canvas-menu-separator"/>
  </>}
  {!menuTarget&&item('Copy previous box',<CopyPreviousBoxIcon/>,()=>menuAction('copy'),!canCopyPrevious,'C')}
  {item('New track',<Plus/>,()=>menuAction('new'),!ready,'N')}
  {item('Select and move',<MousePointer2/>,()=>chooseTool('select'),!ready,'V')}
  {item('Draw box',<SquareDashed/>,()=>chooseTool('draw'),!ready,'B')}
  {item('Hand tool',<Hand/>,()=>chooseTool('hand'),!ready,'H')}
  {item('Fit video',<Maximize/>,()=>{finish();fit()},!ready,'0')}
  <ContextMenu.Separator className="canvas-menu-separator"/>
  {item('Undo',<Undo2/>,()=>menuAction('undo'),!useStore.getState().history.length,'Ctrl Z')}
  {item('Redo',<Redo2/>,()=>menuAction('redo'),!useStore.getState().redoStack.length,'Ctrl ⇧ Z')}
 </ContextMenu.Content></ContextMenu.Portal></ContextMenu.Root>;
});
