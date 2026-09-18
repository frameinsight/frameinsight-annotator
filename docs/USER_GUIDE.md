# Annotating a video

1. Open Frameinsight. The **Your videos** screen lists your previous videos.
   Click a video to continue, or **New video** to start.
2. Choose the **number of classes**, then type each class name. A class is a
   label for a box; use the names supplied by your supervisor. Click
   **Continue to upload**, choose the video, and wait until it is ready.
3. Find the first frame where the person appears. Press **N**, then drag a
   rectangle around the visible part of them (**1 / Visible**).
4. Press **I**. Assign a person number, choose/type a class name, and choose
   a box color. Click **Save ID**. Keep the same number for the same person.
   For their full/extended rectangle, press **2 / Extended** and draw it.
   Do not press N for the second type: both belong to the same person.
   Press I again to choose the extended class and its color.
5. Move forward several frames and draw or adjust that person's box. With
   **Auto-interpolate** checked, the app fills the frames between your boxes.
6. Go back and inspect those generated boxes. Drag inside a box to move it,
   or drag a corner/edge to resize it. Correcting a box also updates nearby
   generated boxes of that type. Add more corrections where movement changes quickly.
   Switch between **1 / Visible** and **2 / Extended** to check each track.
7. Repeat for each person. Use the left panel to switch between people.
8. Changes save automatically. Click **Save** or press **Ctrl+S** whenever you
   want to check they have saved. Wait until the top bar says **Saved**.
9. When done, click **Finish**. Confirm you annotated and tracked every person,
   then choose **Annotations JSON → Prepare download → Download annotations**.
   This file contains annotations and metadata, **no video or images**.
   Keep the original video separately.

Finished videos remain editable. Making a change marks the video **In progress**
again. The Finish confirmation records your own check; it does not automatically
judge whether your boxes are correct. If you have more work to do, choose
**Keep annotating**.

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
change key bindings.

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
- If you deleted too much, draw a box again on the frame to make the person
  visible. This restores that frame without filling other deleted frames.
- **Ctrl+Z** undoes the entire action; **Ctrl+Shift+Z** redoes it.

Example: keep boxes at **39 and 60**, and delete **40–59**. The same person ID
is kept on both sides. No G/H steps are needed. When no deletion was recorded,
normal interpolation can still fill between your drawn keyframes.

The app does not guess why a person has no box. Their visibility is Not visible
and the cause is Unknown unless previously recorded. While you are still working,
Not visible can also mean you have not drawn that box yet: check the whole video
before finishing. Eye/Focus only change your display; a hidden-on-screen box
still counts as Visible in the exported annotations.

# Returning to an earlier frame

If Person 7 starts at frame 40, you can go back to frame 20, press **N**, draw
their box, then press **I** and choose Person 7. The tracks join and eligible
frames between the two boxes fill automatically. You can choose the ID before
drawing too. Gaps remain gaps. If the person already has a box on that frame,
select their existing box instead of creating another.

# Classes and downloads

Class names are your chosen labels. All classes use the same box-drawing tool.
Press **I** to choose an existing class or type a new class name. Class and color
apply to the selected box type across that person's track. New names are saved
in the class list. The Visible/Extended control chooses geometry; the class name
is its label.

**Annotations JSON** exports the selected video, including IDs, classes, colors,
both box types under the same identity, coordinates, frame times, gaps,
corrections and relevant edit history. JSON v2 has a paired `frame_annotations`
list and a per-box `annotation_index`. See the README for a Python example.
**Project backup ZIP** preserves the complete project data (including all related
videos in older multi-video projects), without copying the video files. JSON
is for annotation delivery; it is not a project-restore format. Back up the app's
data directory with the app closed to preserve everything, including video caches.

# Deleting an old video

Open **All videos**, then click **Delete video** below the video's card. Check
the filename in the confirmation and click **Delete video and annotations**.
This permanently removes its working annotations and cached frames from the app;
your original video file and previously downloaded exports are kept. Download a
backup first if needed. Processing/export jobs must finish before deletion.
