import {randomUUID} from 'node:crypto';
import {expect, test, type APIRequestContext, type Page} from '../../frontend/node_modules/@playwright/test';
import {selectOption} from './select';

async function fixture(request: APIRequestContext) {
  const name = 'Editable settings ' + Date.now();
  const pid = (await (await request.post('/api/projects', {data: {name, classes: ['Visible', 'Extended']}})).json()).id;
  const vid = (await (await request.post(`/api/projects/${pid}/videos/local`, {data: {path: 'tests/fixtures/numbered.mp4'}})).json()).video_id;
  await expect.poll(async () => (await (await request.get('/api/projects/' + pid)).json()).videos[vid].status).toBe('ready');
  const identity = {id: randomUUID(), person_id: 7, name: 'Track 7', class_name: 'Visible', box_styles: {'class:Visible': {class_name: 'Visible', color: '#38bdf8'}, 'class:Extended': {class_name: 'Extended', color: '#facc15'}}};
  const segment = {id: randomUUID(), video_id: vid, identity_uuid: identity.id, start: 0, end: null, status: 'verified'};
  const rows = Array.from({length: 11}, (_, frame) => ({id: randomUUID(), video_id: vid, frame_index: frame, identity_uuid: identity.id, segment_id: segment.id, person_ext: null, person_visible: null, boxes: {'class:Visible': [100 + frame, 80, 180 + frame, 260], 'class:Extended': [90 + frame, 70, 190 + frame, 300]}, full_quality: 'unknown', occluded: null, truncated: null, geometry_link: 'independent', review_state: 'draft', evidence_note: '', provenance: {'class:Visible': {origin: 'manual', proposal_id: null, human_corrected: false}, 'class:Extended': {origin: 'manual', proposal_id: null, human_corrected: false}}}));
  const response = await request.post(`/api/projects/${pid}/operations`, {data: {id: randomUUID(), base_revision: 0, label: 'Settings acceptance fixture', video_id: vid, frame_index: 0, changes: [{collection: 'identities', id: identity.id, before: null, after: identity}, {collection: 'segments', id: segment.id, before: null, after: segment}, ...rows.map(row => ({collection: 'observations', id: row.id, before: null, after: row}))]}});
  expect(response.ok(), await response.text()).toBe(true);
  return {pid, vid, name, identity, rows};
}

