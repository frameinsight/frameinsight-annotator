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
| Shift+G | Delete boxes in a hidden frame range and prevent interpolation there |
| G | Start a gap when the person disappears |
| H | Resume when they return |
| T | End this person's track at the current frame |
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

# Removing boxes while a person is completely hidden

You can draw before and after the hidden section, let interpolation fill the
middle, then remove the hidden frames in one action:

1. Select the person on the left.
2. Click **Mark hidden range** above the video, or press **Shift+G**.
3. Enter the **first hidden frame** and **last hidden frame**. Both are included.
4. Check the person and number of boxes shown, then click
   **Delete boxes & mark hidden**.

For example, keep the last visible box at **39** and the first returning box at
**60**, then mark **40–59** hidden. Only this person's boxes in that range are
removed. Their ID stays the same, and interpolation cannot refill the gap.
You do not need to press G/H separately for this workflow. Drawing resumes
outside the range; **Go to frame 60** on the gap banner jumps to its end.

**Ctrl+Z** restores the entire change, including removed boxes; **Ctrl+Shift+Z**
reapplies it. Correcting the range can be done by Undo followed by marking the
right range. Use this only when the person is completely hidden; keep a box
around visible parts when they are partly visible. Eye/Focus only change what
you see and do not create hidden intervals in the annotations.

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
