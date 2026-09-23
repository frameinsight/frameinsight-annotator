import {Circle,Group,Line,Rect,Text} from 'react-konva';
import {LABEL_HEIGHT,LABEL_FONT,type CanvasBadge} from './canvas-labels';

let measure:CanvasRenderingContext2D|null=null;
export function measureLabelText(text:string){
  measure??=document.createElement('canvas').getContext('2d');
  if(!measure)return text.length*7;
  measure.font=`600 11px ${LABEL_FONT}`;
  return measure.measureText(text).width;
}

export function CanvasLabels({badges}:{badges:CanvasBadge[]}){
  return <Group listening={false}>{badges.map(p=>{
    const displaced=Math.abs(p.x-p.anchorX)>2||Math.abs(p.y-(p.anchorY-LABEL_HEIGHT-7))>2;
    return displaced?<Line key={p.key} points={[p.x+8,p.y+LABEL_HEIGHT,p.anchorX,p.anchorY]} stroke={p.color} opacity={.45} strokeWidth={1}/>:null;
  })}{badges.map(badge=>{
    const split=20+badge.nameWidth+8;
    return <Group key={badge.key}>
      <Group x={badge.x} y={badge.y}>
        <Rect width={badge.width} height={LABEL_HEIGHT} cornerRadius={5} fill={badge.selected?'#252525':'#181818'} stroke={badge.selected?badge.color:'#454545'} strokeWidth={1} shadowColor="#000" shadowOpacity={.2} shadowBlur={4} shadowOffsetY={1}/>
        <Circle x={10} y={12} radius={3} fill={badge.color}/>
        <Text x={20} y={0} width={badge.nameWidth+1} height={LABEL_HEIGHT} verticalAlign="middle" text={badge.name} fontFamily={LABEL_FONT} fontStyle="600" fontSize={11} fill="#ededed"/>
        <Line points={[split,6,split,18]} stroke="#505050" strokeWidth={1}/>
        <Text x={split+8} y={0} width={badge.idWidth+1} height={LABEL_HEIGHT} verticalAlign="middle" text={badge.id} fontFamily={LABEL_FONT} fontStyle="600" fontSize={11} fill={badge.selected?'#ffffff':'#bcbcbc'}/>
      </Group>
    </Group>;
  })}</Group>;
}
