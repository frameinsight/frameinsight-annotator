import {useState} from 'react';
import {api} from './api';
import {useStore} from './store';
import {type Operation,type Project} from './types';
type Preview={source_name:string;imported_people:number;imported_boxes:number;imported_observations:number;person_id_remaps:{from:number;to:number}[];warnings:string[];revision:number;import_token:string;operation?:Operation;duplicate?:boolean};
export function AnnotationImport({onDone,onBusy}:{onDone:()=>void;onBusy:(b:boolean)=>void}){
 const {project,videoId}=useStore();const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function upload(f:File,commit=false){
  const pid=project!.id,vid=videoId;setBusy(true);onBusy(true);setError('');useStore.setState({remoteBusy:true});
  try{
   await useStore.getState().saveNow();const body=new FormData();body.append('file',f);
   const query=`video_id=${encodeURIComponent(vid)}&preview=${!commit}`+(commit?`&base_revision=${preview!.revision}&import_token=${encodeURIComponent(preview!.import_token)}`:'');
   const result=await api<Preview>(`/projects/${pid}/imports/annotations?${query}`,{method:'POST',body});
   if(commit){const remote=await api<Project>('/projects/'+pid);await useStore.getState().adoptImport(remote,result.operation||null);useStore.getState().toast(result.duplicate?'This JSON has already been imported.':`${result.imported_people} people imported. Ctrl+Z undoes the import.`);onDone();}else setPreview(result);
  }catch(e){setError(String(e));if(!commit)setPreview(null);}finally{setBusy(false);onBusy(false);useStore.setState({remoteBusy:false});}
 }
 return <div className="annotation-import"><p>Choose a Frameinsight annotations JSON export. We check the source video, frame count and image size before adding any annotations.</p><label>Annotations JSON<input aria-label="Annotations JSON" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const f=e.target.files?.[0];setFile(f||null);setPreview(null);if(f)void upload(f)}}/></label>{busy&&<p role="status">{preview?'Importing annotations…':'Checking the file…'}</p>}{error&&<p className="error" role="alert">{error}</p>}{preview&&<><div className="import-summary"><strong>Source video matched</strong><span>{preview.source_name}</span><span>{preview.imported_people} people · {preview.imported_observations} observations · {preview.imported_boxes} boxes</span></div><p>Imported people are added separately. Existing annotations are kept. Paired classes keep the same person ID; number conflicts are assigned a free ID.</p>{preview.person_id_remaps?.length>0&&<p>Person ID changes: {preview.person_id_remaps.map(r=>`${r.from} → ${r.to}`).join(', ')}</p>}{preview.warnings?.map((w,i)=><p className="warning" key={i}>{w}</p>)}<button className="primary" disabled={busy||!file} onClick={()=>void upload(file!,true)}>Import annotations</button></>}</div>;
}
