import {useEffect, useRef, useState} from 'react';
import {ArrowDownToLine, Check, RefreshCw, X} from 'lucide-react';
import {api, post} from './api';
import {Modal} from './components/AppDialog';
import {Button} from './components/ui/button';
import {APP_VERSION} from './release';

type Release = {status: 'available'|'current'|'offline'|'unavailable'; current_version: string; latest_version?: string; release_notes?: string; release_url?: string; can_install: boolean; asset?: {name:string;size:number}; message?:string};
type Download = {status:'idle'|'downloading'|'ready'|'installing'|'error'; progress:number; version?:string; message?:string; can_install?:boolean; download_url?:string};
const message = (e:unknown) => e instanceof Error ? e.message : String(e);

export function UpdateNotice({beforeUpdate}:{beforeUpdate:()=>Promise<void>}) {
  const [release,setRelease]=useState<Release|null>(null);
  const [download,setDownload]=useState<Download|null>(null);
  const [open,setOpen]=useState(false),[skipped,setSkipped]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[closing,setClosing]=useState('');
  const mounted=useRef(true);
  async function refreshDownload(){
    const data=await api<Download>('/updates/status');
    if(mounted.current){setDownload(data);if(data.status==='error'){setClosing('');setError(data.message||'Update could not finish. Try again or save the installer.');}}
  }
  async function check(manual=false){
    if(manual){setOpen(true);setBusy(true);setError('');}
    try {const data=await api<Release>('/updates/check'+(manual?'?force=true':''));if(mounted.current){setRelease(data);if(manual)setSkipped(false);}}
    catch(e){if(manual&&mounted.current)setError(message(e));}
    finally {if(mounted.current)setBusy(false);}
  }
  useEffect(()=>{mounted.current=true;void check();void refreshDownload().catch(()=>{});return()=>{mounted.current=false}},[]);
  useEffect(()=>{if(open)void refreshDownload().catch(e=>setError(message(e)));},[open]);
  useEffect(()=>{
    if(!['downloading','installing'].includes(download?.status||''))return;
    let gone=false;
    const timer=setInterval(()=>void api<Download>('/updates/status').then(value=>{if(!gone){setDownload(value);setError('');if(value.status==='error'){setClosing('');setError(value.message||'Update could not finish. Try again or save the installer.')}}}).catch(e=>{if(!gone&&!closing)setError('Connection interrupted. Retrying update status…')}),1000);
    return()=>{gone=true;clearInterval(timer)};
  },[download?.status,closing]);
  async function startDownload(){
    setBusy(true);setError('');
    try{await beforeUpdate();setDownload(await post<Download>('/updates/download',{version:release!.latest_version}));}
    catch(e){setError(message(e));}finally{setBusy(false)}
  }
  async function install(){
    setBusy(true);setError('');
    try{
      await beforeUpdate();
      const result=await post<{action:string;message:string;download_url?:string}>('/updates/install',{version:download!.version});
      if(result.action==='closing'){setClosing(result.message);setDownload(d=>d?{...d,status:'installing'}:d);}
      else if(result.download_url)window.location.assign(result.download_url);
    }catch(e){setError(message(e));}finally{setBusy(false)}
  }
  const available=release?.status==='available';
  const hasDownload=!!download&&download.status!=='idle';
  const visibleVersion=hasDownload&&download?.version?download.version:release?.latest_version;
  const installerCanInstall=download?.can_install??release?.can_install;
  const closingMessage=closing||(download?.status==='installing'?(download.message||'Closing Frameinsight to open the installer.'):'');
  const notesMatch=available&&(!hasDownload||download?.version===release?.latest_version);
  return <>
    <Button variant="ghost" size="icon-sm" className={'icon-button update-trigger '+(available&&!skipped?'has-update':'')} aria-label="Check for updates" title={available?'Update available':'Check for updates'} onClick={()=>{setOpen(true);void check(true)}}><RefreshCw size={17}/></Button>
    {available&&!skipped&&!open&&<aside className="update-banner" aria-label="Update available"><span><strong>Frameinsight {release.latest_version} is available</strong><small>See what’s new and choose when to update.</small></span><Button onClick={()=>setOpen(true)}>View update</Button><Button variant="ghost" size="icon-sm" className="icon-button" aria-label="Skip update for now" onClick={()=>setSkipped(true)}><X size={17}/></Button></aside>}
    {open&&<Modal title={visibleVersion?`Frameinsight ${visibleVersion}`:'App updates'} onClose={()=>setOpen(false)} busy={busy||!!closingMessage}>
      <p>Installed version: <strong>{release?.current_version||APP_VERSION}</strong></p>
      {error&&<p className="error" role="alert">{error}</p>}
      {closingMessage?<p role="status">{closingMessage} Reopen Frameinsight after installation finishes.</p>:<>
        {available||hasDownload?<>
          {notesMatch&&<div className="release-notes"><h3>What’s new</h3><pre>{release?.release_notes||'Improvements and fixes. Open the release page for details.'}</pre></div>}
          {release?.release_url&&<a href={release.release_url} target="_blank" rel="noreferrer">{notesMatch?'View release on GitHub ↗':`View latest release ${release.latest_version} ↗`}</a>}
          {hasDownload&&<p>Installer version: <strong>{download?.version||'Checking…'}</strong></p>}
          {!available&&release?.message&&<p className="muted">{release.message}{(download?.status==='ready'||download?.download_url)&&' Your verified download can still be saved or installed.'}</p>}
          <p>Your annotation data stays on this computer. Your work is saved before updating.{installerCanInstall===false&&' This copy runs from source. Download the installer to install the packaged app separately.'}</p>
          {download?.status==='downloading'&&<div className="update-progress" role="status"><progress value={download.progress} max={1}/><span>Downloading and verifying… {Math.round(download.progress*100)}%</span></div>}
          {download?.status==='error'&&<p className="error" role="alert">{download.message||'Download failed. Try again.'}</p>}
          {download?.status==='ready'&&<p className="update-verified"><Check size={16}/>Download verified. {download.can_install?'Ready to install.':'Ready to save.'}</p>}
          {download?.download_url&&<a className="download-link" href={download.download_url} download>Save verified installer for manual installation</a>}
          <div className="button-row"><Button variant="outline" disabled={busy} onClick={()=>{setSkipped(true);setOpen(false)}}>Skip for now</Button>{download?.status==='ready'?<Button onClick={()=>void install()} disabled={busy}><ArrowDownToLine size={16}/>{download.can_install?'Install update':'Save installer'}</Button>:<Button onClick={()=>void startDownload()} disabled={busy||download?.status==='downloading'||!available}><ArrowDownToLine size={16}/>{busy?'Saving…':'Update'}{release?.asset&&` · ${Math.ceil(release.asset.size/1e6)} MB`}</Button>}</div>
        </>:<><p role="status">{busy?'Checking for updates…':release?.status==='current'?'You have the latest available version.':release?.message||'Could not check for updates. You can keep annotating and try again later.'}</p><Button variant="outline" disabled={busy} onClick={()=>void check(true)}><RefreshCw size={16}/>Check again</Button></>}
      </>}
    </Modal>}
  </>;
}
