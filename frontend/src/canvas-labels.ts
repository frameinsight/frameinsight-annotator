export const LABEL_HEIGHT = 24;
export const LABEL_FONT = 'Inter, system-ui, sans-serif';
const GAP = 4;
export type LabelAnchor = {key:string; x:number; y:number; width:number};
export type LabelPlacement = LabelAnchor & {anchorX:number; anchorY:number};
export type BoxLabel = {key:string;x:number;y:number;className:string;id:string;color:string;selected:boolean;identity:string;geometry:string;interactive:boolean};
export type CanvasBadge = BoxLabel & LabelPlacement & {name:string;nameWidth:number;idWidth:number};

// Screen coordinates keep badges readable at every zoom level. Priority order
// comes from the canvas, so the selected box gets the closest available spot.
export function placeLabels<T extends LabelAnchor>(labels:T[], viewport:{width:number;height:number}, left=GAP):(T & LabelPlacement)[] {
  const placed:(T & LabelPlacement)[]=[];
  const bottom=Math.max(GAP,viewport.height-LABEL_HEIGHT-GAP);
  for(const label of labels){
    const width=Math.min(label.width,Math.max(1,viewport.width-left-GAP));
    const x=Math.max(left,Math.min(label.x,viewport.width-width-GAP));
    const preferred=Math.max(GAP,Math.min(label.y-LABEL_HEIGHT-7,bottom));
    const xs=[x,Math.max(left,x-width-GAP),Math.min(viewport.width-width-GAP,x+width+GAP)];
    let position={x,y:preferred},found=false;
    // Prefer stacking above the boxes, leaving the object itself unobscured.
    const ys=[preferred,
      ...placed.map(p=>p.y-LABEL_HEIGHT-GAP).filter(y=>y<preferred).sort((a,b)=>b-a),
      ...placed.map(p=>p.y+LABEL_HEIGHT+GAP).filter(y=>y>preferred).sort((a,b)=>a-b)];
    for(const candidateX of xs){
      for(const y of ys){
        if(y<GAP||y>bottom)continue;
        if(placed.every(p=>candidateX+width+GAP<=p.x||p.x+p.width+GAP<=candidateX||y+LABEL_HEIGHT+GAP<=p.y||p.y+LABEL_HEIGHT+GAP<=y)){
          position={x:candidateX,y};found=true;break;
        }
      }
      if(found)break;
    }
    placed.push({...label,...position,width,anchorX:label.x,anchorY:label.y});
  }
  return placed;
}

// The renderer and pointer handlers consume these same screen-space rectangles.
// Injecting text measurement keeps layout deterministic in non-browser tests.
export function layoutLabels(labels:BoxLabel[],viewport:{width:number;height:number},measure:(text:string)=>number):CanvasBadge[]{
  function shorten(text:string,maxWidth:number){
    if(measure(text)<=maxWidth)return text;
    let value=text;
    while(value.length&&measure(value+'…')>maxWidth)value=value.slice(0,-1);
    return value+'…';
  }
  return placeLabels(labels.map(label=>{
    const name=shorten(label.className,136),id=shorten(label.id,64);
    const nameWidth=Math.ceil(measure(name)),idWidth=Math.ceil(measure(id));
    return {...label,name,id,nameWidth,idWidth,width:20+nameWidth+17+idWidth+9};
  }),viewport);
}

export function hitLabel<T extends LabelPlacement>(labels:T[],point:[number,number]):T|undefined{
  // Later badges are painted on top when a crowded viewport has no free slot.
  for(let i=labels.length-1;i>=0;i--){
    const label=labels[i];
    if(point[0]>=label.x&&point[0]<=label.x+label.width&&point[1]>=label.y&&point[1]<=label.y+LABEL_HEIGHT)return label;
  }
}
