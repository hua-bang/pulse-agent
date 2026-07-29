# Scheduled task controls — design QA

- Source visual truth: the two annotated Scheduled screenshots supplied with this task (`codex-clipboard-115a…png` and `codex-clipboard-080a…png`).
- Implementation screenshots: `docs/design-qa-assets/scheduled-controls-list.png` (list) and `docs/design-qa-assets/scheduled-controls-chat.png` (Chat).
- Full-view comparisons: `docs/design-qa-assets/scheduled-controls-list-comparison.png` and `docs/design-qa-assets/scheduled-controls-chat-comparison.png`.
- Source pixels: 3024 × 1898. Implementation pixels: 2400 × 1544.
- Implementation CSS viewport: 1200 × 772 at device scale factor 2.
- Density normalization: both sides were downsampled to 900 pixels high before side-by-side review.
- State: the source uses a completed real task; the disposable demo profile has no model credentials or run history. Data-state differences were not treated as visual regressions. The comparison targets are the list controls and removal of the duplicate Chat header card.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: all action names are now visible at 11px with the existing Canvas button weight; no icon requires guessing.
- Spacing and layout rhythm: the whole task row shares one hover surface and baseline. The former grey task block/white action-strip split is gone.
- Colors and visual tokens: buttons, borders, task states, and hover treatment reuse existing Canvas tokens and the blessed Button component.
- Image quality and asset fidelity: no new imagery is required. Phosphor icons remain sharp at 2× density; no handcrafted assets were added.
- Copy and content: the row exposes `Resume`/`Pause`, `Run now`, and `Edit task`; user-created tasks additionally expose `Delete task`. Clicking the task body opens its Chat.
- Task Chat: the duplicate definition/cadence/actions card is absent. Existing automation messages and results remain owned by the durable chat history; the demo capture is empty only because the reset profile has no prior run.

The two full-view comparisons keep the controls legible, so a separate crop was not needed.

## Comparison history

1. User capture showed an ambiguous chat icon plus unlabeled play/edit icons, and hover styling split one row into two surfaces.
2. Replaced the mixed controls with persistent text-labelled actions and made the row hover treatment continuous.
3. User capture showed duplicated task definition above the same definition in chat history.
4. Removed the fixed Chat banner and captured the dedicated task Chat with only its title, conversation area, and follow-up composer.

## Primary interactions checked

- Opened the stable Scheduled tab in the native Electron harness.
- Verified the task body remains the dedicated Chat entry point.
- Verified Resume, Run now, and Edit task are separately focusable, labelled controls.
- Opened the task Chat and confirmed the duplicate top card is absent.
- Focused Scheduled component tests passed; renderer and main TypeScript checks passed.
- The disposable profile has no configured model, so a new live task run was not sent.

## Follow-up polish

- P3: if task rows become substantially denser, secondary actions can move into an overflow menu while keeping Run now visible.

final result: passed

---

# Spatial-inspired workspace shell — design QA

## Visual sources

- Source visual truth:
  `/Users/jasperhu/project/pulse-agent/apps/canvas-workspace/.harness/spatial-reference.png`
  - 1223 × 768 pixels.
  - Current Spatial desktop app, captured through the macOS app surface.
- Implementation:
  `/Users/jasperhu/project/pulse-agent/apps/canvas-workspace/.harness/spatial-mono-light-toolbar-final.png`
  - 2400 × 1544 pixels.
  - Pulse Canvas production build at a 1200 × 772 CSS viewport and device
    scale factor 2.
- State: Spatial shows a freeform personal board; Pulse Canvas shows the
  harness demo workspace with the product sidebar and one Frame. Content and
  navigation differences are intentional. The comparison targets the shared
  visual grammar: canvas temperature, paper-object contrast, typography,
  elevation, frame saturation, and floating controls.

## Findings

No actionable P0, P1, or P2 differences remain for the intended adaptation.

- Fonts and typography: app chrome keeps Pulse's monospaced identity rather
  than copying Spatial's system-sans treatment. Reading surfaces retain the
  quieter humanist sans stack, so node content remains legible at overview
  scale.
- Spacing and layout rhythm: Pulse keeps its denser sidebar and creation rail
  because Coding, Terminal, and Agent tools need persistent discoverability.
  Cards remain generously separated and the bottom controls now read as
  independent floating objects rather than a fixed application footer.
- Colors and visual tokens: the former warm canvas is replaced by a cool
  neutral grey. Borders and ink are neutral rather than brown-grey, Frames use
  a whisper tint instead of a large saturated wash, and sidebar selection is
  neutral. Pulse blue remains limited to meaningful state and identity.
