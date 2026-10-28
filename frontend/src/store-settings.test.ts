import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {classKey, emptyObservation, type Domain, type Operation, type Project, type Video} from './types';
import type {ProjectSettingsUpdate} from './store';

const mocks = vi.hoisted(() => ({api: vi.fn(), post: vi.fn(async () => ({})), get: vi.fn(), set: vi.fn(async () => {}), del: vi.fn(async () => {})}));
vi.mock('./api', () => ({api: mocks.api, post: mocks.post}));
vi.mock('idb-keyval', () => ({get: mocks.get, set: mocks.set, del: mocks.del}));
let useStore: typeof import('./store').useStore;
const clone = <T,>(value: T): T => structuredClone(value);
const settings = (revision = 2): ProjectSettingsUpdate => ({base_revision: revision, name: 'Pedestrian tracking', class_renames: {Person: 'Pedestrian'}, new_classes: ['Head'], request_id: 'settings-request'});

function fixture(id = 'project') {
  const state: Domain = {identities: {p: {id: 'p', person_id: 7, name: 'Track 7', class_name: 'Person', box_styles: {[classKey('Person')]: {class_name: 'Person', color: '#38bdf8'}}}}, segments: {s: {id: 's', video_id: 'v', identity_uuid: 'p', start: 0, end: null, status: 'verified'}}, observations: {}, intervals: {}, links: {}, reviews: {}, proposal_reviews: {}};
  const observation = emptyObservation('v', 3, 'p', 's');
  observation.id = 'o'; observation.boxes = {[classKey('Person')]: [10, 20, 100, 200]};
  observation.provenance[classKey('Person')] = {origin: 'manual', proposal_id: null, human_corrected: false};
  state.observations.o = observation;
  const project: Project = {id, name: 'People', revision: 2, classes: ['Person'], class_colors: {Person: '#38bdf8'}, state, videos: {v: {id: 'v', width: 640, height: 360, frame_count: 20, status: 'ready'} as Video}};
  const operation: Operation = {id: 'op', label: 'Draw Person', base_revision: 1, video_id: 'v', frame_index: 3, changes: [{collection: 'observations', id: 'o', before: null, after: clone(observation)}]};
  return {project, operation};
}

function renamed(project: Project) {
  const result = clone(project), g = classKey('Pedestrian');
  result.name = 'Pedestrian tracking'; result.revision += 1;
  result.classes = ['Pedestrian', 'Head']; result.class_colors = {Pedestrian: '#38bdf8', Head: '#facc15'};
  result.state.identities.p.class_name = 'Pedestrian';
  result.state.identities.p.box_styles = {[g]: {class_name: 'Pedestrian', color: '#38bdf8'}};
  for (const row of Object.values(result.state.observations)) {
    row.boxes = {[g]: row.boxes![classKey('Person')]};
    row.provenance = {[g]: row.provenance[classKey('Person')]};
  }
  return result;
}

