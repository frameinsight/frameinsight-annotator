# Annotating a video

1. Open Frameinsight. The **Your videos** screen lists your previous videos.
   Click a video to continue, or **New video** to start.
2. Choose the **number of classes**, then type each class name. A class is a
   label for a box; use the names supplied by your supervisor. Click
   **Continue to upload**, choose the video, and wait until it is ready.
3. Find the first frame where the person appears. Press **N**, then drag a
   rectangle around them.
4. Press **I**. Assign a person number, choose/type a class name, and choose
   a box color. Click **Save ID**. Keep the same number for the same person.
5. Move forward several frames and draw or adjust that person's box. With
   **Auto-interpolate** checked, the app fills the frames between your boxes.
6. Go back and inspect those generated boxes. Drag inside a box to move it,
   or drag a corner/edge to resize it. Correcting a box also updates nearby
   generated boxes. Add more corrections where movement changes quickly.
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
| I | Person ID, class and color; choose an old ID or create a new one |
| F / D | Next / previous frame |
| Shift+F / Shift+D | Forward / back 10 frames |
| Enter | Next frame |
| C | Copy the previous frame's box |
| K | Fill between drawn boxes |
| Shift+Delete | Delete this person’s boxes over a frame range |
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

# Visibility is automatic

**A box means Visible. No box means Not visible.** This applies to every frame
for the selected person, including frames before their first box and after
their last box. There is no separate visibility or occlusion button to press.

- **Delete** removes the selected person's box on the current frame.
- For several frames, click **Delete boxes in range** or press **Shift+Delete**.
  Enter the first and last frame, then click **Delete boxes**. Both are included.
- Deleted frames stay empty when interpolation runs again.
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
apply to that person's track. New names are saved in the class list.

**Annotations JSON** exports the selected video, including IDs, classes, colors,
box coordinates, frame times, gaps, corrections and relevant edit history.
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