- Image quality and asset fidelity: no new raster or vector assets were needed.
  Existing product icons remain sharp at 2× density, and no placeholder,
  handcrafted SVG, or CSS illustration was introduced.
- Copy and content: product copy and node content are unchanged. The redesign
  changes presentation only.

The final full-view capture keeps the palette, cards, toolbar, and type
hierarchy legible, so a separate focused crop was not needed.

## Comparison history

1. Baseline Pulse Canvas used a warm grey canvas, brown-grey ink, monospaced
   app chrome, visibly colored Frame washes, and a white creation toolbar.
2. First pass introduced the cool neutral palette, system-sans chrome, softer
   Frame color, neutral sidebar selection, translucent white zoom controls, and
   cooler elevation.
3. Side-by-side review showed that the white creation rail still made the shell
   read primarily as the previous Pulse design.
4. A charcoal creation rail was tested, but it competed too strongly with the
   workspace content. User review also confirmed that Mono is part of Pulse's
   visual identity.
5. The final pass restores Mono app chrome and uses a translucent white
   creation rail. Spatial's cool-grey work surface, white-paper objects, softer
   Frames, and restrained elevation remain.

## Primary interactions checked

- Launched the production Electron build in the disposable demo profile.
- Confirmed the live WebView remained registered and rendered after the global
  palette and typography changes.
- Switched the floating toolbar from Select to Pan and confirmed the active
  treatment moved to the selected tool.
- Inspected the renderer screenshot at the production 1200 × 772 viewport.
- Checked Electron logs; no renderer or WebView errors were emitted.
- TypeScript, UI-reuse governance, file-size governance, and Canvas contract
  checks passed.

## Follow-up polish

- P3: review one dense real workspace at Fit and close zoom before deciding
  whether the cool canvas should move one step darker.
- P3: review the light creation rail over very pale node content to confirm the
  separation remains sufficient at every zoom level.

final result: passed

---

# Scheduled run feedback and dock-responsive rows — design QA

- Source visual truth: the annotated follow-up screenshot `codex-clipboard-54a8…png`.
- Implementation capture: native Electron harness session `harness-2026-07-26T14-59-06-100Z`, at a 1200 × 772 CSS viewport and 2× device scale.
- Review method: the source and implementation captures were normalized to the same height and inspected in one side-by-side comparison.

## Findings

No actionable P0, P1, or P2 visual differences remain.

- Opening Pulse AI now switches the Scheduled list to a dock-aware compact row layout. Task metadata stays with the task body and the labelled actions move onto their own line, so controls no longer overlap.
- Run now immediately disables itself and changes to a spinning `Running…` state, preventing duplicate launches.
- The scheduled Pulse AI conversation shows a running status strip until the background turn finishes. A failed run exposes its error in the same location and through the existing app notification.
- While a run is pending, the message stream also shows a lightweight Pulse AI reply with animated dots and explicit progress copy in the spot where the result will appear.
- When the run finishes, the conversation remounts from durable scheduled history so the result and follow-up composer are visible.
- The implementation reuses the shared spinner keyframe, design tokens, Button component, and Phosphor icons.

## Primary interactions checked

- Seeded two tasks in the disposable demo profile and opened Scheduled.
- Clicked Run now and confirmed the right-dock Pulse AI tab opened a fresh scheduled conversation.
- Confirmed the narrow Scheduled list kept both task rows and all actions readable with no overlap.
- Confirmed the in-conversation progress reply remains aligned with ordinary assistant messages and disappears when the pending state ends.
- Confirmed the completed turn appeared in Pulse AI and remained available for follow-up.
- Focused Scheduled/service/governance tests, TypeScript checks, and the production build passed.

final result: passed

---

# Scheduled Pulse AI handoff and prompt generation — design QA

- Source visual truth: the two annotated screenshots supplied for the follow-up (`codex-clipboard-a141…png` and `codex-clipboard-4435…png`).
- Implementation screenshots: `docs/design-qa-assets/scheduled-pulse-ai-list.png` (Scheduled list), `docs/design-qa-assets/scheduled-pulse-ai-editor.png` (task editor), and `docs/design-qa-assets/scheduled-pulse-ai-run-now.png` (Run now in Pulse AI).
- Combined comparisons: `docs/design-qa-assets/scheduled-pulse-ai-list-comparison.png` and `docs/design-qa-assets/scheduled-pulse-ai-editor-comparison.png`.
- Implementation CSS viewport: 1200 × 772 at device scale factor 2.

## Findings

No actionable P0, P1, or P2 visual differences remain.

