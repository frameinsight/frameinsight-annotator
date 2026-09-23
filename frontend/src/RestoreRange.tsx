import { Button } from "./components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RotateCcw, WandSparkles } from "lucide-react";
import { useStore } from "./store";
import { geometryLabel, type Operation } from "./types";
import { api } from "./api";

export function RestoreRange({
  initialStart,
  initialEnd,
  onClose,
}: {
  initialStart: number;
  initialEnd: number;
  onClose: () => void;
}) {
  const s = useStore();
  const [start, setStart] = useState(String(initialStart)),
    [end, setEnd] = useState(String(initialEnd));
  const [mode, setMode] = useState<"interpolate" | "original">("interpolate");
  const [history, setHistory] = useState<Operation[]>([]),
    [historyState, setHistoryState] = useState("Loading saved edit history…");
  const identity = s.project?.state.identities[s.activeId];
  const count = s.project?.videos[s.videoId]?.frame_count || 0;
  useEffect(() => {
    // Interpolation needs only current boxes. Read the complete saved history
    // only when recovering original coordinates; local undo history is partial.
    if (mode !== "original" || historyState === "") return;
    let gone = false;
    setHistoryState("Loading saved edit history…");
    void api<Operation[]>(`/projects/${s.project!.id}/operations`)
      .then((ops) => {
        if (!gone) {
          setHistory(ops);
          setHistoryState("");
        }
      })
      .catch(() => {
        if (!gone)
          setHistoryState(
            "Saved history could not be loaded. Close and reopen this dialog to retry, or choose Fill between my boxes to use your current boundary boxes.",
          );
      });
    return () => {
      gone = true;
    };
  }, [s.project?.id, mode]);
  const combinedHistory = useMemo(
    () => [
      ...new Map([...history, ...s.history].map((op) => [op.id, op])).values(),
    ],
    [history, s.history],
  );
  const preview = useMemo(
    () =>
      s.previewRestoreRange(
        start.trim() ? Number(start) : NaN,
        end.trim() ? Number(end) : NaN,
        mode,
        combinedHistory,
      ),
    [
      s.project?.state,
      s.activeId,
      s.geometry,
      s.videoId,
      start,
      end,
      mode,
      combinedHistory,
    ],
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (mode === "original" && historyState !== "") return;
        if (s.restoreRange(Number(start), Number(end), mode, combinedHistory))
          onClose();
      }}
      className="restore-range-form"
    >
      <p>
        Restore <strong>{geometryLabel(s.geometry)}</strong> boxes for{" "}
        <strong>
          {identity?.person_id
            ? `Person ${identity.person_id}`
            : identity?.name}
        </strong>
        . Existing boxes and other people stay unchanged.
      </p>
      <div className="form-grid">
        <label>
          First frame
          <input
            autoFocus
            aria-label="First frame to restore"
            type="number"
            required
            min="0"
            max={count - 1}
            step="1"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Last frame
          <input
            aria-label="Last frame to restore"
            type="number"
            required
            min="0"
            max={count - 1}
            step="1"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      <p className="muted">
        Both endpoints are included. Frames 1000–1100 contain 101 frames.
      </p>
      <div
        className="restore-options"
        role="radiogroup"
        aria-label="How to restore boxes"
      >
        <label className={mode === "interpolate" ? "selected" : ""}>
          <input
            type="radio"
            name="restore-mode"
            checked={mode === "interpolate"}
            onChange={() => setMode("interpolate")}
          />
          <WandSparkles size={19} />
          <span>
            <strong>Fill between my boxes</strong>
            <small>
              Remove the selected gap and generate boxes between your drawn or
              corrected frames.
            </small>
          </span>
        </label>
        <label className={mode === "original" ? "selected" : ""}>
          <input
            type="radio"
            name="restore-mode"
            checked={mode === "original"}
            onChange={() => setMode("original")}
          />
          <RotateCcw size={19} />
          <span>
            <strong>Recover deleted boxes</strong>
            <small>
              Bring back original coordinates from saved history, keeping your
              newer boxes.
            </small>
          </span>
        </label>
      </div>
      {mode === "original" && historyState && (
        <p className="muted" role="status">
          {historyState}
        </p>
      )}
      {(mode !== "original" || historyState === "") && <div className="restore-preview" aria-live="polite">
        {preview.error ? (
          <p className="error">
            <AlertTriangle size={16} />
            {preview.error}
          </p>
        ) : (
          <>
            <strong>{preview.restoredBoxes} boxes to restore</strong>
            <p>
              {preview.keptBoxes} existing boxes kept.
              {preview.anchorFrames.length > 0 &&
                ` Uses drawn/corrected frames ${preview.anchorFrames.join(", ")}.`}
            </p>
            {preview.remainingBlockedFrames > 0 && (
              <p>
                {preview.remainingBlockedFrames} frames will remain blocked.
              </p>
            )}
          </>
        )}
        {preview.warnings.map((warning, i) => (
          <p key={i} className="muted">
            {warning}
          </p>
        ))}
      </div>}
      <p className="muted">
        This saves as one action. Undo restores the previous boxes and
        deleted-range settings. Check the result in the video afterwards.
      </p>
      <div className="button-row">
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="default"
          className="primary"
          type="submit"
          disabled={!preview.canRestore || (mode === "original" && historyState !== "")}
        >
          {mode === "original"
            ? "Recover deleted boxes"
            : "Remove gap & fill boxes"}
        </Button>
      </div>
    </form>
  );
}
