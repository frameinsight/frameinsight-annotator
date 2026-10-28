import {randomUUID} from 'node:crypto';
import {expect, test, type APIRequestContext, type Page} from '../../frontend/node_modules/@playwright/test';

async function fixture(request: APIRequestContext) {
  const name = 'Delete controls ' + randomUUID().slice(0, 8);
  const pid = (await (await request.post('/api/projects', {data: {name, classes: ['Visible', 'Extended', 'Unused']}})).json()).id;
  const videos: string[] = [];
  const tracks: string[] = [];
  for (let camera = 0; camera < 2; camera++) {
    const vid = (await (await request.post(`/api/projects/${pid}/videos/local`, {data: {path: 'tests/fixtures/numbered.mp4'}})).json()).video_id;
    videos.push(vid);
    await expect.poll(async () => (await (await request.get(`/api/projects/${pid}`)).json()).videos[vid].status).toBe('ready');
    const identity = {id: randomUUID(), person_id: 7, name: 'Track 7', class_name: 'Visible', box_styles: {'class:Visible': {class_name: 'Visible', color: '#38bdf8'}, 'class:Extended': {class_name: 'Extended', color: '#facc15'}}};
    tracks.push(identity.id);
    const segment = {id: randomUUID(), video_id: vid, identity_uuid: identity.id, start: 0, end: null, status: 'verified'};
    const rows = Array.from({length: 3}, (_, frame) => ({id: randomUUID(), video_id: vid, frame_index: frame, identity_uuid: identity.id, segment_id: segment.id, person_ext: null, person_visible: null, boxes: {'class:Visible': [100, 80, 180, 260], 'class:Extended': [90, 70, 190, 300]}, full_quality: 'unknown', occluded: null, truncated: null, geometry_link: 'independent', review_state: 'draft', evidence_note: '', provenance: {'class:Visible': {origin: 'manual', proposal_id: null, human_corrected: false}, 'class:Extended': {origin: 'manual', proposal_id: null, human_corrected: false}}}));
    const current = await (await request.get(`/api/projects/${pid}`)).json();
    const response = await request.post(`/api/projects/${pid}/operations`, {data: {id: randomUUID(), base_revision: current.revision, label: 'Deletion fixture', video_id: vid, frame_index: 0, changes: [{collection: 'identities', id: identity.id, before: null, after: identity}, {collection: 'segments', id: segment.id, before: null, after: segment}, ...rows.map(row => ({collection: 'observations', id: row.id, before: null, after: row}))]}});
    expect(response.ok(), await response.text()).toBe(true);
  }
  return {pid, name, videos, tracks};
}

async function open(page: Page, pid: string, vid?: string) {
  await page.route('**/api/updates/check*', route => route.fulfill({json: {status: 'current', current_version: 'test', can_install: false}}));
  await page.goto('/');
  if (vid) {
    await page.getByTestId('open-project-' + pid).click();
    await page.getByTestId('open-video-' + vid).click();
    await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame', '0');
  }
}

