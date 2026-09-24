# Annotating your first video

1. Open Frameinsight. **Your projects** groups saved work. Open a project to see its videos, or choose **New project** and enter its name and class names (one per line).
2. Inside the project, click **New video**. Upload a recording or enter its path on this computer, then wait for it to load. A class is a box label: use the names supplied by your supervisor. All videos in a project share these classes.
3. Find the first frame where your object appears. Click **New track** or press **N**. The app gives it a free ID.
4. Choose a class button above the picture, then drag a box around the object. The ID, class and color dialog opens automatically for this new track. Confirm the details and click **Save ID**. A different color is assigned automatically when the track is created. Press **I** to change these details later.
5. Keep that track selected. Move forward a few frames with **F** or **Shift+F**, then move or resize the box. Interpolation is always on: the app fills frames between your corrections.
6. Go back and check the filled frames. Drag inside a box to move it; drag an edge or corner to resize. Add corrections where movement changes. Interpolation estimates motion, so it still needs your check.
7. To annotate another class for the **same object**, keep the same track and choose another class button. Draw its box, or follow the copying steps below. Do not create a new track for another class of the same object.
8. Repeat for other objects. Use the track list to switch between them. The eye hides boxes; the focus icon shows just one track. Neither deletes annotations.
9. Changes save automatically. **Save** or **Ctrl+S** checks they have saved. Wait for **Saved** before closing the app.
10. When you are ready to deliver, follow **Finish and check your work** below.

## Classes and IDs

One real object keeps **one ID throughout the video**, even after it disappears and returns. Different objects need different IDs. Class colors help you see boxes; they do not determine identity.

The class bar shows your own names. Click a name to draw or adjust boxes for that class. Click its eye to hide/show it without changing saved work. **Add class → Create class** adds another name and chooses a color. Each class has independent boxes and interpolation under the same ID.

To rename the project or a class everywhere, open **Project settings** from the project library or the settings icon beside **New video**. **Edit classes** above the canvas opens the same settings. Edit the names and click **Save changes**. Existing boxes keep their IDs, positions and colors; all videos in this project use the new names.

You can also choose **Edit project & classes** on the **Validate & export** page. After renaming, run validation again and download a fresh JSON; changing a name does not require another watch-through. Files you already downloaded do not change. Renaming resets the current Undo/Redo stacks, but **Restore range** can still use saved deletion history.

**I → Save ID** can change the ID, class name or color of the selected class track. Changing its class here **reassigns its existing boxes**. To add a second class while keeping the first, close the dialog and choose the second class in the bar instead.

Tracks cannot be joined or merged. To add a class to an existing object, select its track and choose the class in the class bar. Changing an ID to one already used by another track is rejected.

## Copy a class across the video

