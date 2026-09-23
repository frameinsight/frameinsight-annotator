import {useEffect, useMemo, useRef, useState} from "react";
import {AlertTriangle, ArrowLeft, Check, CheckCircle2, Download, FileJson2, FolderArchive, LoaderCircle, Settings2, ShieldCheck} from "lucide-react";
import {Badge} from "./components/ui/badge";
import {Button} from "./components/ui/button";
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "./components/ui/card";
import {NativeSelect} from "./components/ui/native-select";
import {api, post} from "./api";
import {useStore} from "./store";
import {boxKeys, classColor, type Job, type Project} from "./types";
import "./review-finish.css";

type Finding = {code: string; message: string; frame_index?: number; identity_uuid?: string; person_id?: number};
type Report = {
  passed: boolean;
  revision: number;
  validation_id?: string;
  errors: Finding[];
  warnings: Finding[];
  checks: {name: string; passed: boolean; detail?: string}[];
  summary: Record<string, unknown>;
};
type Coverage = "all_people" | "selected_people";
type FinishProps = {
  project: Project;
  videoId: string;
  jobs?: Job[];
  visualConfirmed: boolean;
  onEdit: (frame: number, identity?: string) => void;
  onBackup: () => void;
  onSettings: () => void;
  onBack: () => void;
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const checkLabels: Record<string, string> = {
  "JSON serialization": "Valid JSON",
  "Boxes, classes, identities, segments, gaps and links": "Annotation records and references",
  "Positive unique person IDs": "Unique track IDs",
  "Complete source frame ledger and timestamps": "Frame numbers and timestamps",
  "Exported index, class presence and shared track identity consistency": "Consistent classes, tracks and exported data",
};

/** Finish checks the saved annotation document; visual review happens in the editor. */
export function ReviewFinish({project, videoId, visualConfirmed, onEdit, onBackup, onSettings, onBack}: FinishProps) {
  const source = project.videos[videoId];
  const [report, setReport] = useState<Report | null>(null);
  const [exportJob, setExportJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState<"validation" | "export" | null>(null);
  const [error, setError] = useState("");
  const [coverage, setCoverage] = useState<Coverage>("all_people");
  const [changed, setChanged] = useState(false);
  const [pollError, setPollError] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const snapshot = `${project.id}:${videoId}:${project.revision}`;
  const previousSnapshot = useRef(snapshot);
  const passed = !!report?.passed && report.revision === project.revision;
  const exporting = !!exportJob && ["queued", "running"].includes(exportJob.status);
  const counts = useMemo(() => {
    const rows = Object.values(project.state.observations).filter(row => row.video_id === videoId);
    const tracks = new Set(rows.map(row => row.identity_uuid));
    for (const segment of Object.values(project.state.segments)) if (segment.video_id === videoId) tracks.add(segment.identity_uuid);
    return {tracks: tracks.size, boxes: rows.reduce((total, row) => total + boxKeys(row).length, 0)};
  }, [project.state, videoId]);

  useEffect(() => {
    if (previousSnapshot.current === snapshot) return;
    previousSnapshot.current = snapshot;
    setReport(null);
    setExportJob(null);
    setPollError(false);
    setError("");
    setChanged(true);
  }, [snapshot]);

  useEffect(() => {
    if (!exportJob?.id || ["completed", "failed"].includes(exportJob.status)) return;
    let gone = false, timer = 0;
    async function poll() {
      try {
        const job = await api<Job>("/jobs/" + exportJob!.id);
        if (gone) return;
        setPollError(false);
        setExportJob(job);
        if (!["completed", "failed"].includes(job.status)) timer = window.setTimeout(poll, 800);
      } catch {
        if (!gone) setPollError(true);
      }
    }
    void poll();
    return () => {gone = true; clearTimeout(timer);};
  }, [exportJob?.id, pollAttempt]);

  async function validate() {
    setBusy("validation");
    setError("");
    setReport(null);
    setExportJob(null);
    setPollError(false);
    try {
      await useStore.getState().saveNow();
      const current = useStore.getState().project;
      if (!current || current.id !== project.id || !visualConfirmed) throw new Error("Review your annotations in the editor before finishing.");
      const next = await post<Report>(`/videos/${videoId}/validate`, {revision: current.revision, visual_confirmed: true, coverage});
      const latest = useStore.getState().project;
      if (latest?.id !== current.id || latest.revision !== next.revision) throw new Error("Annotations changed. Run validation again before exporting.");
      setReport(next);
      setChanged(false);
    } catch (e) {setError(message(e));}
    finally {setBusy(null);}
  }

  async function exportAnnotations() {
    if (!passed || !report?.validation_id) return;
    setBusy("export");
    setError("");
    setPollError(false);
    try {
      await useStore.getState().saveNow();
      const current = useStore.getState().project;
      if (current?.id !== project.id || current.revision !== report.revision) throw new Error("Annotations changed. Run validation again before exporting.");
      const job = await post<Job>(`/projects/${project.id}/exports`, {format: "annotations_json", video_id: videoId, include_videos: false, revision: report.revision, validation_id: report.validation_id});
      const latest = useStore.getState().project;
      if (latest?.id !== current.id || latest.revision !== report.revision) throw new Error("Annotations changed. Run validation again before exporting.");
      setExportJob(job);
    } catch (e) {setError(message(e));}
    finally {setBusy(null);}
  }

  if (!source) return <main className="finish-page"><div className="finish-shell"><p role="alert">This video is no longer available.</p><Button variant="outline" onClick={onBack}>Back to annotation</Button></div></main>;

  return <main className="finish-page" aria-labelledby="finish-title">
    <div className="finish-shell">
      <header className="finish-heading">
        <div className="finish-heading-copy">
          <Button variant="ghost" size="sm" className="self-start" onClick={onBack}><ArrowLeft/>Back to annotation</Button>
          <h1 id="finish-title">Validate & export</h1>
          <p>Check the saved annotation data, then download your JSON file.</p>
        </div>
        <Badge variant={passed ? "default" : "secondary"}>{passed ? <CheckCircle2/> : <ShieldCheck/>}{passed ? "Ready to export" : "Final data check"}</Badge>
      </header>

      {error && <div className="finish-notice finish-notice-error" role="alert"><AlertTriangle/><p>{error}</p></div>}
      {changed && !passed && <div className="finish-notice" role="status"><ShieldCheck/><p>Annotations changed. Run validation again before exporting.</p></div>}
      {!visualConfirmed && <div className="finish-notice" role="alert"><AlertTriangle/><div><strong>Review your annotations first.</strong><p>Use the annotation canvas to check your boxes and track IDs, then select Finish again.</p></div><Button variant="outline" onClick={onBack}>Review in editor</Button></div>}

      <div className="finish-grid">
        <section className="finish-main" aria-label="Annotation validation">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5"/>Check annotations</CardTitle>
              <CardDescription>Validation checks the JSON structure, track IDs, classes, frame references and internal consistency.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <label className="finish-coverage">
                <span>Annotation coverage</span>
                <NativeSelect aria-label="Annotation coverage" className="w-full" value={coverage} disabled={!!busy || exporting} onChange={event => {
                  setCoverage(event.target.value as Coverage);
                  setReport(null);
                  setExportJob(null);
                  setPollError(false);
                  setError("");
                }}>
                  <option value="all_people">All visible objects in the whole video</option>
                  <option value="selected_people">Only the objects I chose to annotate</option>
                </NativeSelect>
                <small>Choose the scope you completed. This is recorded in the export.</small>
              </label>
              <div className="finish-review-note">{visualConfirmed ? <CheckCircle2/> : <AlertTriangle/>}<p>{visualConfirmed ? "You confirmed your visual review in the annotation canvas." : "Visual review has not been confirmed."} Automatic validation does not judge box placement or whether IDs match real objects.</p></div>
              {!report && <ul className="finish-check-preview">
                {["Track IDs and class references", "Frame numbers and timestamps", "JSON structure and export consistency"].map(label => <li key={label}><ShieldCheck/><span>{label}</span></li>)}
              </ul>}
              <Button className="self-start" disabled={!visualConfirmed || !!busy || exporting || source.status !== "ready"} onClick={() => void validate()}>
                {busy === "validation" ? <LoaderCircle className="spin"/> : <ShieldCheck/>}
                {busy === "validation" ? "Checking annotations…" : "Run annotation validation"}
              </Button>
            </CardContent>
            {report && <CardFooter className="block border-t" data-testid="validation-report">
              <div className={"validation-heading " + (passed ? "passed" : "failed")} role="status">
                {passed ? <CheckCircle2/> : <AlertTriangle/>}
                <div><h2>{passed ? "Validation passed. You can export." : "Fix these issues before exporting"}</h2><p>{passed ? "Your saved annotations passed all structural checks." : "Your work is saved. Open an affected frame to correct the data, then validate again."}</p></div>
              </div>
              <ul className="validation-checks">
                {report.checks.map((check, index) => <li key={index} className={check.passed ? "passed" : "failed"}>{check.passed ? <Check/> : <AlertTriangle/>}<span>{checkLabels[check.name] || check.name}{check.detail && <small>{check.detail}</small>}</span></li>)}
              </ul>
              {report.errors.length > 0 && <div className="validation-findings"><h3>Issues to fix</h3>{report.errors.map((item, index) => <div key={index}><span>{item.message}</span>{item.frame_index != null && <Button variant="outline" size="sm" onClick={() => onEdit(item.frame_index!, item.identity_uuid)}>Open frame {item.frame_index}</Button>}</div>)}</div>}
              {report.warnings.length > 0 && <div className="validation-findings warnings"><h3>Notes</h3>{report.warnings.map((item, index) => <div key={index}><span>{item.message}</span>{item.frame_index != null && <Button variant="outline" size="sm" onClick={() => onEdit(item.frame_index!, item.identity_uuid)}>Inspect frame {item.frame_index}</Button>}</div>)}</div>}
            </CardFooter>}
          </Card>
        </section>

        <aside className="finish-sidebar" aria-label="Export and project details">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><FileJson2 className="size-5"/>Annotations JSON</CardTitle><CardDescription>Save annotations without video or image files.</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ul className="finish-export-content"><li>Track IDs, classes and boxes</li><li>Frame numbers and exact timestamps</li><li>Annotation history and validation results</li></ul>
              {!passed && <p className="finish-export-hint">Run validation to enable export.</p>}
              <Button disabled={!passed || !report?.validation_id || !!busy || exporting} onClick={() => void exportAnnotations()}>
                {busy === "export" || exporting ? <LoaderCircle className="spin"/> : <Download/>}
                {busy === "export" || exporting ? "Preparing JSON…" : "Prepare validated JSON"}
              </Button>
              {exportJob?.status === "failed" && <p className="finish-inline-error" role="alert">{exportJob.error || "The export could not be prepared. Try again."}</p>}
              {pollError && <div className="finish-export-retry"><p role="alert">The connection was interrupted while checking the export.</p><Button variant="outline" size="sm" onClick={() => {setPollError(false); setPollAttempt(value => value + 1);}}>Check export status</Button></div>}
              {passed && exportJob?.status === "completed" && exportJob.export_id && <div className="finish-download" role="status"><p><CheckCircle2/>Your annotation file is ready.</p><Button variant="outline" asChild><a href={"/api/exports/" + exportJob.export_id} download><Download/>Download annotations (.json)</a></Button></div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Project details</CardTitle><CardDescription>Names can be updated before you export.</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="finish-file"><strong>{project.name}</strong><span title={source.name}>{source.name}</span></div>
              <dl className="finish-counts"><div><dt>Tracks</dt><dd>{counts.tracks.toLocaleString()}</dd></div><div><dt>Frames</dt><dd>{source.frame_count.toLocaleString()}</dd></div><div><dt>Boxes</dt><dd>{counts.boxes.toLocaleString()}</dd></div></dl>
              <div className="finish-class-list" aria-label="Project classes">{(project.classes || []).map(name => <Badge variant="outline" className="h-auto min-h-6 whitespace-normal break-words" key={name}><span className="finish-class-dot" style={{background: classColor(project, name)}}/>{name}</Badge>)}</div>
              <Button variant="outline" disabled={!!busy || exporting} onClick={onSettings}><Settings2/>Edit project & classes</Button>
            </CardContent>
            <CardFooter className="border-t"><Button variant="ghost" size="sm" disabled={!!busy} onClick={onBackup}><FolderArchive/>Back up project</Button></CardFooter>
          </Card>
        </aside>
      </div>
    </div>
  </main>;
}