test('existing class deletion is confirmed, applies across videos and preserves other boxes and IDs', async ({page, request}) => {
  const f = await fixture(request);
  const before = await (await request.get(`/api/projects/${f.pid}`)).json();
  await open(page, f.pid, f.videos[0]);
  await page.getByRole('button', {name: 'Select Track 7', exact: true}).click();
  await page.getByRole('button', {name: 'Select class Extended', exact: true}).click();
  await page.getByRole('button', {name: 'Edit classes', exact: true}).click();
  await page.getByRole('button', {name: 'Delete class Extended', exact: true}).click();
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  expect((await (await request.get(`/api/projects/${f.pid}`)).json()).state).toEqual(before.state);
  await page.getByRole('button', {name: 'Edit classes', exact: true}).click();
  await page.getByRole('button', {name: 'Delete class Extended', exact: true}).click();
  await page.getByRole('button', {name: 'Save changes', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Delete classes and annotations?', exact: true})).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('6 boxes');
  await expect(page.getByRole('dialog')).toContainText('2 videos');
  expect((await (await request.get(`/api/projects/${f.pid}`)).json()).state).toEqual(before.state);
  await page.getByRole('button', {name: 'Delete classes and save', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Select class Extended', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Select class Visible', exact: true})).toHaveAttribute('aria-pressed', 'true');
  const after = await (await request.get(`/api/projects/${f.pid}`)).json();
  expect(after.classes).toEqual(['Visible', 'Unused']);
  expect(Object.keys(after.state.identities)).toEqual(Object.keys(before.state.identities));
  for (const [id, row] of Object.entries<any>(before.state.observations)) {
    expect(after.state.observations[id].boxes).toEqual({'class:Visible': row.boxes['class:Visible']});
    expect(after.state.observations[id].provenance['class:Extended']).toBeUndefined();
  }
  for (const id of f.tracks) expect(after.state.identities[id].person_id).toBe(7);
  await page.reload();
  await page.getByTestId('open-project-' + f.pid).click();
  await page.getByTestId('open-video-' + f.videos[1]).click();
  await expect(page.getByRole('button', {name: 'Select class Extended', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Select Track 7', exact: true})).toBeVisible();
});

test('project deletion from the library requires confirmation and removes the project after reload', async ({page, request}) => {
  const f = await fixture(request);
  await open(page, f.pid);
  await page.getByRole('button', {name: 'Delete project ' + f.name, exact: true}).click();
  await expect(page.getByRole('dialog')).toContainText(f.name);
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  expect((await request.get(`/api/projects/${f.pid}`)).ok()).toBe(true);
  await page.getByTestId('open-project-' + f.pid).click();
  await page.getByRole('button', {name: 'Delete project ' + f.name, exact: true}).click();
  const confirm = page.getByRole('button', {name: 'Delete project and annotations', exact: true});
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Confirm project name', {exact: true}).fill('Wrong name');
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Confirm project name', {exact: true}).fill(f.name);
  await confirm.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', {name: 'Your projects', exact: true})).toBeVisible();
  await expect(page.getByTestId('open-project-' + f.pid)).toHaveCount(0);
  expect((await request.get(`/api/projects/${f.pid}`)).status()).toBe(404);
  for (const vid of f.videos) expect((await request.get(`/api/videos/${vid}/ledger`)).status()).toBe(404);
  await page.reload();
  await expect(page.getByTestId('open-project-' + f.pid)).toHaveCount(0);
});

test('empty projects can be deleted from the projects page without affecting neighboring projects', async ({page, request}) => {
  const name = 'Empty deletion ' + randomUUID();
  const project = await (await request.post('/api/projects', {data: {name, classes: ['Person']}})).json();
  const other = await (await request.post('/api/projects', {data: {name: 'Keep ' + randomUUID(), classes: ['Person']}})).json();
  await open(page, project.id);
  await page.getByRole('button', {name: 'Delete project ' + name, exact: true}).click();
  await page.getByLabel('Confirm project name', {exact: true}).fill(name);
  await page.getByRole('button', {name: 'Delete project and annotations', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('open-project-' + project.id)).toHaveCount(0);
  await expect(page.getByTestId('open-project-' + other.id)).toBeVisible();
  expect((await request.get(`/api/projects/${other.id}`)).ok()).toBe(true);
});

test('an editor whose project is deleted elsewhere returns to the projects page', async ({page, request}) => {
  const f = await fixture(request);
  await open(page, f.pid, f.videos[0]);
  const current = await (await request.get(`/api/projects/${f.pid}`)).json();
  const deleted = await request.delete(`/api/projects/${f.pid}?confirmed=true&base_revision=${current.revision}`);
  expect(deleted.ok(), await deleted.text()).toBe(true);
  await expect(page.getByRole('heading', {name: 'Your projects', exact: true})).toBeVisible();
  await expect(page.getByTestId('canvas')).toHaveCount(0);
  await expect(page.getByTestId('open-project-' + f.pid)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', {name: 'Your projects', exact: true})).toBeVisible();
});
