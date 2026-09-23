/** New box colors reserve red for hidden intervals and black/white for UI contrast. */
export const NEW_BOX_COLORS = ['#fbbf24','#fb923c','#facc15','#a3e635','#4ade80','#2dd4bf','#22d3ee','#38bdf8','#60a5fa','#818cf8','#a78bfa','#c084fc'] as const;
export function isAllowedNewBoxColor(color:string){return NEW_BOX_COLORS.some(candidate=>candidate===color.toLowerCase());}
