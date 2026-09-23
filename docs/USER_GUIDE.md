# Annotating your first video

1. Open Frameinsight. **Your videos** lists saved work. Click a video to continue, or **New video** to begin.
2. Enter the number of classes and their names. A class is a box label: use the names supplied by your supervisor. Click **Continue to upload**, choose your video, and wait for it to load.
3. Find the first frame where your object appears. Click **New track** or press **N**. The app gives it a free ID.
4. Choose a class button above the picture, then drag a box around the object. If you need to change or reuse an ID, press **I**, choose **Existing track ID** or type a number, and **Save ID**.
5. Keep that track selected. Move forward a few frames with **F** or **Shift+F**, then move or resize the box. With **Auto-interpolate** on, the app fills frames between your corrections.
6. Go back and check the filled frames. Drag inside a box to move it; drag an edge or corner to resize. Add corrections where movement changes. Interpolation estimates motion, so it still needs your check.
7. To annotate another class for the **same object**, keep the same track and choose another class button. Draw its box, or follow the copying steps below. Do not create a new track for another class of the same object.
8. Repeat for other objects. Use the track list to switch between them. The eye hides boxes; the focus icon shows just one track. Neither deletes annotations.
9. Changes save automatically. **Save** or **Ctrl+S** checks they have saved. Wait for **Saved** before closing the app.
10. When you are ready to deliver, follow **Finish and check your work** below.

## Classes and IDs

One real object keeps **one ID throughout the video**, even after it disappears and returns. Different objects need different IDs. Class colors help you see boxes; they do not determine identity.

The class bar shows your own names. Click a name to edit that class. Click its eye to hide/show it without changing saved work. **Add class → Create class** adds another name and chooses a color. Each class has independent boxes and interpolation under the same ID.

**I → Save ID** can change the ID, class name or color of the selected class track. Changing its class here **reassigns its existing boxes**. To add a second class while keeping the first, close the dialog and choose the second class in the bar instead.

To join two tracks that belong to the same object, select one, press **I**, choose the other track’s existing ID and **Save ID**. Complementary classes and non-overlapping frames can join. If both tracks have a box of the same class on the same frame, the app reports a conflict and keeps both intact. Check the result. **Ctrl+Z** undoes the join.

## Copy a class across the video

1. Select the track and the class you already annotated.
2. Click **Copy to class…**.
3. Choose the destination class and **Copy across all frames**. Add the destination with **Add class** first if needed.
4. The app copies every source box where that track has no destination box. The ID stays the same. Existing destination boxes are kept.
5. Move through the destination class and resize at a few keyframes. With Auto-interpolate on, unadjusted copies between corrections update automatically.
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

The small toolbar on the left edge of the picture works like a design tool:

- **Select / move (V):** click a box to select it, drag inside to move, or drag an edge to resize. You can still draw when the selected class has no box.
- **Draw box (B):** drag to draw or replace the selected track’s box on this frame.
- **Hand / pan (H):** drag the picture without changing annotations. Hold Space to pan temporarily.
- **Zoom + / −** and **Fit** help inspect details. Mouse-wheel zoom also works.

Right-click a box to select that exact track and class. The app’s menu offers ID/class settings, class copying, hide/focus, and deletion/restoration actions. Right-click empty canvas for new-track, tool, fit, undo and redo actions. Commands that do not apply are disabled. The browser’s usual right-click menu remains available outside the canvas.

## Read the frame bar

The larger bar at the bottom follows the selected track **and** class:

- **Present:** the selected class color, whether the box was drawn or interpolated.
- **Hidden:** red, for a range where boxes were explicitly removed. Use Restore range to refill it.
- **No box:** gray, for frames without a saved box or explicit hidden range. This can include work you have not annotated yet.
- **Current frame:** a white outline. Striped sections contain both present and hidden frames at the current overview scale.

Click a section, scrub with the seek control, or enter a precise frame number. Thumbnails have been removed to leave more room for the video. The filename appears quietly beside playback controls. The top-bar panel buttons show or hide Tracks and Shortcuts.

New box colors exclude red, white and black so these timeline states stay distinct. Previously saved colors remain until you choose a new swatch using **I**.

## Make overlapping boxes easier to see

- Track **eye**: hide/show that track’s boxes. **Focus**: show only that track. **Show all tracks** brings the others back.
- Class **eye**: hide/show a class for all tracks. Click its name to show it and begin editing it again.
- **Dim outside**: keep the selected track’s displayed box interiors bright and dim the surrounding image. It does not change the video or annotations.
- Track **trash**: delete that track and all its project annotations after a confirmation. Undo restores an accidental track deletion.

Scroll to zoom. Hold **Space** and drag to pan. Your zoom stays fixed while drawing and changing frames. **0** or **Fit image** fits the whole video again.

## Finish and check your work

1. Click **Finish → Prepare review video**. Wait for the app to render the complete video with every saved class and ID, including boxes hidden in the editor.
2. Play it and check the whole video. Use **0.5×**, **0.25×** or **0.125×** speed, the seek bar, and frame-back/frame-forward controls.
3. Check box placement, class names and IDs. The same object should keep one ID; different objects should not share an ID.
4. If something is wrong, choose **Fix this frame**, correct it, then prepare an updated review.
5. Select whether you annotated **All visible objects in the whole video** or **Only the objects I chose to annotate**. Only choose all objects after checking everyone required by your task.
6. Tick the visual-review confirmation, then **Run annotation validation**. The computer checks box data, IDs, times and JSON structure. It cannot recognize whether two boxes belong to the same real object; your visual check covers that.
7. Fix reported errors. Read and acknowledge any review notes that are correct.
8. After **Validation passed — you can export**, choose **Prepare validated JSON → Download annotations (.json)**. Send that file to your supervisor. It contains annotations and metadata, without video or images.

Finished work remains editable. Any later annotation change requires another review and validation. Keep the original video separately. For editable work you can reopen elsewhere, use **Help → Back up project** at any time and keep the ZIP plus original video. Delivery JSON is not a project-restore file.

## Updates and old videos

At startup, a notice appears if a newer stable version is available. Choose **View update**, read what changed, then **Update** or **Skip for now**. After download verification, **Install update** saves your work and opens the system installer. Reopen Frameinsight after installation. You can also use the update icon at the top to check manually. No internet? Continue annotating normally.

To remove an old video, open **All videos → Delete video** on its card. Check the filename before confirming. This permanently removes that video’s working annotations and cached frames from the app. Your original video and previously downloaded exports remain. Keep a project backup first if you may need to edit it again.

See [all useful shortcuts](SHORTCUTS.md). **Help → About** shows the app version when reporting a problem.
