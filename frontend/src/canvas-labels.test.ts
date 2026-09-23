import {describe,expect,it} from 'vitest';
import {LABEL_HEIGHT,placeLabels,layoutLabels,hitLabel,type BoxLabel} from './canvas-labels';

describe('canvas label placement',()=>{
  it('keeps overlapping class labels separate and gives the selected label the closest slot',()=>{
    const labels=placeLabels([{key:'selected',x:100,y:100,width:130},{key:'extended',x:98,y:98,width:150}],{width:800,height:600});
    expect(labels[0]).toMatchObject({x:100,y:69});
    expect(Math.abs(labels[0].y-labels[1].y)).toBeGreaterThanOrEqual(LABEL_HEIGHT+4);
  });
  it('keeps labels within the full viewport without reserving a tool rail',()=>{
    const labels=placeLabels([{key:'top',x:-30,y:-20,width:190},{key:'right',x:795,y:600,width:190}],{width:800,height:600});
    expect(labels[0].x).toBe(4);
    for(const label of labels){expect(label.x).toBeGreaterThanOrEqual(4);expect(label.y).toBeGreaterThanOrEqual(4);expect(label.x+label.width).toBeLessThanOrEqual(796);expect(label.y+LABEL_HEIGHT).toBeLessThanOrEqual(596);}
  });
  it('keeps badges above slightly offset boxes rather than covering the object',()=>{
    const labels=placeLabels([{key:'selected',x:100,y:140,width:130},{key:'other',x:102,y:152,width:130}],{width:800,height:600});
    expect(labels[1].y+LABEL_HEIGHT).toBeLessThan(labels[0].y);
  });
  it('stacks coincident boxes at the top edge without overlapping badges',()=>{
    const labels=placeLabels(Array.from({length:6},(_,i)=>({key:String(i),x:100,y:2,width:130})),{width:800,height:600});
    for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
      const a=labels[i],b=labels[j];expect(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+LABEL_HEIGHT<=b.y||b.y+LABEL_HEIGHT<=a.y).toBe(true);
    }
  });
});

describe('canvas badge targets',()=>{
  const label=(key:string,overrides:Partial<BoxLabel>={}):BoxLabel=>({key,x:100,y:140,className:'Helmet',id:'#7',color:'#ffffff',selected:false,identity:'track-7',geometry:'class:Helmet',interactive:true,...overrides});
  const measure=(text:string)=>text.length*7;
  it('hits the displayed shifted badge and preserves its exact track and class',()=>{
    const badges=layoutLabels([
      label('selected',{selected:true}),
      label('other',{identity:'track-8',geometry:'class:Vest',className:'Vest'}),
    ],{width:800,height:600},measure);
    const target=badges[1];
    expect(target.y).not.toBe(target.anchorY-LABEL_HEIGHT-7);
    expect(hitLabel(badges,[target.x+target.width/2,target.y+LABEL_HEIGHT/2])).toMatchObject({key:'other',identity:'track-8',geometry:'class:Vest'});
    expect(hitLabel(badges,[100,140])).toBeUndefined();
  });
  it('hits clamped screen positions after zoom and pan rather than the offscreen anchor',()=>{
    const badges=layoutLabels([label('clamped',{x:-100,y:-60})],{width:800,height:600},measure);
    expect(badges[0]).toMatchObject({x:4,y:4,anchorX:-100,anchorY:-60});
    expect(hitLabel(badges,[5,5])?.key).toBe('clamped');
    expect(hitLabel(badges,[-100,-60])).toBeUndefined();
  });
  it('selects the last painted badge when a crowded viewport cannot separate them',()=>{
    const badges=layoutLabels([label('bottom'),label('top',{identity:'track-9'})],{width:100,height:32},measure);
    expect(badges[0]).toMatchObject({x:4,y:4,width:92});
    expect(badges[1]).toMatchObject({x:4,y:4,width:92});
    expect(hitLabel(badges,[30,16])?.identity).toBe('track-9');
  });
  it('uses the shortened text dimensions for both drawing and hit bounds',()=>{
    const [badge]=layoutLabels([label('long',{className:'A very long arbitrary class name',id:'#1234567890123'})],{width:800,height:600},measure);
    expect(badge.name).toMatch(/…$/);
    expect(badge.id).toMatch(/…$/);
    expect(badge.width).toBe(20+badge.nameWidth+17+badge.idWidth+9);
    expect(hitLabel([badge],[badge.x+badge.width, badge.y+12])?.key).toBe('long');
    expect(hitLabel([badge],[badge.x+badge.width+1,badge.y+12])).toBeUndefined();
  });
});
