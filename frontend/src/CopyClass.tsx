import {useMemo, useState} from 'react';
import {ArrowRight, Copy} from 'lucide-react';
import {Button} from './components/ui/button';
import {NativeSelect} from './components/ui/native-select';
import {geometryForClass, getBox, type Project} from './types';

export function CopyClass({project, videoId, trackId, initialSource, classes, onCopy, onClose}: {
  project: Project; videoId: string; trackId: string; initialSource: string; classes: string[];
  onCopy: (source: string, target: string) => void; onClose: () => void;
}) {
  const [source, setSource] = useState(initialSource);
  const [target, setTarget] = useState(classes.find(name => name !== initialSource) || '');
  const identity = project.state.identities[trackId];
  const counts = useMemo(() => {
    const sourceKey = geometryForClass(identity, source), targetKey = geometryForClass(identity, target);
    const rows = Object.values(project.state.observations).filter(row =>
      row.video_id === videoId && row.identity_uuid === trackId && getBox(row, sourceKey));
    return {frames: rows.length, existing: rows.filter(row => getBox(row, targetKey)).length};
  }, [project.state.observations, identity, source, target, videoId, trackId]);
  const track = identity?.person_id ?? identity?.name ?? 'new';
  const canCopy = !!source && !!target && source !== target && counts.frames > counts.existing;

  return <form className="dialog-form" onSubmit={event => {event.preventDefault(); if (canCopy) onCopy(source, target);}}>
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
      <label className="min-w-0">Source class
        <NativeSelect aria-label="Source class" value={source} onChange={event => {
          const next = event.target.value;
          setSource(next);
          if (target === next) setTarget(classes.find(name => name !== next) || '');
        }}>{classes.map(name => <option key={name} value={name}>{name}</option>)}</NativeSelect>
      </label>
      <ArrowRight className="mb-2.5 size-4 text-muted-foreground" aria-hidden="true"/>
      <label className="min-w-0">Target class
        <NativeSelect aria-label="Target class" value={target} onChange={event => setTarget(event.target.value)}>
          {!target && <option value="">Choose a class</option>}
          {classes.filter(name => name !== source).map(name => <option key={name} value={name}>{name}</option>)}
        </NativeSelect>
      </label>
    </div>
    <p aria-live="polite">{target ? <>Copy all boxes from <strong>{source}</strong> to <strong>{target}</strong> for <strong>Track {track}</strong> on all <strong>{counts.frames} {counts.frames === 1 ? 'frame' : 'frames'}</strong> with {source} boxes.</> : 'Add another class using the class bar, then choose it here.'}</p>
    <p className="form-help">{counts.existing > 0 ? `${counts.existing} existing target ${counts.existing === 1 ? 'box is' : 'boxes are'} kept; ${counts.frames - counts.existing} new ${counts.frames - counts.existing === 1 ? 'box' : 'boxes'} will be added. ` : ''}The track ID stays the same. Move or resize the copies afterward. Undo reverses the copy in one step.</p>
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      <Button type="submit" disabled={!canCopy}><Copy/>Copy boxes</Button>
    </div>
  </form>;
}