- The redundant bottom-right Pulse AI launcher is no longer rendered on Scheduled; Pulse AI remains available through Run now.
- Run now expands the existing right-dock Pulse AI tab and displays the scheduled task's dedicated conversation rather than navigating to a second chat page.
- The editor preserves the existing field rhythm. `Write with AI` sits on the Instructions label row, uses the shared Button and Phosphor Sparkle icon, and keeps generated copy editable.
- Empty task name/instructions correctly disables AI generation and Save; generated text is returned to the existing textarea.
- No new image assets, custom SVGs, color values, or radius values were introduced.

## Primary interactions checked

- Opened Scheduled in the native Electron harness and confirmed the floating launcher is absent.
- Opened Create task and confirmed AI generation is discoverable without increasing modal width.
- Clicked Run now and confirmed Pulse AI opens as a dock tab with the scheduled task prompt, result, session controls, and follow-up composer.
- Focused Scheduled/RightDock tests, renderer/main TypeScript checks, and the production build passed.

final result: passed

---

# A3 content-node production design QA

## Visual sources

- Design target: `/Users/jasperhu/project/pulse-agent/.design-prototypes/card-system-costs/public/a3-current-canvas.png`
  - 1149 × 896
  - A3 overview state with Note, Text, and Web treatments on the current Canvas composition.
- Rejected real-canvas state: `/var/folders/47/8lvrntxs52xdcrv32zkfrwww0000gn/T/codex-clipboard-9dd22c3f-ee6f-4077-aa23-028667e40489.png`
  - 3024 × 1896
  - User-provided production screenshot that exposed the first implementation's weak hierarchy.
- Corrected production implementation: `/Users/jasperhu/project/pulse-agent/apps/canvas-workspace/.harness/design-qa/content-nodes-a3-v2-collapsed.png`
  - 2536 × 1736 system capture
  - Built Electron app using a disposable clone of workspace `ws-1779593150588`.
- Overview verification: `/Users/jasperhu/project/pulse-agent/apps/canvas-workspace/.harness/design-qa/content-nodes-a3-v2-fit.png`
  - Confirms Note cards and the Web node at whole-canvas scale.

## State and scope

- Production workspace data is a read-only clone; a disposable Text node was added only inside the clone to inspect its selected state.
- Verified node treatments:
  - Note: long Markdown document, fixed card height, internal scrolling.
  - Text: chrome-free body, auto-height behavior, editing/selected surface.
  - Web: live page, page title/favicon/URL controls, no redundant generic iframe badge.
- Frames, terminal nodes, canvas navigation, storage shape, and Webview behavior are unchanged.

## Findings

- P0: none.
- P1: none.
- Resolved P2: the first implementation kept the node title at 18px/700 above an equally prominent Markdown heading, so the screenshot still read as a traditional document panel with duplicate hierarchy.
- Resolved P2: persistent timestamps and visible scrollbar thumbs added low-value chrome to every Note.
- Corrected Note treatment makes the node title a quiet 12px metadata line, leaves the Markdown heading as the only primary title, hides timestamps/scrollbars until interaction, reduces radius to 14px, and flattens elevation.
- Text remains chrome-free and auto-height; its selected state now uses one shared focus ring instead of a stacked double halo.
- Web keeps live-page behavior and operational controls, but uses a compact 12px header and no generic type badge.

## Verification history

1. The first clone-only comparison was incorrectly accepted.
2. The user's real production screenshot showed that the visual hierarchy was still largely unchanged; that result was rejected.
3. Reworked title hierarchy, interaction-only metadata, scroll chrome, typography, corner radius, and elevation.
4. Recaptured the same cloned workspace at 82% with the sidebar collapsed, matching the user's visible canvas state.
5. Used Fit overview to verify the Web card and overall frame/card relationship; Electron logs remained clean.

## Spatial source-of-truth correction (2026-07-29)

The prior v2 pass was too strongly grounded in the user's production
screenshot and not strongly enough in `spatial-card-series.html` plus
`spatial-visual-system.html`. It borrowed the quiet hierarchy but missed
several explicit rules from those sources.

The corrected pass maps the reference system into production as follows:

- Note / Text / Web use the Spatial content-object elevation family and
  18px card radius where a card surface exists.
- Hover lifts content objects by 3px; dragging adds 1.02 scale, -1.5deg
  rotation, and stronger elevation.
- Current-object selection is a dedicated purple 2px outline with 3px
  offset, replacing node-local blue halos.
- A Note's node title is an 11px mono eyebrow. The Markdown `h1` remains
  the single primary title at approximately 27px / 590.
- Long-form Note content uses the paper-object spacing model: 40px reading
  gutters on wide nodes, 32px at the current 520px card tier, and Chinese
  body copy at 1.7 line-height.
- Negative tracking was removed from Markdown headings because the visual
  system explicitly warns against compressing Chinese display text.