async function saveSettings(page: Page) {
  await page.getByRole('button', {name: 'Save changes', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Project settings', exact: true})).toHaveCount(0);
}

async function validateReview(page: Page) {
  await selectOption(page, 'Annotation coverage', 'Only the objects I chose to annotate');
  const response = page.waitForResponse(result => result.url().endsWith('/validate') && result.request().method() === 'POST');
  await page.getByRole('button', {name: 'Run annotation validation', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Validation passed. You can export.', exact: true})).toBeVisible();
  return (await response).json();
}

test('project and class edits work from library, editor and Finish without losing tracks or deleted-range recovery', async ({page, request}) => {
  test.setTimeout(90000);
  const {pid, vid, name, identity, rows} = await fixture(request);
  const state = async () => (await (await request.get('/api/projects/' + pid)).json());
  await page.route('**/api/updates/check*', route => route.fulfill({json: {status: 'current', current_version: 'test', can_install: false}}));
  await page.goto('/');
  await page.getByRole('button', {name: 'Edit project ' + name, exact: true}).click();
  await page.getByLabel('Project name', {exact: true}).fill(name + ' renamed');
  await page.getByLabel('Class name 1', {exact: true}).fill('Person');
  await page.getByRole('dialog').getByRole('button', {name: 'Add class', exact: true}).click();
  await page.getByLabel('Class name 3', {exact: true}).fill('Head');
  await saveSettings(page);
  await expect(page.getByRole('button', {name: 'Edit project ' + name + ' renamed', exact: true})).toBeVisible();
  await page.getByTestId('open-project-' + pid).click();
  await expect(page.getByRole('heading', {name: name + ' renamed', exact: true})).toBeVisible();
  await page.getByTestId('open-video-' + vid).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame', '0');
  await page.getByRole('button', {name: 'Select Track 7', exact: true}).click();
  await page.getByRole('button', {name: 'Select class Person', exact: true}).click();
  await page.getByTestId('canvas').press('Shift+Delete');
  await page.getByLabel('First frame to delete').fill('4');
  await page.getByLabel('Last frame to delete').fill('6');
  await page.getByRole('button', {name: 'Delete boxes', exact: true}).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.getByRole('button', {name: 'Hide class Extended', exact: true}).click();
  await page.getByRole('button', {name: 'Edit classes', exact: true}).click();
  await page.getByLabel('Class name 1', {exact: true}).fill('Pedestrian');
  await page.getByLabel('Class name 2', {exact: true}).fill('Outline');
  await saveSettings(page);
  await expect(page.getByRole('button', {name: 'Select class Pedestrian', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', {name: 'Show class Outline', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Select Track 7', exact: true}).locator('small')).toHaveText(['Pedestrian', 'Outline']);
  const renamed = await state();
  expect(renamed.classes).toEqual(['Pedestrian', 'Outline', 'Head']);
  expect(renamed.state.identities[identity.id].person_id).toBe(7);
  expect(renamed.state.identities[identity.id].box_styles).toEqual({'class:Pedestrian': {class_name: 'Pedestrian', color: '#38bdf8'}, 'class:Outline': {class_name: 'Outline', color: '#facc15'}});
  expect(Object.values(renamed.state.intervals)).toEqual([expect.objectContaining({geometry: 'class:Pedestrian', start: 4, end: 6})]);
  for (const row of rows) {
    const actual = renamed.state.observations[row.id];
    expect(actual.boxes['class:Outline']).toEqual(row.boxes['class:Extended']);
    expect(actual.boxes['class:Pedestrian']).toEqual(row.frame_index >= 4 && row.frame_index <= 6 ? undefined : row.boxes['class:Visible']);
  }
  await page.getByLabel('Go to frame').fill('5');
  await page.locator('.gap-banner').getByRole('button', {name: 'Restore deleted range', exact: true}).click();
  await page.getByLabel('Recover deleted boxes').check();
  await expect(page.getByRole('dialog')).toContainText('3 boxes to restore');
  await page.getByRole('button', {name: 'Recover deleted boxes', exact: true}).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const recovered = await state();
  expect(Object.keys(recovered.state.intervals)).toHaveLength(0);
  for (const row of rows) expect(recovered.state.observations[row.id].boxes['class:Pedestrian']).toEqual(row.boxes['class:Visible']);
  await page.getByRole('button', {name: 'Finish', exact: true}).click();
  await page.getByRole('button', {name: 'I reviewed — continue', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const beforeRename = await validateReview(page);
  await page.getByRole('button', {name: 'Edit project & classes', exact: true}).click();
  await page.getByLabel('Class name 1', {exact: true}).fill('Human');
  await saveSettings(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('main', {name: 'Validate & export', exact: true})).toBeVisible();
  await expect(page.getByText('Annotations changed. Run validation again before exporting.', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Prepare validated JSON', exact: true})).toBeDisabled();
  const staleExport = await request.post(`/api/projects/${pid}/exports`, {data: {format: 'annotations_json', video_id: vid, revision: beforeRename.revision, validation_id: beforeRename.validation_id, include_videos: false}});
  expect(staleExport.status()).toBe(409);
  const afterRename = await validateReview(page);
  expect(afterRename.revision).toBeGreaterThan(beforeRename.revision);
  expect(afterRename.validation_id).not.toBe(beforeRename.validation_id);
  await page.getByRole('button', {name: 'Prepare validated JSON', exact: true}).click();
  const download = page.getByRole('link', {name: 'Download annotations (.json)', exact: true});
  await expect(download).toBeVisible();
  const exported = await (await request.get((await download.getAttribute('href'))!)).json();
  expect(exported.project.name).toBe(name + ' renamed');
  expect(exported.classes).toEqual(['Human', 'Outline', 'Head']);
  expect(new Set(exported.annotation_index.map((row: any) => row.class_name))).toEqual(new Set(['Human', 'Outline']));
  expect(new Set(exported.annotation_index.map((row: any) => row.person_id))).toEqual(new Set([7]));
  expect(exported.annotation_index).toHaveLength(22);
  expect(exported.media_included).toBe(false);
  expect(exported.validation.mode).toBe('structural');
  await expect(page.locator('video')).toHaveCount(0);
  await page.reload();
  await page.getByTestId('open-project-' + pid).click();
  await page.getByTestId('open-video-' + vid).click();
  await expect(page.getByRole('button', {name: 'Select Track 7', exact: true}).locator('small')).toHaveText(['Human', 'Outline']);
});

test('project settings rejects duplicate class names and reloads stale settings without replacing annotations', async ({page, request}) => {
  const {pid, vid, name} = await fixture(request);
  const before = await (await request.get('/api/projects/' + pid)).json();
  await page.route('**/api/updates/check*', route => route.fulfill({json: {status: 'current', current_version: 'test', can_install: false}}));
  await page.goto('/');
  await page.getByTestId('open-project-' + pid).click();
  await page.getByTestId('open-video-' + vid).click();
  await page.getByRole('button', {name: 'Project settings', exact: true}).click();
  await page.getByLabel('Class name 2', {exact: true}).fill('Visible');
  await page.getByRole('button', {name: 'Save changes', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Each class needs a different name');
  await page.getByLabel('Class name 2', {exact: true}).fill('Extended');
  const remote = await request.patch(`/api/projects/${pid}/settings`, {data: {base_revision: before.revision, name: name + ' elsewhere', class_renames: {}, request_id: randomUUID()}});
  expect(remote.ok(), await remote.text()).toBe(true);
  await page.getByLabel('Project name', {exact: true}).fill('My stale edit');
  await page.getByRole('button', {name: 'Save changes', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('This project changed');
  await page.getByRole('button', {name: 'Reload settings', exact: true}).click();
  await expect(page.getByLabel('Project name', {exact: true})).toHaveValue(name + ' elsewhere');
  await page.getByLabel('Project name', {exact: true}).fill(name + ' final');
  await saveSettings(page);
  const after = await (await request.get('/api/projects/' + pid)).json();
  expect(after.name).toBe(name + ' final');
  expect(after.state).toEqual(before.state);
});
