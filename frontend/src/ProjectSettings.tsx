import {useEffect, useRef, useState} from 'react';
import {LoaderCircle, Plus, Trash2} from 'lucide-react';
import {api} from './api';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {useStore, type ProjectSettingsUpdate} from './store';
import {boxStyle, classColor, orderedGeometryKeys, uuid, type Project} from './types';

type ClassRow = {id: string; original: string | null; name: string};
export type ProjectSettingsProps = {
  projectId: string;
  onSaved: (project: Project, renames: Record<string, string>) => void;
  onCancel: () => void;
  onBusy?: (busy: boolean) => void;
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Reusable form body for the library, annotation workspace and Finish dialog. */
export function ProjectSettings({projectId, onSaved, onCancel, onBusy}: ProjectSettingsProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [conflict, setConflict] = useState(false);
  const attempt = useRef<{fingerprint: string; id: string} | null>(null);
  const busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;

  useEffect(() => {
    let gone = false;
    setLoading(true);
    setError('');
    setConflict(false);
    setProject(null);
    attempt.current = null;
    void (async () => {
      try {
        const state = useStore.getState();
        if (state.project?.id === projectId) await state.saveNow();
        const next = await api<Project>('/projects/' + projectId);
        if (gone) return;
        setProject(next);
        setName(next.name);
        const names = [...new Set([...(next.classes || []), ...Object.keys(next.state.identities).flatMap(id => orderedGeometryKeys(next, id).map(key => boxStyle(next.state.identities[id], key).class_name))])];
        setClasses(names.map((className, index) => ({id: String(index), original: className, name: className})));
      } catch (e) {
        if (!gone) setError(message(e));
      } finally {
        if (!gone) setLoading(false);
      }
    })();
    return () => {gone = true;};
  }, [projectId, reload]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!project || saving) return;
    setError('');
    setConflict(false);
    const trimmed = classes.map(row => ({...row, name: row.name.trim()}));
    if (!name.trim()) return setError('Enter a project name.');
    if (trimmed.some(row => !row.name || row.name.length > 80)) return setError('Give each class a name of 1–80 characters.');
    if (new Set(trimmed.map(row => row.name)).size !== trimmed.length) return setError('Each class needs a different name.');
    const renames = Object.fromEntries(trimmed.filter(row => row.original !== null && row.name !== row.original).map(row => [row.original!, row.name]));
    const body = {base_revision: project.revision, name: name.trim(), class_renames: renames, new_classes: trimmed.filter(row => row.original === null).map(row => row.name)};
    const fingerprint = JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = {fingerprint, id: uuid()};
    const update: ProjectSettingsUpdate = {...body, request_id: attempt.current.id};
    setSaving(true);
    busyCallback.current?.(true);
    try {
      const next = await useStore.getState().saveProjectSettings(projectId, update);
      onSaved(next, renames);
    } catch (e) {
      const stale = e instanceof Error && 'status' in e && e.status === 409;
      setConflict(stale);
      setError(stale ? 'This project changed while settings were open. Reload the current settings, then make your changes again.' : message(e));
    } finally {
      setSaving(false);
      busyCallback.current?.(false);
    }
  }

  if (loading) return <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin"/>Loading project settings…</div>;
  if (!project) return <div className="flex flex-col gap-4"><p role="alert" className="text-sm text-destructive">{error}</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={onCancel}>Cancel</Button><Button onClick={() => setReload(value => value + 1)}>Try again</Button></div></div>;

  return <form className="flex flex-col gap-6" onSubmit={save}>
    <label className="flex flex-col gap-2 text-sm font-medium">
      Project name
      <Input aria-label="Project name" autoFocus required maxLength={150} value={name} disabled={saving} onChange={event => setName(event.target.value)}/>
    </label>
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="project-settings-classes">
      <div className="flex items-center justify-between gap-3">
        <h3 id="project-settings-classes" className="text-sm font-medium">Classes</h3>
        <Button type="button" size="sm" variant="outline" disabled={saving || classes.length >= 100} onClick={() => setClasses(rows => [...rows, {id: uuid(), original: null, name: ''}])}><Plus/>Add class</Button>
      </div>
      <p className="text-sm text-muted-foreground">Names apply to every video, box label and future export in this project. Track IDs and box positions stay the same.</p>
      <div className="flex max-h-[40dvh] flex-col gap-2 overflow-y-auto pr-1">
        {classes.map((row, index) => <div key={row.id} className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 p-3">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{background: row.original === null ? 'var(--muted-foreground)' : classColor(project, row.original)}}/>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{row.original === null ? 'New class' : `Class ${index + 1}`}</span>
            <Input aria-label={`Class name ${index + 1}`} required maxLength={80} value={row.name} disabled={saving} placeholder="e.g. Person" onChange={event => setClasses(rows => rows.map(item => item.id === row.id ? {...item, name: event.target.value} : item))}/>
          </label>
          {row.original === null && <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove new class ${index + 1}`} disabled={saving} onClick={() => setClasses(rows => rows.filter(item => item.id !== row.id))}><Trash2/></Button>}
        </div>)}
      </div>
    </section>
    <p className="text-xs text-muted-foreground">After saving a change, review and validate again in Finish before exporting. Saved edit history remains available in Restore range; the current Undo and Redo stacks reset.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
      {conflict && <Button type="button" variant="outline" disabled={saving} onClick={() => setReload(value => value + 1)}>Reload settings</Button>}
      <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button>
      <Button type="submit" disabled={saving || conflict}>{saving && <LoaderCircle className="animate-spin"/>}{saving ? 'Saving changes…' : 'Save changes'}</Button>
    </div>
  </form>;
}
