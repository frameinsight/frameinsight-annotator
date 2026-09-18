# Keyboard and mouse — visible-person mode

| Shortcut | Action |
|---|---|
| N | New person; use once per identity |
| I | Assign or edit numeric person ID |
| F / D | Next / previous exact source frame |
| Shift+F / Shift+D | Forward / back ten frames |
| K | Fill between the selected person's keyframes |
| C | Copy previous visible box as a draft within the same segment |
| Enter | Next frame; boxes save automatically |
| Ctrl/Cmd+Enter | Whole-frame completeness dialog |
| G / H | Start invisible gap / resume with identity decision |
| T | Finish the visible segment at this frame |
| O | Toggle optional external occlusion flag |
| Delete | Clear the current visible box |
| Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z | Undo / redo, including generated boxes |
| Escape | Cancel gesture or close dialog |
| Space | Tap to play/pause; hold and drag to pan |
| 0 | Fit image |
| ] | Next observation needing review |
| ? | Search commands and remap shortcuts |

Drag to draw a missing visible box. Drag inside the selected box to move it; drag an edge or corner to resize. **Alt+drag** replaces the box. Correcting an interpolated box makes a keyframe. The toolbar's **Auto-interpolate** checkbox controls automatic filling; K can fill existing spans explicitly.

Scroll to zoom around the cursor. Handles keep a fixed screen-space hit tolerance. Click a visible-person proposal to attach it; Alt+click cycles overlapping candidates.

F/D during a drag commits to its starting frame before navigation. Shortcuts are ignored in text fields, during IME composition and inside dialogs. Repeated destructive keys are ignored; repeated frame stepping is capped at about 12.5 steps/s. Remappings are saved per browser.

A/B selection and E/R/U full-extent commands are hidden and inactive in this simplified workflow.

No per-person approval button or shortcut is required. Whole-frame completeness for exports checks all boxes together. Current-frame rectangles are solid; optional previous-frame ghosts remain faint and dashed, and are off by default.
