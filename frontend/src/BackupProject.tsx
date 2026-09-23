import { Button } from "./components/ui/button";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api, post } from "./api";
import { useStore } from "./store";
import type { Job } from "./types";

export function BackupProject({
  projectId,
  videoId,
  onDone,
}: {
  projectId: string;
  videoId: string;
  onDone: () => void;
}) {
  const [job, setJob] = useState<Job | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!job?.id) return;
    let gone = false,
      timer = 0;
    async function poll() {
      try {
        const next = await api<Job>("/jobs/" + job!.id);
        if (!gone) {
          setJob(next);
          if (!["completed", "failed"].includes(next.status))
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
  }, [job?.id]);
  return (
    <div className="backup-project">
      <p>
        A project backup keeps annotations and edit history so work can be
        restored later. It is available even before the final review.
      </p>
      <p>
        <strong>Keep your original videos separately.</strong> This ZIP does not
        include video or image files.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Button
        variant="default"
        className="primary"
        disabled={busy || (!!job && ["queued", "running"].includes(job.status))}
        onClick={() => {
          setBusy(true);
          setError("");
          void (async () => {
            try {
              await useStore.getState().saveNow();
              setJob(
                await post<Job>(`/projects/${projectId}/exports`, {
                  format: "native",
                  video_id: videoId,
                  include_videos: false,
                }),
              );
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        Prepare project backup
      </Button>
      {job && (
        <p role="status">
          {job.status === "completed"
            ? "Backup ready"
            : job.status === "failed"
              ? job.error
              : "Preparing backup…"}
        </p>
      )}
      {job?.export_id && (
        <a
          className="download-link"
          href={"/api/exports/" + job.export_id}
          download
        >
          <Download size={16} />
          Download project backup (.zip)
        </a>
      )}
      <Button variant="outline" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