- Text remains a chrome-free, auto-height object and Web remains a live
  browser surface. The reference's visual grammar was adopted without
  replacing the product's existing interaction and runtime models.

Verification:

1. `pnpm --filter canvas-workspace typecheck` passed.
2. `pnpm --filter canvas-workspace build` passed.
3. The running Electron Canvas was inspected after HMR at Fit / 50%;
   Note hierarchy, long-form density, Web identity, and whole-canvas
   relationship remained readable.
4. UI reuse governance improved from 1822 to 1814 hardcoded color literals
   and from 144 to 141 shadow literals; the ratchets were lowered.

## Content-card spacing correction (2026-07-29)

Follow-up inspection at close zoom showed three proportional issues that were
easy to miss at Fit:

- The Spatial purple selection outline overlapped the Canvas blue selection
  treatment. Content nodes now use the existing Canvas blue accent as their
  sole selection color, and the overview hairline excludes selected Note /
  Web nodes so it cannot replace or stack with the active ring.
- Note eyebrow top padding was reduced from 28px to 18px. The card retains an
  editorial opening without spending a full content-spacing tier above UI
  metadata.
- Note content now reserves a stable 16px footer inset. This is separate from
  the editor's end-of-document padding, so the visible scroll viewport never
  terminates directly against the rounded card edge.
- Newly wrapped Frames reserve a 64px lower inset instead of 40px. At the
  common 44% overview zoom this remains a visible ~28px footer rather than
  collapsing to an ~18px line. Existing saved Frame bounds remain untouched.

## Drag motion reference (2026-07-29)

The supplied 7.47s interaction recording was sampled across pickup, travel,
and release. The final implementation keeps its elevation rhythm without
changing card geometry:

- Pickup: a wider elevation shadow, with size and axis unchanged.
- Travel: the pose stays stable while the node's existing position transform
  remains directly pointer-driven; no positional easing is introduced.
- Release: shadow settles back over 220ms.
- The dragged object stays fully opaque and uses a wider 32px / 72px shadow.
- Reduced-motion users receive the same position-only dragging.

### Drag placement correction

The first motion pass translated the positioned node wrapper by -6px while
dragging and -3px while hovered. Canvas persistence correctly stored the
untranslated `x` / `y`, but the preview and resting render used different
visual coordinate offsets, so release appeared to move the card.

Hover and drag no longer translate the positioned wrapper. Elevation is now
expressed only through shadow; the pointer-driven
position preview and the persisted resting position share the same origin.

### Tilt removed

The fixed -1.2deg drag rotation was removed after interaction review. Dragging
keeps the card axis-aligned through pickup, travel, and release.

### Scale removed

The remaining 1.025 drag scale expanded a 520px card by roughly 13px around
its center. Users aligning the preview edge therefore saw a 6–8px correction
when the card returned to its persisted, unscaled bounds. Dragging now changes
shadow only, so preview bounds and resting bounds are pixel-identical.

### Geometry-safe motion restored

Selected Note, Text, and Web nodes now retain their hover elevation instead
of having it overwritten by the selected rule. Pickup transitions to a
stronger two-layer drag shadow over 200ms, while the node's transform, size,
and coordinate origin stay unchanged.

### Interaction weight correction

The content-card selection treatment now follows the lighter Coding Agent
interaction: one translucent blue hairline instead of a solid 2px outline
offset from the card. New Notes start at 360×240 rather than 420×360 so short
Markdown does not sit in a large empty square; existing resized Notes retain
their saved dimensions.

### Positioned-wrapper geometry invariant

A follow-up regression showed that even a 1.006 hover scale changes the
visible edge relative to the persisted node coordinates. Release immediately
restored hover, so the card appeared to land off target despite correct stored
coordinates. Note, Text, and Web wrappers now keep identical geometry through
pickup, travel, release, and the post-drop pointer dwell. A regression test
guards those wrapper selectors.

### Hover scale with post-drop suppression

Hover may scale Note, Text, and Web nodes to 1.006, but crossing the drag
threshold immediately restores 1:1 geometry. When dragging ends, a local
suppression class prevents hover scale from returning under the stationary
pointer. Suppression clears after the pointer leaves, or on the next genuine
hover cycle when the drop ended outside the card and no suppression was
needed. A browser-generated mouseenter after release only updates pointer
containment and cannot clear suppression; mouseleave is the sole unlock event.
Drag travel and the persisted resting position therefore use the same
geometry.

### Hover scale deferred

The hover-scale experiment and its post-drop suppression state were removed
after interaction testing. Note, Text, and Web now use the original
geometry-invariant model again: hover, pickup, travel, and release change only
surface, border, and shadow. This keeps the interaction quiet and removes an
entire pointer-event state machine from the node wrapper.

final result: passed
