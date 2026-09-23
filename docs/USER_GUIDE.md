# Annotating a video

1. Open Frameinsight. The **Your videos** screen lists your previous videos.
   Click a video to continue, or **New video** to start.
2. Choose the **number of classes**, then type each class name. A class is a
   label for a box; use the names supplied by your supervisor. Click
   **Continue to upload**, choose the video, and wait until it is ready.
3. Find the first frame where the person appears. Press **N**, then drag a
   rectangle around the visible part of them (**1 / Visible**).
4. A person number is assigned automatically. Press **I** to change/reuse it, choose/type a class name, and choose
   a box color. Click **Save ID**. Keep the same number for the same person.
   For their full/extended rectangle, click **Copy Visible → Extended (all frames)** above
   the video once. It copies all Visible boxes for this person throughout the
   video and selects Extended. On a few keyframes, drag the
   bottom edge down to the estimated feet, adjusting other edges as needed.
   Both boxes keep the same person ID; do not press N again. The first copy
   gives this person cyan Visible and orange Extended colors across their track.
   Press I to customize either class/color; further copies keep your choices.
   You can also press **2 / Extended** and draw a rectangle yourself.
5. Move forward several frames and draw or adjust that person's box. With
   **Auto-interpolate** checked, the app fills the frames between your boxes.
6. Go back and inspect those generated boxes. Drag inside a box to move it,
   or drag a corner/edge to resize it. Correcting a box also updates nearby
   generated boxes of that type. Add more corrections where movement changes quickly.
   Switch between **1 / Visible** and **2 / Extended** to check each track.
7. Repeat for each person. Use the left panel to switch between people.
8. Changes save automatically. Click **Save** or press **Ctrl+S** whenever you
   want to check they have saved. Wait until the top bar says **Saved**.
9. When done, follow **Finish and check your work** below. You can continue editing afterwards.

## Finish and check your work

1. Click **Finish**, then **Prepare review video**. Wait while the app draws all boxes and IDs onto the complete video. This preview stays on your computer.
2. Play the video. Use **0.5×** for half speed, **0.25×** or **0.125×** for slower review. Use the seek bar to jump backwards or forwards and the arrow buttons to move one frame at a time.
3. Check that each box fits, each person keeps the same ID, and both box types belong to the correct person. All saved boxes appear here, even those you hid while editing.
4. If something is wrong, click **Fix this frame**. Correct it in the editor, then return to **Finish** and prepare the updated review video.
5. Choose your coverage: **All visible people in the whole video**, or **Only the people I chose to annotate**. Only choose all people after actually checking everyone.
6. Tick the visual-review confirmation, then click **Run annotation validation**. The computer checks IDs, box data, frame times and the JSON structure. It cannot judge whether a box belongs to the right real person; that is why you watched the video first.
7. Fix any errors using **Open frame**. Check any review notes and confirm them if correct.
8. When you see **Validation passed — you can export**, click **Prepare validated JSON**, then **Download annotations (.json)**. Send that file to your supervisor. It contains annotations and metadata, **no video or images**.

Keep the original video separately. Finished videos remain editable; a later annotation change requires fresh review and validation before another delivery. You can close the Finish window to continue annotating. For a copy you can reopen in this app, use **Help → Back up project** at any time, even before validation, and keep the backup ZIP with the original video.

## Copying and adjusting Extended

Select a person and click **Copy Visible → Extended (all frames)** once. It fills
missing Extended boxes across this video, wherever that person has a Visible box.
Existing Extended boxes are kept. You can click from any frame, including one
where that person is absent. The button is disabled when nothing needs copying.

Press **2** and resize the Extended box at spaced keyframes. With
**Auto-interpolate** checked, copies between your corrections update automatically.
Go back to check them and make more corrections as needed. Visible boxes stay
unchanged, and frames without either box stay empty. Clicking copy again also
restores deleted Extended boxes wherever Visible still exists. **Ctrl+Z** undoes
the whole copy, including its color changes. Changes save automatically.

## Dim the background while annotating

Select a person, then enable **Dim outside boxes** above the video. Pixels inside
that person's displayed boxes stay at their normal brightness; the surrounding
image becomes slightly darker. Box borders and resize handles stay clear.
The bright area follows drawing, moving, resizing, zooming and frame changes.
**Show both** keeps both Visible and Extended interiors bright. With no selected
box on the frame, the image stays normal. Turn the checkbox off to restore the
normal view. This preference is remembered on this browser and does not change
annotations, interpolation, the source video or exports.

# Useful keys

| Key | Action |
|---|---|
| N | Start another person |
| 1 / 2 | Select Visible / Extended box |
| Tab | Switch box type while the canvas is focused |
| I | Person ID, class and color; choose an old ID or create a new one |
| F / D | Next / previous frame |
| Shift+F / Shift+D | Forward / back 10 frames |
| Enter | Next frame |
| C | Copy the previous frame's box of the selected type |
| K | Fill between drawn boxes of the selected type |
| Shift+Delete | Delete the selected type over a frame range |
| Delete | Remove the selected box on this frame |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+S | Save |
| 0 | Fit video to the screen |
| Space | Tap to play/pause; hold and drag to pan |
| Alt + drag | Replace a box with a new rectangle |
| Mouse wheel | Zoom |

The right side of the editor also lists the useful shortcuts. **Help** lets you
change key bindings. **Start guide** explains the workflow; **About** shows the app version when reporting a problem.

