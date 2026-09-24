/** New box colors reserve red for hidden intervals and black/white for UI contrast. */
export const NEW_BOX_COLORS = ['#fbbf24','#fb923c','#facc15','#a3e635','#4ade80','#2dd4bf','#22d3ee','#38bdf8','#60a5fa','#818cf8','#a78bfa','#c084fc'] as const;
export function isAllowedNewBoxColor(color:string){return NEW_BOX_COLORS.some(candidate=>candidate===color.toLowerCase());}

/** Display-only identity color: stable across frames, classes and reloads. */
export function trackColor(id:number|null|undefined,uuid:string){
 let hash=0;for(const c of uuid)hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;
 const index=id!=null?Math.max(0,id-1):hash;
 return index<NEW_BOX_COLORS.length?NEW_BOX_COLORS[index]:`hsl(${40+(index*137.508)%250} 75% 62%)`;
}

/** Prefer unused palette colors, then scan bright non-red RGB colors. */
export function unusedBoxColor(colors:string[],random= Math.random):string{
 const used=new Set(colors.map(c=>c.toLowerCase()));
 const available=NEW_BOX_COLORS.filter(c=>!used.has(c));
 if(available.length)return available[Math.min(available.length-1,Math.floor(random()*available.length))];
 const offset=Math.floor(random()*65536);
 for(let n=0;n<65536;n++){
  const value=(offset+n)%65536;
  const color='#'+(64+(value>>8)%128).toString(16).padStart(2,'0')+'c0'+(64+(value&255)%192).toString(16).padStart(2,'0');
  if(!used.has(color))return color;
 }
 return NEW_BOX_COLORS[0];
}