beforeAll(async () => {
  vi.stubGlobal('window', {addEventListener: vi.fn(), setTimeout: vi.fn()});
  vi.stubGlobal('localStorage', {getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn()});
  vi.stubGlobal('setInterval', vi.fn());
  ({useStore} = await import('./store'));
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(async () => {
  if (useStore.getState().pending.length) await useStore.getState().saveNow();
  vi.clearAllMocks(); mocks.api.mockReset(); mocks.get.mockReset();
  vi.mocked(localStorage.getItem).mockReset().mockReturnValue(null);
  const {project, operation} = fixture();
  useStore.setState({project, videoId: 'v', activeId: 'p', frame: 3, geometry: classKey('Person'), pending: [], history: [operation], redoStack: [], hiddenIds: {}, settingsSaving: false, deletingProjectId: null, saveStatus: 'Saved', saveError: '', frameTimes: {}});
});

describe('atomic project settings in the annotation store', () => {
  it('flushes queued annotations before renaming, retaining the cursor and remapping its class', async () => {
    useStore.getState().setBox(classKey('Person'), [20, 25, 110, 210]);
    expect(useStore.getState().pending).toHaveLength(1);
    const expected = renamed(useStore.getState().project!);
    mocks.api.mockImplementationOnce(async (url, options) => {
      expect(url).toBe('/projects/project/settings');
      expect(useStore.getState().pending).toEqual([]);
      expect(mocks.post).toHaveBeenCalledTimes(1);
      expect(JSON.parse(options.body)).toEqual(settings(3));
      return expected;
    });
    const result = await useStore.getState().saveProjectSettings('project', settings(3));
    expect(result).toEqual(expected);
    expect(useStore.getState()).toMatchObject({project: expected, videoId: 'v', activeId: 'p', frame: 3, geometry: classKey('Pedestrian'), pending: [], history: [], redoStack: [], settingsSaving: false});
    expect(mocks.set.mock.calls.some((args: any[]) => args[1]?.project?.name === 'Pedestrian tracking' && args[1].geometry === classKey('Pedestrian'))).toBe(true);
  });

  it('keeps local annotations and undo history if the server rejects a stale revision', async () => {
    const before = clone(useStore.getState().project!);
    const history = clone(useStore.getState().history);
    const conflict = Object.assign(new Error('Revision conflict'), {status: 409});
    mocks.api.mockRejectedValueOnce(conflict);
    await expect(useStore.getState().saveProjectSettings('project', settings())).rejects.toBe(conflict);
    expect(useStore.getState()).toMatchObject({project: before, history, geometry: classKey('Person'), settingsSaving: false});
  });

  it('keeps undo and redo when saving unchanged settings', async () => {
    const before = clone(useStore.getState().project!);
    const history = clone(useStore.getState().history);
    mocks.api.mockResolvedValueOnce(before);
    await useStore.getState().saveProjectSettings('project', {base_revision: before.revision, name: before.name, class_renames: {}, request_id: 'unchanged'});
    expect(useStore.getState()).toMatchObject({project: before, history, geometry: classKey('Person'), settingsSaving: false});
  });

  it('blocks edits, undo and project switching while settings are in flight', async () => {
    const before = clone(useStore.getState().project!);
    let resolve!: (project: Project) => void;
    mocks.api.mockReturnValueOnce(new Promise<Project>(done => {resolve = done;}));
    const saving = useStore.getState().saveProjectSettings('project', settings());
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalled());
    expect(useStore.getState().settingsSaving).toBe(true);
    expect(useStore.getState().commit('Delete annotations', domain => {domain.observations = {};})).toBe(false);
    useStore.getState().undo();
    await expect(useStore.getState().load('another')).rejects.toThrow('finish saving');
    expect(useStore.getState().project).toEqual(before);
    resolve(renamed(before)); await saving;
    expect(useStore.getState().settingsSaving).toBe(false);
  });

  it('protects pending recovery edits for a project that is not open', async () => {
    const {project, operation} = fixture('inactive');
    const local = {project, pending: [operation], history: [operation], geometry: classKey('Person')};
    mocks.get.mockResolvedValueOnce(local);
    await expect(useStore.getState().saveProjectSettings('inactive', settings())).rejects.toThrow('pending edits');
    expect(mocks.api).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled(); expect(mocks.del).not.toHaveBeenCalled();
    expect(useStore.getState().project!.id).toBe('project');
  });

  it('refreshes an inactive recovery journal without changing the currently open project', async () => {
    const active = clone(useStore.getState().project!);
    const {project, operation} = fixture('inactive');
    mocks.get.mockResolvedValueOnce({project, pending: [], history: [operation], redoStack: [operation], videoId: 'v', frame: 3, activeId: 'p', geometry: classKey('Person')});
    const expected = renamed(project); mocks.api.mockResolvedValueOnce(expected);
    await useStore.getState().saveProjectSettings('inactive', settings());
    expect(useStore.getState().project).toEqual(active);
    expect(mocks.set).toHaveBeenCalledWith('frameinsight:journal:inactive', expect.objectContaining({project: expected, pending: [], history: [], redoStack: [], geometry: classKey('Pedestrian'), frame: 3, activeId: 'p'}));
  });

  it('does not revive old class keys from stale local undo history on project load', async () => {
    const {project, operation} = fixture();
    const remote = renamed(project);
    mocks.get.mockResolvedValueOnce({project, pending: [], history: [operation], redoStack: [operation], videoId: 'v', frame: 3, activeId: 'p', geometry: classKey('Person')});
    mocks.api.mockResolvedValueOnce(remote);
    await useStore.getState().load(project.id);
    expect(useStore.getState()).toMatchObject({project: remote, history: [], redoStack: [], geometry: classKey('Pedestrian'), frame: 3, activeId: 'p'});
  });

  it('reuses the supplied request ID after a lost response without changing annotation data', async () => {
    const before = clone(useStore.getState().project!);
    mocks.api.mockRejectedValueOnce(new Error('Network connection lost')).mockResolvedValueOnce(renamed(before));
    await expect(useStore.getState().saveProjectSettings('project', settings())).rejects.toThrow('Network connection lost');
    expect(useStore.getState().project).toEqual(before);
    await useStore.getState().saveProjectSettings('project', settings());
    expect(mocks.api.mock.calls.map(([, options]) => JSON.parse(options.body).request_id)).toEqual(['settings-request', 'settings-request']);
    expect(useStore.getState().project!.state.observations.o.boxes![classKey('Pedestrian')]).toEqual([10, 20, 100, 200]);
  });

  it('clears a deleted class selection and its visibility state without keeping removed tracks or undo', async () => {
    const before = clone(useStore.getState().project!);
    before.classes = ['Person', 'Extended'];
    useStore.setState({project: before, hiddenIds: {p: true}, unregisteredTracks: {p: true}});
    const saved = clone(before);
    saved.revision++; saved.classes = ['Extended']; saved.class_colors = {Extended: '#facc15'};
    saved.state.identities = {}; saved.state.observations = {}; saved.state.segments = {};
    vi.mocked(localStorage.getItem).mockImplementation(key => key === 'frameinsight:classVisibility:project' ? JSON.stringify({Person: true, Extended: true}) : null);
    mocks.api.mockResolvedValueOnce(saved);
    await useStore.getState().saveProjectSettings('project', {base_revision: 2, name: before.name, class_renames: {}, deleted_classes: ['Person'], deletion_confirmed: true, request_id: 'delete-class'});
    expect(useStore.getState()).toMatchObject({project: saved, activeId: '', geometry: classKey('Extended'), hiddenIds: {}, unregisteredTracks: {}, history: [], redoStack: []});
    expect(localStorage.setItem).toHaveBeenCalledWith('frameinsight:classVisibility:project', JSON.stringify({Extended: true}));
    expect(mocks.set).toHaveBeenCalledWith('frameinsight:journal:project', expect.objectContaining({project: saved, activeId: '', geometry: classKey('Extended'), history: []}));
  });
});

describe('project deletion and stale tabs', () => {
  it('saves pending annotations first, locks editing, then clears browser recovery only after confirmed deletion', async () => {
    const {project} = fixture('delete-with-flush'); useStore.setState({project});
    vi.mocked(localStorage.getItem).mockReturnValue(project.id);
    useStore.getState().setBox(classKey('Person'), [20, 25, 110, 210]);
    let complete!: (result: unknown) => void;
    mocks.api.mockImplementationOnce(async (url, options) => {
      expect(url).toBe('/projects/delete-with-flush?confirmed=true&base_revision=3');
      expect(options.method).toBe('DELETE'); expect(useStore.getState().pending).toEqual([]);
      expect(mocks.post).toHaveBeenCalledTimes(1);
      return new Promise(resolve => {complete = resolve;});
    });
    const deleting = useStore.getState().deleteProject(project.id, 3);
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalled());
    expect(useStore.getState().commit('Change while deleting', domain => {domain.observations = {};})).toBe(false);
    expect(mocks.del).not.toHaveBeenCalled();
    complete({deleted: true, project_id: project.id}); await deleting;
    expect(useStore.getState()).toMatchObject({project: null, videoId: '', activeId: '', pending: [], history: [], hiddenIds: {}, settingsSaving: false, deletingProjectId: null});
    expect(mocks.del).toHaveBeenCalledWith('frameinsight:journal:' + project.id);
    for (const key of ['frameinsight:lastProject', 'frameinsight:position:' + project.id, 'frameinsight:visibility:' + project.id, 'frameinsight:classVisibility:' + project.id]) expect(localStorage.removeItem).toHaveBeenCalledWith(key);
  });

  it('retains project data and browser recovery on a stale or busy deletion response', async () => {
    const before = clone(useStore.getState().project!);
    mocks.api.mockRejectedValueOnce(Object.assign(new Error('Project changed'), {status: 409}));
    await expect(useStore.getState().deleteProject(before.id, before.revision)).rejects.toThrow('Project changed');
    expect(useStore.getState()).toMatchObject({project: before, activeId: 'p', settingsSaving: false, deletingProjectId: null});
    expect(mocks.del).not.toHaveBeenCalled(); expect(localStorage.removeItem).not.toHaveBeenCalled();
  });

  it('reports successful server deletion with a warning if browser recovery cleanup fails', async () => {
    const {project} = fixture('delete-cleanup-failure'); useStore.setState({project});
    mocks.api.mockResolvedValueOnce({deleted: true, project_id: project.id});
    mocks.del.mockRejectedValueOnce(new Error('Storage unavailable'));
    const result = await useStore.getState().deleteProject(project.id, project.revision);
    expect(result.deleted).toBe(true); expect(result.cleanup_warning).toContain('local recovery copy');
    expect(useStore.getState().project).toBeNull();
    expect(localStorage.removeItem).toHaveBeenCalledWith('frameinsight:classVisibility:' + project.id);
    await expect(useStore.getState().load(project.id)).rejects.toThrow('deleted');
  });

  it('refuses deletion when another project has unsaved local recovery edits', async () => {
    const {project, operation} = fixture('inactive-delete');
    mocks.get.mockResolvedValueOnce({project, pending: [operation]});
    await expect(useStore.getState().deleteProject(project.id, 2)).rejects.toThrow('pending edits');
    expect(mocks.api).not.toHaveBeenCalled(); expect(mocks.del).not.toHaveBeenCalled();
  });

  it('prevents a deleted tab from editing, undoing, saving or reopening while keeping pending recovery', async () => {
    const {markProjectDeleted} = await import('./store');
    const {project, operation} = fixture('deleted-elsewhere');
    useStore.setState({project, pending: [operation], history: [operation]});
    markProjectDeleted(project.id);
    expect(useStore.getState().commit('Stale change', domain => {domain.observations = {};})).toBe(false);
    useStore.getState().undo();
    await expect(useStore.getState().saveNow()).rejects.toThrow('deleted');
    await expect(useStore.getState().load(project.id)).rejects.toThrow('deleted');
    expect(useStore.getState()).toMatchObject({project, pending: [operation], history: [operation]});
    expect(mocks.api).not.toHaveBeenCalled(); expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.del).not.toHaveBeenCalled();
    useStore.setState({pending: []});
  });
});
