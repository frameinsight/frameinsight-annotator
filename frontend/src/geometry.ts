import type {Box} from './types';
export type View={x:number;y:number;scale:number};
export const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
export const toSource=(x:number,y:number,v:View):[number,number]=>[(x-v.x)/v.scale,(y-v.y)/v.scale];
export const toScreen=(x:number,y:number,v:View):[number,number]=>[x*v.scale+v.x,y*v.scale+v.y];
export function normalized(a:[number,number],b:[number,number],w:number,h:number):Box{return [clamp(Math.min(a[0],b[0]),0,w),clamp(Math.min(a[1],b[1]),0,h),clamp(Math.max(a[0],b[0]),0,w),clamp(Math.max(a[1],b[1]),0,h)];}
export function edgeHit(b:Box,p:[number,number],t:number){
 const [x,y]=p,[x1,y1,x2,y2]=b;if(x<x1-t||x>x2+t||y<y1-t||y>y2+t)return '';
 const l=Math.abs(x-x1)<=t,r=Math.abs(x-x2)<=t,u=Math.abs(y-y1)<=t,d=Math.abs(y-y2)<=t;
 return (u?'n':d?'s':'')+(l?'w':r?'e':'');
}
export const contains=(b:Box,p:[number,number])=>p[0]>=b[0]&&p[0]<=b[2]&&p[1]>=b[1]&&p[1]<=b[3];
export function resizeBox(b:Box,p:[number,number],edge:string,w:number,h:number):Box{
 const r=[...b] as Box;if(edge.includes('w'))r[0]=clamp(p[0],0,r[2]-.01);if(edge.includes('e'))r[2]=clamp(p[0],r[0]+.01,w);if(edge.includes('n'))r[1]=clamp(p[1],0,r[3]-.01);if(edge.includes('s'))r[3]=clamp(p[1],r[1]+.01,h);return r;
}
export function moveBox(b:Box,dx:number,dy:number,w:number,h:number):Box{dx=clamp(dx,-b[0],w-b[2]);dy=clamp(dy,-b[1],h-b[3]);return [b[0]+dx,b[1]+dy,b[2]+dx,b[3]+dy];}
