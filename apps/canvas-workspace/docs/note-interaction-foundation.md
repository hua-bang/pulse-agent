# Canvas Note interaction foundation

PR 682 is no longer a single find-bar enhancement. It is the first pass at
turning the file note node into a Notion-like editing surface. Keep the scope
focused on interaction ownership and persistence reliability; avoid adding more
block types until these foundations are predictable.

## Phase 0 scope

Keep these behaviors in PR 682:

- Find options: match case, whole word, regex, invalid-regex feedback, and
  replace behavior.
- Inline authoring: slash commands, callout, date, images from paste/drop/file,
  and node mentions.
- Navigation: heading outline and mention-click node focus.
- Keyboard ownership: note-local Cmd/Ctrl+S and Cmd/Ctrl+F only for the focused
  editor.
- Persistence safety: markdown round-trip for callouts, node links, local
  images, and empty paragraphs.

Defer these behaviors until after Phase 0:

- Drag-to-reorder blocks.
- Block handles and multi-block selection.
- Hover previews for node mentions.
- Backlinks or automatic reference indexes.
- Rich callout icon pickers and color variants.

## Interaction ownership

The note editor has one interaction controller. New note surfaces should route
through it instead of adding independent state in individual components.

| Surface | Owner | Coexists with | Closes |
| --- | --- | --- | --- |
| Slash menu | `useNoteInteractionController` | Outline | Mention, bubble, link prompt |
| Mention menu | `useNoteInteractionController` | Outline | Slash, bubble, link prompt |
| Selection bubble | `useNoteInteractionController` | Outline | Slash, mention, link prompt, find |
| Find bar | `useNoteInteractionController` | Outline | Slash, mention, bubble, link prompt |
| Link prompt | `useNoteInteractionController` | Outline | Slash, mention, bubble, find |
| Outline | `useNoteInteractionController` | Find, editor typing | Slash, mention, bubble, link prompt on toggle |

Keyboard rules:

- Slash and mention menus capture ArrowUp, ArrowDown, Enter, and Escape only
  while their menu is open.
- IME composition owns ArrowUp, ArrowDown, Enter, and Escape; note menus must not
  intercept those keys while composing.
- Cmd/Ctrl+S and Cmd/Ctrl+F are handled only by the focused note editor.
- Escape should close the active note-local surface before falling through to
  broader canvas or app surfaces.

Layering rules:

- Portal menus that are positioned against the viewport use
  `--layer-note-popover`.
- Absolute panels inside the note card use the local `--note-layer-panel`.
- Do not add new hardcoded high z-index values for note surfaces.

## Node-link semantics

Node mentions are canvas-native links, not ordinary external URLs.

- New mentions use `pulse-canvas://node/<nodeId>?workspace=<workspaceId>`.
- Legacy mentions without workspace are still valid and resolve in the active
  workspace.
- A click on a node mention dispatches the node-focus bridge.
- If the target is known to be missing in the current workspace, the note shows
  a local missing-target status instead of navigating nowhere.

## Manual QA path

Run this path before force-pushing PR 682:

1. Create or open a file note node.
2. Type `/h1`, select Heading 1 with keyboard, and confirm the slash menu closes.
3. Type `/callout`, add body text, then use Enter and Backspace around the block.
4. Type `/date` and confirm the inserted date does not reopen the slash menu.
5. Type `@`, select another canvas node, then click the mention and confirm the
   target node is selected and focused.
6. Delete the mentioned target node, click the old mention, and confirm the note
   reports a missing node without opening an external URL.
7. Paste an image from the clipboard, drag an image file into the note, and paste
   a bare image URL.
8. Select text, use the bubble menu for bold/link, then confirm the bubble does
   not appear while slash, mention, find, or link prompt is open.
9. Use Cmd/Ctrl+F in the focused note, test match case, whole word, regex,
   invalid regex, replace current, and replace all.
10. Open the outline, move the caret between headings, and confirm the active
    outline row tracks the current section.
11. Save, close/reopen the note, and confirm callouts, mentions, images, empty
    paragraphs, and headings round-trip through markdown.

## Test focus

Automated tests should stay close to pure or stable seams:

- search matching options and zero-width regex behavior;
- node-link href build/parse compatibility;
- mention detection/filtering;
- image insert helpers;
- markdown round-trip tests for custom nodes when the DOM test environment is
  installed.