# Working with overlapping people

- **Eye:** hide/show someone's boxes. This only changes your view; their boxes
  remain saved and exported.
- **Focus:** show only that person's boxes. **Show all people** restores everyone.
- **Trash:** remove that person and all their annotations. Read the dialog before
  deleting. **Ctrl+Z** restores an accidental deletion.

# Two box types, one person

Use **Visible** for the part you can see and **Extended** for the estimated full
body rectangle. Keep one person ID for both. They interpolate independently,
so correcting one does not move the other. Uncheck **Show both** to display only
the selected type; both remain saved.

To join older separate tracks: select the track whose class is `person_extended`,
press **I**, keep **Extended**, choose the existing visible person’s ID, and
click **Save ID**. The dialog explains the conversion. Original box coordinates
are kept, including on overlapping frames. Ctrl+Z restores the separate tracks.
Two boxes of the same type on one frame cannot be joined without resolving the
conflict; neither will be overwritten.

# Visibility is automatic

**A visible box means Visible. No visible box means Not visible.**
An extended box may still be present; it does not establish visible evidence. This applies to every frame
for the selected person, including frames before their first box and after
their last box. There is no separate visibility or occlusion button to press.

- **Delete** removes the selected person's current **box type** on this frame.
  The other type stays. Check the Visible/Extended button before deleting.
- For several frames, click **Delete boxes in range** or press **Shift+Delete**.
  Enter the first and last frame, then click **Delete boxes**. Both are included.
- Deleted frames stay empty for that type when interpolation runs again.
- If you deleted too much, use **Restore deleted range**, described below. Drawing a box again restores only that single frame; it does not remove the rest of a deleted interval.
- **Ctrl+Z** undoes the entire action; **Ctrl+Shift+Z** redoes it.

Example: keep boxes at **39 and 60**, and delete **40–59**. The same person ID
is kept on both sides. No G/H steps are needed. When no deletion was recorded,
normal interpolation can still fill between your drawn keyframes.

The app does not guess why a person has no box. Their visibility is Not visible
and the cause is Unknown unless previously recorded. While you are still working,
Not visible can also mean you have not drawn that box yet: check the whole video
before finishing. Eye/Focus only change your display; a hidden-on-screen box
still counts as Visible in the exported annotations.

# Accidentally deleted many frames?

1. Select the correct person on the left and the correct **Visible** or **Extended** box type.
2. Click **Restore deleted range** above the video or in the right panel.
3. Enter the first and last frames you want back, for example **1000** and **1100**. Both endpoints count.
4. Choose **Fill between my boxes** if you want to generate the missing boxes between your current drawn/corrected boxes. Make sure there is a box at or before the start and at or after the end. Existing boxes are kept.
5. Alternatively, choose **Recover deleted boxes** to bring back the original box positions from saved edit history. This also works after reopening when that history is available. If history is missing, the app tells you which frames it cannot recover; use the first option for those frames.
6. Check the preview count, then click **Remove gap & fill boxes** or **Recover deleted boxes**.
7. Play/check the restored section. **Ctrl+Z** undoes the whole restoration if needed.

If you see **Interpolation paused**, those frames have a recorded deletion. Simply drawing at frames 1000 and 1100 does not remove the deletion between them; use this restore action. You do not need to redraw each frame.

# Returning to an earlier frame

If Person 7 starts at frame 40, you can go back to frame 20, press **N**, draw
their box, then press **I** and choose Person 7. The tracks join and eligible
frames between the two boxes fill automatically. You can choose the ID before
drawing too. Gaps remain gaps. If the person already has a box on that frame,
select their existing box instead of creating another.

# Classes and downloads

Class names are your chosen labels. All classes use the same box-drawing tool.
Select your person on the left. Their class names appear in small colored text
under their ID. Click a class button above the video to use it. Click **Add
class**, type a name, then **Create class** to add one. A distinct random color
is assigned and saved, so it stays the same when you reopen the video. Press
**I** if you want to change the ID or manually choose a box color.

Clicking `person_visible` or `person_extended` selects the matching box type.
Other new class names use the currently selected Visible/Extended type. Clicking
a class already used by this person switches to that box type. Class changes
apply across that person's selected box track. Both types stay under one person
on the left; do not press N for the second type. There are two box slots per
person per frame (one Visible, one Extended), regardless of how many class names
you create.

Scroll to zoom and hold Space while dragging to pan. Your zoom and position stay
fixed while you draw, change frames, or hide/resize panels. Press **0** or click
**Fit image** to fit the whole video again.

**Annotations JSON** exports the selected video, including IDs, classes, colors,
both box types under the same identity, coordinates, frame times, gaps,
corrections and relevant edit history. JSON v2 has a paired `frame_annotations`
list and a per-box `annotation_index`. See the README for a Python example.
**Help → Back up project** downloads a **Project backup ZIP** that preserves the complete project data (including all related
videos in older multi-video projects), without copying the video files. JSON
is for annotation delivery; it is not a project-restore format. Back up the app's
data directory with the app closed to preserve everything, including video caches.

# Deleting an old video

Open **All videos**, then click **Delete video** below the video's card. Check
the filename in the confirmation and click **Delete video and annotations**.
This permanently removes its working annotations and cached frames from the app;
your original video file and previously downloaded exports are kept. Download a
backup first if needed. Processing/export jobs must finish before deletion.
