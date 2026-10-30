# Mobile editor adaptation

## Scope and interaction model

At widths up to 760 CSS pixels the editor starts with the diagram canvas visible and the structure panel closed. The structure control opens a dismissible drawer. Desktop panel preferences remain independent when crossing the breakpoint. Menu categories and tools remain available in horizontally scrollable, finger-sized rows instead of disappearing.

Touch starts in **Navigate** mode: drag with one finger to pan and use two fingers to zoom around their midpoint. **Edit objects** switches a single finger to the existing object-selection and movement workflow. An eight-pixel movement threshold avoids incidental tap jitter. Table editing remains available through the structure drawer and existing object editing controls. Two-finger navigation is available in either mode and in read-only diagrams.

Adding a second finger cancels the active object drag/resize/link operation and releases edit locks. Late asynchronous lock grants are rejected using an interaction generation guard. Removing one finger rebases the navigation gesture instead of resuming object editing unexpectedly. Pointer cancellation clears the active interaction. Mouse/keyboard navigation and the server authorization boundary remain unchanged.

## Verification

Automated tests cover touch coordinate offsets, single-finger panning, pinch anchoring, zoom bounds, coincident fingers and rebasing, alongside the existing server, import and collaboration regression suites. Whole-repository lint and the production build must pass before publication.

The current execution environment cannot launch a browser: earlier ordinary Chromium launch was blocked by sandbox socket restrictions and an escalated attempt failed during environment setup. No repeated bypass was attempted. Source review and gesture math tests do not replace real touch-device acceptance.

## Device acceptance checklist

- At 320, 390 and 430 pixels, confirm the canvas is visible on entry and no page-level horizontal overflow appears.
- Open/close the structure drawer through its button, close button, backdrop and Escape where available; edit a table and return to the diagram.
- Scroll menu/tool rows and open dialogs. Verify their footer actions remain accessible with the phone keyboard open.
- Pan with one finger. Pinch in/out while moving the midpoint. Lift either finger first and continue panning without jumping.
- Switch to Edit objects, tap/select, move a table, then undo. Add a second finger during drag and during pending collaboration-lock acquisition; ensure cancellation does not leave a lock or unintended edit.
- Interrupt a gesture (app switch or OS cancellation), return and start another gesture.
- Verify read-only/public links can navigate but cannot edit.
- Rotate portrait/landscape and return to desktop width; confirm the desktop layout and mouse interactions remain usable.
