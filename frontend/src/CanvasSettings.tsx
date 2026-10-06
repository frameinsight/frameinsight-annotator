import {Checkbox} from './components/ui/checkbox';
import {NativeSelect} from './components/ui/native-select';
import type {CanvasPreferences,LabelMode} from './canvas-preferences';
import type {ColorMode} from './display-colors';

export function CanvasSettings({preferences,onChange,colorMode,onColorModeChange}:{preferences:CanvasPreferences;onChange:(change:Partial<CanvasPreferences>)=>void;colorMode:ColorMode;onColorModeChange:(mode:ColorMode)=>void}){
 return <div className="canvas-settings">
  <p className="muted">Preferences for this browser. Your saved annotations stay the same.</p>
  <label>View by<NativeSelect aria-label="View by" value={colorMode} onChange={e=>onColorModeChange(e.target.value as ColorMode)}><option value="class">Class — use project class colors</option><option value="track">Track — use each track’s color</option></NativeSelect></label>
  <label>Box labels<NativeSelect aria-label="Box labels" value={preferences.labels} onChange={e=>onChange({labels:e.target.value as LabelMode})}><option value="smart">Selected label + other IDs</option><option value="all">All labels</option><option value="selected">Selected box only</option><option value="ids">Compact IDs only</option><option value="hidden">Hide labels</option></NativeSelect></label>
  <p className="form-help">Labels move away from boxes when space allows and disappear while drawing, moving or resizing. Saved annotations are unchanged.</p>
  <div className="canvas-preference-row"><div><label htmlFor="confirm-new-tracks">Confirm new tracks</label><small>Open ID, class & color after the first box. Turn off to accept the generated values; press I to edit anytime.</small></div><Checkbox id="confirm-new-tracks" checked={preferences.confirmNewTracks} onCheckedChange={value=>onChange({confirmNewTracks:value===true})}/></div>
 </div>;
}