1. Select the track you already annotated.
2. Click **Copy to class…**.
3. Choose **Source class** (the boxes to copy) and **Target class** (the copies' class), then click **Copy boxes**. Add the target with **Add class** first if needed.
4. The app copies every source box where that track has no destination box. The ID stays the same. Existing destination boxes are kept.
5. Move through the target class and resize at a few keyframes. Unadjusted copies between corrections update automatically.
6. Go back and inspect the result. **Ctrl+Z** reverses the whole copy.

Example: copy `person_visible` to `person_extended`, then adjust the extended estimate. These are ordinary class names; your project may use different ones. Copying again can restore destination boxes you previously deleted wherever a source box remains, so check the destination range afterwards.

## Missing boxes and accidental deletion

A frame with no box simply has no annotation of that class. The app does not guess why. It may be hidden, outside the image, or not annotated yet.

**Delete** removes the selected class on the current frame. **Delete range** or **Shift+Delete** removes it from the first through the last frame you enter, including both endpoints. Other classes stay. Deleted ranges pause interpolation so unwanted boxes do not come back automatically.

If you delete too much:

1. Use **Ctrl+Z** immediately, or select the correct track and class and click **Restore range**.
2. Enter the first and last frames to restore, for example **1000** and **1100**.
3. Choose **Fill between my boxes** if boxes at/before the start and at/after the end can guide interpolation. Draw those boundary boxes first if needed.
4. Or choose **Recover deleted boxes** to recover original coordinates from saved history. This also works after reopening when that history is available. Newer boxes are kept.
5. Check the preview count, then **Remove gap & fill boxes** or **Recover deleted boxes**.
6. Inspect the restored section. **Ctrl+Z** reverses the restoration.

Drawing at frames 1000 and 1100 alone restores those two frames; **Restore range** removes the deletion barrier between them. You do not need to redraw each frame.

## Canvas tools and right-click

The compact icon toolbar above the picture combines annotation and canvas tools. Hover over an icon to see its name and shortcut. The first three icons are **Copy to class**, **Delete range**, and **Restore range**; next are the drawing and view tools:

- **Select / move (V):** click a box to select it, drag inside to move, or drag an edge to resize. You can still draw when the selected class has no box.
- **Draw box (B):** drag to draw or replace the selected track’s box on this frame.
- **Hand / pan (H):** drag the picture without changing annotations. Hold Space to pan temporarily.
- **Zoom + / −** and **Fit** help inspect details. Mouse-wheel zoom also works.

Right-click a box **or its class/ID label** to select that exact track and class and open the same menu. Left-clicking a label selects its box without moving or redrawing it. The app’s menu offers ID/class settings, class copying, hide/focus, and deletion/restoration actions. Right-click empty canvas for new-track, tool, fit, undo and redo actions. Commands that do not apply are disabled. The browser’s usual right-click menu remains available outside the canvas.

## Read the frame bar

The larger bar at the bottom follows the selected track **and** class:

- **Present:** the selected class color, whether the box was drawn or interpolated.
- **Hidden:** red, for every frame without a box for the selected track and class. This includes deleted boxes, frames before/after the track, and work you have not annotated yet. Drawing and interpolation fill ordinary empty frames; use Restore range to refill an explicitly deleted range.
- **Current frame:** a white outline. Striped sections contain both present and hidden frames at the current overview scale.

Click a section, scrub with the seek control, or enter a precise frame number. Thumbnails have been removed to leave more room for the video. The filename appears quietly beside playback controls. The top-bar panel buttons show or hide Tracks and Shortcuts.

New box colors exclude red, white and black so these timeline states stay distinct. Previously saved colors remain until you choose a new swatch using **I**.

Diamonds in the frame bar mark interpolation anchors for the selected track and class. Use **Previous/Next keyframe** or **[ / ]** to jump between them. An anchor may be manually drawn, corrected, copied from one frame or imported. Always check the frames between anchors too.

## Make overlapping boxes easier to see

Choose **View by class / View by track** in the canvas right-click menu. Class colors are the default. Track colors give each ID a stable display color across frames and classes; saved class colors and exports stay unchanged.

- Track **eye**: hide/show that track’s boxes. **Focus**: show only that track. **Show all tracks** brings the others back.
- Class **eye**: hide/show a class for all tracks. Click its name to show it and begin editing it again.
- Background dimming is always on: the selected track's displayed box interiors stay bright and the surrounding picture dims. It only changes the display.
- Track **trash**: delete that track and all its project annotations after a confirmation. Undo restores an accidental track deletion.

Scroll to zoom. Hold **Space** and drag to pan. Your zoom stays fixed while drawing and changing frames. **0** or **Fit image** fits the whole video again.

Videos in each project appear in a compact table with their status, creation date and last update. Choose **Open** or **Resume** in a row to continue. Class capsules above the canvas contain a color, name and eye; click the name to draw that class or the eye to show/hide it. The **1** and **2** shortcuts still select the first two classes. Playback, frame stepping, speed and annotation import share the timeline header below the canvas.

## Finish and check your work

1. Click **Finish**. In the prompt, choose **Review in editor**. This shows all tracks and classes and starts the existing canvas playback from the beginning; there is no new video to render.
2. Check the whole video using **0.125×**, **0.25×**, **0.5×** or **1×**, the seek bar, and previous/next-frame controls. Check box placement, class names and IDs. The same object should keep one ID; different objects should not share an ID.
3. Pause and correct mistakes directly in the editor. When satisfied, click **Finish → I reviewed — continue**.
4. On the full **Validate & export** page, choose **All visible objects in the whole video** or **Only the objects I chose to annotate**, according to the work you completed.
5. Click **Run annotation validation**. It checks JSON structure, numeric box data, IDs, class/frame references and consistency. It does not judge where boxes belong, whether one class contains another, or whether an ID matches the real object.
6. If errors appear, use **Open frame** or **Back to annotation** to fix them, then validate again.
7. After **Validation passed. You can export.**, choose **Prepare validated JSON → Download annotations (.json)**. Send that file to your supervisor. It contains annotations and metadata, without video or images.

Finished work remains editable. Saved annotation or name changes require revalidation; names alone do not require another watch-through. Keep the original video separately. For editable work you can reopen elsewhere, use **Help → Back up project** at any time and keep the ZIP plus original video. Delivery JSON is not a project-restore file.

## Updates and old videos

At startup, a notice appears if a newer stable version is available. Choose **View update**, read what changed, then **Update** or **Skip for now**. After download verification, **Install update** saves your work and opens the system installer. Reopen Frameinsight after installation. You can also use the update icon at the top to check manually. No internet? Continue annotating normally.

To remove an old video, open your project’s video list and click the trash icon in its table row. Check the filename before confirming. This permanently removes that video’s working annotations and cached frames from the app. Your original video and previously downloaded exports remain. Keep a project backup first if you may need to edit it again.

See [all useful shortcuts](SHORTCUTS.md). **Help → About** shows the app version when reporting a problem.


## Continue from YOLO or MOT labels

1. Add the matching original video to your project and open it.
2. Click **Import annotations** in the playback controls at the center of the timeline.
3. Choose the format and select the annotation ZIP or TXT file. Five-column YOLO has no tracking IDs; choose the six-column option only when the last column really is a track ID.
4. Check the first source frame number. App frame numbers start at zero. For MOT, also check whether box coordinates start at zero or one. The source program or dataset documentation determines this.
5. Click **Preview import**. Check the counts, frame range, warnings and track-ID mapping. Existing tracks are preserved; colliding IDs get new numbers.
6. Click **Add annotations**. The boxes are now editable. Use **Ctrl+Z** to undo the import. Any newly introduced class names remain available for reuse.
7. Inspect the result using editor playback before finishing. Missing source labels stay Hidden after import. Use **K** to fill between boxes when appropriate; correcting a box also fills its neighboring frames automatically.

Ordinary YOLO detection labels cannot tell the app which detections belong to one object across frames. They become separate tracks. Use tracked YOLO or MOT if you need to preserve a complete tracking annotation.

## Reopen exported annotation JSON

1. Create a new project and add the original video. Wait for preparation to finish.
2. Choose **Import annotations → Frameinsight annotations — JSON** and select the export.
3. Choose **Preview import**. Check the counts and ID mapping. The video dimensions, frame count and available SHA-256 fingerprints must match.
4. Choose **Add annotations**. Boxes, classes, numeric IDs (when unused), keyframes and deleted intervals remain editable. Undo reverses the whole import.
5. Review playback and validate again before a new export. Previous validation and historical deleted boxes/undo records are not imported; use a project backup for full history.

Only single-video Frameinsight v2/v3 exports are accepted. Existing tracks are kept; colliding numeric IDs are remapped rather than silently joined. Import into an empty project to preserve all original numeric IDs.
