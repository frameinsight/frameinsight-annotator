import {useState} from 'react';
export type LabelMode='all'|'selected'|'ids'|'hidden';
export type CanvasPreferences={labels:LabelMode;confirmNewTracks:boolean};
export const defaultCanvasPreferences:CanvasPreferences={labels:'all',confirmNewTracks:true};
const key='frameinsight:canvasPreferences';
export function readCanvasPreferences():CanvasPreferences{
 try{
  const saved=JSON.parse(localStorage.getItem(key)||'{}');
  return {labels:['all','selected','ids','hidden'].includes(saved?.labels)?saved.labels:'all',
   confirmNewTracks:typeof saved?.confirmNewTracks==='boolean'?saved.confirmNewTracks:true};
 }catch{return {...defaultCanvasPreferences};}
}
export function useCanvasPreferences(){
 const [preferences,setPreferences]=useState(readCanvasPreferences);
 const update=(change:Partial<CanvasPreferences>)=>setPreferences(previous=>{
  const next={...previous,...change};try{localStorage.setItem(key,JSON.stringify(next))}catch{}return next;
 });
 return [preferences,update] as const;
}
