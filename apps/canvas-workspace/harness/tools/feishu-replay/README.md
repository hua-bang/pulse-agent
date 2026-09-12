# Offline Feishu replay

A no-account, no-network acceptance surface for the channel transport. It runs
**production `FeishuStream`, `FeishuRunCard`, card builders, and message helpers**
against an in-memory SDK adapter. No app credentials, bot, model, or Electron
session is used. `fetch` is blocked and asserted unused.

## Run

From the repository root:

```bash
pnpm --filter canvas-workspace exec vitest run harness/tools/feishu-replay/replay.test.ts
node apps/canvas-workspace/harness/tools/feishu-replay/preview.mjs
```

The tests write `.harness/feishu-replay/trace.json` under Canvas with the source
hash, accepted request snapshots, and simulated timings. Failed runs invalidate
the previous HTML; the generator refuses incomplete traces. The resulting
`index.html` is standalone and may be opened directly, or served over loopback:

```bash
python3 -m http.server 4318 --bind 127.0.0.1 --directory apps/canvas-workspace/.harness/feishu-replay
```

Open `http://127.0.0.1:4318`. Use **检查全部场景** to scan all recorded states at
680px and 375px card widths: text correspondence, overflow, and preservation of
collapsed panels during component updates. This is an executable browser check,
not part of the Node/Vitest pass. Capture and inspect the actual page for visual
review. **播放**, **下一步**, the slider, and the scene selector replay requests.
There is no timing compression in playback; gaps reflect the simulated clock.

## Evidence boundary

- Protocol model: checks IDs, increasing sequences, text-target existence,
  nonempty updates, topic routing, transient rejection recovery, slow-update
  coalescing, terminal timer cleanup, native timeout supersession, legacy
  permission fallback, two-message ordering, turn-scoped Stop, and long-text delivery.
- Browser model: renders the small set of components our run cards use with
  existing `markdown-it`. Unsupported component tags fail generation rather
  than disappearing. Content patches update a stable DOM node; response patches preserve the separate
  process disclosure. Clicking the preview Stop button selects a recorded Stop
  scenario, rather than cancelling a live task. It does **not**
  recreate Feishu's native typewriter or loading animations; the displayed
  `streaming_mode` is actual recorded configuration, not evidence of animation.
- Neither model proves real API acceptance, permission setup, complete platform
  schema constraints, rate-limit behavior, or client rendering fidelity. The
  sequence model follows the documented ordering contract; server enforcement
  remains an external integration check.
- Permission fallback uses old whole-message patches. Their timeout path still
  needs independent final text because they do not provide CardKit sequencing.
  Those legacy timeout regressions remain in the channel's stream tests.

The official editor redirects anonymous visitors to login. The evaluated
third-party `open-feishu-card@0.14.5` did not include `collapsible_panel` or native
streaming configuration support in its published renderer. It is therefore not
used as an acceptance oracle or added as a dependency.

References: [CardKit text updates](https://open.feishu.cn/document/cardkit-v1/card-element/content.md),
[official editor](https://open.feishu.cn/tool/cardbuilder),
[third-party package](https://www.npmjs.com/package/open-feishu-card).
