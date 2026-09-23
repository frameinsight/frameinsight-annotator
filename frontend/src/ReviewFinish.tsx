import { Button } from "./components/ui/button";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { api, post } from "./api";
import { useStore } from "./store";
import type { Job, Project } from "./types";
import { reviewClock, reviewFrameAt } from "./review-utils";
import "./review-finish.css";

type ReviewJob = Job & { revision?: number };
type ReviewMedia = {
  revision: number;
  stale: boolean;
  status: string;
  frame_count: number;
  frame_timestamps: number[];
  duration_seconds: number;
  video_url: string;
  rendered_frames: number;
};
type Finding = {
  code: string;
  message: string;
  frame_index?: number;
  identity_uuid?: string;
  person_id?: number;
};
type Report = {
  passed: boolean;
  revision: number;
  review_job_id: string;
  validation_id?: string;
  errors: Finding[];
  warnings: Finding[];
  checks: { name: string; passed: boolean; detail?: string }[];
  summary: Record<string, unknown>;
};

export function ReviewFinish({
  project,
  videoId,
  jobs,
  onEdit,
  onBackup,
}: {
  project: Project;
  videoId: string;
  jobs: Job[];
  onEdit: (frame: number, identity?: string) => void;
  onBackup: () => void;
}) {
  const source = project.videos[videoId];
  const [reviewJob, setReviewJob] = useState<ReviewJob | null>(
    () =>
      (jobs as ReviewJob[]).find(
        (j) =>
          j.kind === "review" &&
          j.video_id === videoId &&
          (j.revision ?? j.settings?.revision) === project.revision &&
          j.status !== "failed",
      ) || null,
  );
  const [media, setMedia] = useState<ReviewMedia | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [exportJob, setExportJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [visualConfirmed, setVisualConfirmed] = useState(false),
    [notesConfirmed, setNotesConfirmed] = useState(false);
  const [coverage, setCoverage] = useState<"all_people" | "selected_people">(
    "all_people",
  );
  const [playbackRate, setPlaybackRate] = useState(0.5),
    [playing, setPlaying] = useState(false);
  const [seconds, setSeconds] = useState(0),
    [loaded, setLoaded] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const snapshotRevision =
    media?.revision ?? reviewJob?.revision ?? reviewJob?.settings?.revision;
  const stale =
    (snapshotRevision !== undefined && snapshotRevision !== project.revision) ||
    !!media?.stale;
  const frame = reviewFrameAt(media?.frame_timestamps || [], seconds);
  const passed =
    !!report?.passed && report.revision === project.revision && !stale;
  const renderComplete = reviewJob?.status === "completed" && !!media && !stale;

  useEffect(() => {
    if (!reviewJob?.id) return;
    let gone = false;
    async function poll() {
      try {
        const next = await api<ReviewJob>("/jobs/" + reviewJob!.id);
        if (gone) return;
        setReviewJob(next);
        if (next.status === "completed") {
          const details = await api<ReviewMedia>("/reviews/" + next.id);
          if (!gone) setMedia(details);
        } else if (next.status !== "failed")
          timer = window.setTimeout(poll, 1000);
      } catch (e) {
        if (!gone) setError(String(e));
      }
    }
    let timer = 0;
    void poll();
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [reviewJob?.id]);

  useEffect(() => {
    if (!exportJob?.id || ["completed", "failed"].includes(exportJob.status))
      return;
    let gone = false,
      timer = 0;
    async function poll() {
      try {
        const job = await api<Job>("/jobs/" + exportJob!.id);
        if (!gone) {
          setExportJob(job);
          if (!["completed", "failed"].includes(job.status))
            timer = window.setTimeout(poll, 800);
        }
      } catch (e) {
        if (!gone) setError(String(e));
      }
    }
    void poll();
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [exportJob?.id]);

  useEffect(() => {
    if (stale) {
      setVisualConfirmed(false);
      setReport(null);
      setExportJob(null);
      player.current?.pause();
    }
  }, [stale]);
  useEffect(() => {
    if (!report) return;
    results.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    results.current?.focus({ preventScroll: true });
  }, [report]);
  useEffect(() => {
    if (player.current) player.current.playbackRate = playbackRate;
  }, [playbackRate, loaded]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function seekFrame(target: number) {
    if (!player.current || !media) return;
    player.current.pause();
    const index = Math.max(0, Math.min(media.frame_count - 1, target));
    const start = media.frame_timestamps[index];
    const end = media.frame_timestamps[index + 1] ?? media.duration_seconds;
    // Seek inside the frame interval to avoid a browser showing the preceding
    // frame after rounding an exact presentation timestamp.
    const time = start + Math.min(0.001, Math.max(0, (end - start) / 2));
    if (Number.isFinite(time)) {
      player.current.currentTime = time;
      setSeconds(time);
    }
  }
  async function prepare() {
    await run(async () => {
      await useStore.getState().saveNow();
      const current = useStore.getState().project!;
      player.current?.pause();
      setMedia(null);
      setReport(null);
      setExportJob(null);
      setLoaded(false);
      setVisualConfirmed(false);
      setSeconds(0);
      setReviewJob(
        await post<ReviewJob>(`/videos/${videoId}/review-jobs`, {
          revision: current.revision,
        }),
      );
    });
  }
  async function validate() {
    player.current?.pause();
    await run(async () => {
      await useStore.getState().saveNow();
      const current = useStore.getState().project!;
      if (current.revision !== media?.revision)
        throw new Error(
          "Annotations changed. Prepare a new review video before validation.",
        );
      setNotesConfirmed(false);
      setExportJob(null);
      setReport(
        await post<Report>(`/videos/${videoId}/validate`, {
          review_job_id: reviewJob!.id,
          revision: current.revision,
          visual_confirmed: visualConfirmed,
          coverage,
        }),
      );
    });
  }
  async function exportAnnotations() {
    await run(async () => {
      await useStore.getState().saveNow();
      setExportJob(
        await post<Job>(`/projects/${project.id}/exports`, {
          format: "annotations_json",
          video_id: videoId,
          include_videos: false,
          revision: report!.revision,
          review_job_id: reviewJob!.id,
          validation_id: report!.validation_id,
        }),
      );
    });
  }
  const rendering =
    !!reviewJob && ["queued", "running"].includes(reviewJob.status);

  return (
    <div className="review-finish">
      <ol className="review-steps" aria-label="Finish steps">
        <li className={!passed ? "current" : "done"}>
          <span>1</span> Review video
        </li>
        <li className={report ? (passed ? "done" : "current") : ""}>
          <span>2</span> Validate annotations
        </li>
        <li className={passed ? "current" : ""}>
          <span>3</span> Export JSON
        </li>
      </ol>
      <div className="review-intro">
        <div>
          <h3>{source.name}</h3>
          <p>
            Review every person, both box types and the IDs through the whole
            video. Boxes hidden in the editor are included here.
          </p>
        </div>
        <Button variant="outline" className="subtle" onClick={onBackup}>
          Back up project
        </Button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {stale && (
        <div className="review-warning" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Annotations changed after this preview.</strong>
            <p>
              Prepare the video again so your visual review, validation and
              export use the same saved work.
            </p>
          </div>
        </div>
      )}
      {(!reviewJob || stale || reviewJob.status === "failed") && (
        <div className="review-prepare">
          <Film size={36} />
          <h3>See your annotations in motion</h3>
          <p>
            Prepare a complete review video with boxes, classes and person IDs.
            The preview stays on this computer; your annotation JSON contains no
            video or images.
          </p>
          {reviewJob?.status === "failed" && (
            <p className="error">
              {reviewJob.error ||
                "The review video could not be prepared. Your annotations are saved."}
            </p>
          )}
          <Button
            variant="default"
            className="primary"
            disabled={busy}
            onClick={() => void prepare()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Film size={17} />
            )}{" "}
            {stale ? "Prepare updated review video" : "Prepare review video"}
          </Button>
        </div>
      )}
      {rendering && !stale && (
        <div className="review-prepare" role="status">
          <LoaderCircle className="spin" size={30} />
          <h3>Preparing the complete video…</h3>
          <progress
            value={reviewJob.progress || 0}
            max={reviewJob.total || source.frame_count}
          />
          <p>
            {reviewJob.progress || 0} / {reviewJob.total || source.frame_count}{" "}
            frames · {reviewJob.phase || "Drawing all saved boxes and IDs"}
          </p>
          <p>You can close this window while it prepares.</p>
        </div>
      )}
      {renderComplete && (
        <>
          <div className="review-player">
            <video
              ref={player}
              data-testid="review-video"
              aria-label="Complete annotated video"
              src={media.video_url}
              controls
              playsInline
              preload="auto"
              onLoadedMetadata={() => {
                setLoaded(true);
                if (player.current) player.current.playbackRate = playbackRate;
              }}
              onTimeUpdate={() => setSeconds(player.current?.currentTime || 0)}
              onSeeked={() => setSeconds(player.current?.currentTime || 0)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onError={() =>
                setError(
                  "This browser could not play the review video. Your original video and annotations are unchanged. Try opening Frameinsight in Chrome.",
                )
              }
            />
          </div>
          <div className="review-transport">
            <Button
              variant="outline"
              aria-label="Restart review"
              onClick={() => seekFrame(0)}
              disabled={!loaded}
            >
              <RotateCcw size={16} />
            </Button>
            <Button
              variant="outline"
              aria-label="Previous review frame"
              onClick={() => seekFrame(frame - 1)}
              disabled={!loaded || frame === 0}
            >
              <ChevronLeft size={18} />
            </Button>
            <Button
              variant="outline"
              aria-label={playing ? "Pause review" : "Play review"}
              onClick={() => {
                if (playing) player.current?.pause();
                else
                  void player.current?.play().catch((e) => setError(String(e)));
              }}
              disabled={!loaded}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </Button>
            <Button
              variant="outline"
              aria-label="Next review frame"
              onClick={() => seekFrame(frame + 1)}
              disabled={!loaded || frame >= media.frame_count - 1}
            >
              <ChevronRight size={18} />
            </Button>
            <label className="review-speed">
              Speed
              <select
                aria-label="Review playback speed"
                value={playbackRate}
                onChange={(e) => setPlaybackRate(Number(e.target.value))}
              >
                <option value="0.125">0.125× · very slow</option>
                <option value="0.25">0.25× · quarter speed</option>
                <option value="0.5">0.5× · half speed</option>
                <option value="1">1× · normal</option>
              </select>
            </label>
            <span className="review-position">
              Frame {frame} / {media.frame_count - 1} · {reviewClock(seconds)}
            </span>
            <Button
              variant="outline"
              onClick={() => {
                player.current?.pause();
                onEdit(frame);
              }}
            >
              Fix this frame
            </Button>
          </div>
          <div className="review-confirmation">
            <label>
              Annotation coverage
              <select
                aria-label="Annotation coverage"
                value={coverage}
                onChange={(e) => {
                  setCoverage(e.target.value as typeof coverage);
                  setReport(null);
                  setExportJob(null);
                  setVisualConfirmed(false);
                }}
              >
                <option value="all_people">
                  All visible people in the whole video
                </option>
                <option value="selected_people">
                  Only the people I chose to annotate
                </option>
              </select>
            </label>
            <label className="checkbox">
              <input
                aria-label="Visual review complete"
                type="checkbox"
                checked={visualConfirmed}
                disabled={!loaded || busy}
                onChange={(e) => {
                  setVisualConfirmed(e.target.checked);
                  setReport(null);
                  setExportJob(null);
                }}
              />
              I reviewed the video: boxes fit the people, each real person keeps
              the same ID, and the coverage selected above is correct.
            </label>
            <p>
              Automatic checks verify the data structure. They cannot tell
              whether two IDs belong to the same real person or whether someone
              was missed. Your visual review checks that.
            </p>
            <Button
              variant="default"
              className="primary"
              disabled={!loaded || !visualConfirmed || busy}
              onClick={() => void validate()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <ShieldCheck size={17} />
              )}
              Run annotation validation
            </Button>
          </div>
        </>
      )}
      {report && !stale && (
        <div ref={results} tabIndex={-1} className="validation-report" data-testid="validation-report">
          <div
            className={
              passed ? "validation-heading passed" : "validation-heading failed"
            }
          >
            {passed ? <CheckCircle2 size={25} /> : <AlertTriangle size={25} />}
            <div>
              <h3>
                {passed
                  ? "Validation passed — you can export"
                  : "Fix these issues before exporting"}
              </h3>
              <p>
                {passed
                  ? "The saved annotations and JSON passed the structural checks. Visual correctness is based on your confirmation."
                  : "Your work is saved. Open an affected frame, make corrections, then review and validate again."}
              </p>
            </div>
          </div>
          <ul className="validation-checks">
            {report.checks.map((check, i) => (
              <li key={i} className={check.passed ? "passed" : "failed"}>
                {check.passed ? (
                  <Check size={15} />
                ) : (
                  <AlertTriangle size={15} />
                )}
                <span>
                  {check.name}
                  {check.detail && <small>{check.detail}</small>}
                </span>
              </li>
            ))}
          </ul>
          {report.errors.length > 0 && (
            <div className="validation-findings">
              <h4>Must fix</h4>
              {report.errors.map((item, i) => (
                <div key={i}>
                  <span>{item.message}</span>
                  {item.frame_index != null && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        onEdit(item.frame_index!, item.identity_uuid)
                      }
                    >
                      Open frame {item.frame_index}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {report.warnings.length > 0 && (
            <div className="validation-findings warnings">
              <h4>Review notes</h4>
              {report.warnings.map((item, i) => (
                <div key={i}>
                  <span>{item.message}</span>
                  {item.frame_index != null && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        onEdit(item.frame_index!, item.identity_uuid)
                      }
                    >
                      Inspect frame {item.frame_index}
                    </Button>
                  )}
                </div>
              ))}
              {passed && (
                <label className="checkbox">
                  <input
                    aria-label="Review notes checked"
                    type="checkbox"
                    checked={notesConfirmed}
                    onChange={(e) => setNotesConfirmed(e.target.checked)}
                  />
                  I checked these notes and they match my intended annotations.
                </label>
              )}
            </div>
          )}
          {passed && (
            <div className="review-export">
              <p>
                <strong>Annotations JSON</strong> · IDs, classes, boxes, exact
                frame times and validation results. No video or images.
              </p>
              <Button
                variant="default"
                className="primary"
                disabled={
                  busy ||
                  (report.warnings.length > 0 && !notesConfirmed) ||
                  (!!exportJob &&
                    ["queued", "running"].includes(exportJob.status))
                }
                onClick={() => void exportAnnotations()}
              >
                <Download size={17} />
                {exportJob && ["queued", "running"].includes(exportJob.status)
                  ? "Preparing JSON…"
                  : "Prepare validated JSON"}
              </Button>
              {exportJob?.status === "failed" && (
                <p className="error" role="alert">
                  {exportJob.error}
                </p>
              )}
              {exportJob?.status === "completed" && exportJob.export_id && (
                <a
                  className="download-link"
                  href={"/api/exports/" + exportJob.export_id}
                  download
                >
                  <Download size={17} />
                  Download annotations (.json)
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
