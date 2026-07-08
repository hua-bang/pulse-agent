import type { WelcomeContent } from './welcome-content-types';

const DOWNLOAD_URL = 'https://pulse-canvas-download.pages.dev/';

/** Shared look for the HTML cards: same font stack, kbd chips, soft panels. */
const BASE_CSS = `
html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}
kbd{background:#f6f8fa;border:1px solid #d0d7de;border-bottom-width:3px;border-radius:6px;padding:2px 7px;font-size:12px;font-family:ui-monospace,SFMono-Regular,monospace;white-space:nowrap}
.wrap{padding:22px 26px;background:#fff;height:100%;overflow:auto}
.wrap h2{margin:0 0 14px;font-size:18px;color:#1f2328}
.muted{font-size:12.5px;color:#57606a}
`;

const HERO_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
.hero{position:relative;height:100%;overflow:hidden;display:flex;flex-direction:column;justify-content:center;padding:0 48px;background:linear-gradient(135deg,#4f6ef7 0%,#7c4ff7 55%,#b44ff7 100%);color:#fff}
.blob{position:absolute;border-radius:50%;background:rgba(255,255,255,.13);animation:float 9s ease-in-out infinite}
.b1{width:200px;height:200px;right:-50px;top:-70px}
.b2{width:130px;height:130px;right:140px;bottom:-56px;animation-delay:3s}
.b3{width:70px;height:70px;left:-24px;bottom:30px;animation-delay:5s}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(16px)}}
h1{margin:0 0 10px;font-size:44px;letter-spacing:.5px}
.tag{margin:0;font-size:18px;opacity:.95}
.chips{display:flex;gap:10px;margin-top:20px}
.chip{padding:6px 15px;border:1px solid rgba(255,255,255,.5);border-radius:999px;font-size:13px}
</style></head><body><div class="hero"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
<h1>Pulse Canvas</h1><p class="tag">A workspace for thinking with AI</p>
<div class="chips"><span class="chip">🏠 Local-first</span><span class="chip">🧩 Everything is a node</span><span class="chip">🤖 AI-native</span></div>
</div></body></html>`;

const FEATURE_GRID_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:22px;height:100%;background:#fafbfc;overflow:auto}
.tile{background:#fff;border:1px solid #e6e8ec;border-radius:14px;padding:16px 18px;transition:transform .15s,box-shadow .15s}
.tile:hover{transform:translateY(-3px);box-shadow:0 8px 20px rgba(31,35,40,.10)}
.emoji{font-size:26px}
.tile h3{margin:8px 0 4px;font-size:15px;color:#1f2328}
.tile p{margin:0;font-size:12.5px;color:#57606a;line-height:1.55}
</style></head><body><div class="grid">
<div class="tile"><div class="emoji">📝</div><h3>Notes are files</h3><p>Note content is saved as local Markdown — your data stays yours.</p></div>
<div class="tile"><div class="emoji">🌐</div><h3>Web on canvas</h3><p>URLs or raw HTML become nodes — this card is one.</p></div>
<div class="tile"><div class="emoji">🧠</div><h3>Mindmaps</h3><p>A whole tree in one node, and AI can grow it further.</p></div>
<div class="tile"><div class="emoji">💬</div><h3>AI Chat</h3><p>The canvas is its context — select things and just ask.</p></div>
<div class="tile"><div class="emoji">🖥</div><h3>Terminals &amp; agents</h3><p>Command lines and Claude Code / Codex live on the canvas.</p></div>
<div class="tile"><div class="emoji">🗂</div><h3>Space is structure</h3><p>Frames, edges, tags — position itself is information.</p></div>
</div></body></html>`;

const CONCEPT_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
.wrap{background:#fafbfc}
.cap{display:flex;gap:12px;margin-top:14px}
.cap div{flex:1;background:#fff;border:1px solid #e6e8ec;border-radius:10px;padding:10px 12px;font-size:12.5px;color:#57606a;text-align:center}
.cap b{display:block;color:#1f2328;font-size:13.5px;margin-bottom:3px}
</style></head><body><div class="wrap">
<h2>Three canvas essentials</h2>
<svg viewBox="0 0 640 210" width="100%" xmlns="http://www.w3.org/2000/svg">
<rect x="10" y="12" width="620" height="186" rx="16" fill="#f1f3f6" stroke="#a5b4cf" stroke-width="2" stroke-dasharray="7 5"/>
<text x="34" y="42" font-size="13" fill="#7a8699">Frame</text>
<rect x="70" y="76" width="160" height="76" rx="12" fill="#eef2ff" stroke="#5b7cbf" stroke-width="2"/>
<text x="150" y="120" font-size="15" text-anchor="middle" fill="#1f2328">💡 An idea</text>
<rect x="410" y="76" width="160" height="76" rx="12" fill="#fff" stroke="#5b7cbf" stroke-width="2"/>
<text x="490" y="120" font-size="15" text-anchor="middle" fill="#1f2328">📋 A plan</text>
<defs><marker id="ah" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0 0 L10 4 L0 8 z" fill="#7c4ff7"/></marker></defs>
<path d="M230 114 C 300 114 340 114 405 114" stroke="#7c4ff7" stroke-width="2.5" fill="none" marker-end="url(#ah)"/>
<text x="318" y="102" font-size="12.5" text-anchor="middle" fill="#7c4ff7">Edge</text>
</svg>
<div class="cap">
<div><b>Nodes</b>hold content</div>
<div><b>Edges</b>express relations</div>
<div><b>Frames</b>gather regions</div>
</div>
</div></body></html>`;

const BASICS_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
table{width:100%;border-collapse:collapse;font-size:14px}
td{padding:9px 12px;border-bottom:1px solid #eaeef2;color:#1f2328}
td:first-child{width:46%;color:#57606a}
</style></head><body><div class="wrap">
<h2>🧭 Canvas basics</h2>
<table>
<tr><td>Move a node</td><td>Drag it</td></tr>
<tr><td>Resize</td><td>Drag a corner</td></tr>
<tr><td>Rename</td><td>Double-click the title</td></tr>
<tr><td>Duplicate</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>D</kbd></td></tr>
<tr><td>Nudge position</td><td>Arrow keys (<kbd>Shift</kbd> for big steps)</td></tr>
<tr><td>Pan the canvas</td><td>Drag empty space / scroll</td></tr>
<tr><td>Zoom</td><td><kbd>Cmd/Ctrl</kbd> + scroll / pinch</td></tr>
<tr><td>Focus selection</td><td><kbd>F</kbd></td></tr>
<tr><td>Exit focus / clear selection</td><td><kbd>Esc</kbd></td></tr>
</table>
</div></body></html>`;

const KANBAN_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
.wrap{background:#fafbfc;display:flex;flex-direction:column}
.cols{display:flex;gap:12px;flex:1;min-height:0}
.col{flex:1;background:#f1f3f6;border-radius:12px;padding:10px}
.col h4{margin:2px 4px 10px;font-size:13px;color:#57606a}
.card{background:#fff;border:1px solid #e6e8ec;border-radius:10px;padding:9px 11px;font-size:12.5px;color:#1f2328;margin-bottom:8px;box-shadow:0 1px 2px rgba(31,35,40,.05)}
.hint{margin:12px 2px 0}
</style></head><body><div class="wrap">
<h2>A lightweight kanban with three Frames</h2>
<div class="cols">
<div class="col"><h4>📚 References</h4><div class="card">🌐 Competitor picks</div><div class="card">📝 Idea scraps</div></div>
<div class="col"><h4>🚧 In progress</h4><div class="card">📋 Requirements draft</div><div class="card">🧠 Project mindmap</div></div>
<div class="col"><h4>✅ Done</h4><div class="card">🎯 Goal alignment</div></div>
</div>
<p class="muted hint">Dragging nodes between Frames is your status flow. Frames rename and collapse; select nodes and press <kbd>Cmd/Ctrl</kbd>+<kbd>G</kbd> to group first.</p>
</div></body></html>`;

const CHAT_MOCK_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
.chat{display:flex;flex-direction:column;gap:12px;padding:20px 22px;background:#fafbfc;height:100%;overflow:auto;font-size:13.5px}
.bubble{max-width:84%;padding:11px 15px;border-radius:16px;line-height:1.6}
.user{align-self:flex-end;background:#4f6ef7;color:#fff;border-bottom-right-radius:5px}
.ai{align-self:flex-start;background:#fff;border:1px solid #e6e8ec;border-bottom-left-radius:5px;color:#1f2328}
.hint{align-self:center;margin-top:4px;text-align:center}
</style></head><body><div class="chat">
<div class="bubble user">Summarize this canvas and give me a next-step plan</div>
<div class="bubble ai">This canvas has 5 zones: product intro, canvas essentials, organizing, AI collaboration, and power moves.<br>Suggested next steps:<br>① Double-click the sticky in zone 02 to feel node editing<br>② Select the two material cards in zone 04 and let me merge them<br>③ Expand the “Pulse Canvas at a glance” mindmap one more level</div>
<div class="bubble user">How do you know what I selected?</div>
<div class="bubble ai">Selected nodes ride along as context with your question — that's “selection is context” 🎯</div>
<p class="muted hint">↑ This is what AI Chat looks like — press <kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> to talk to the real one</p>
</div></body></html>`;

const WORKFLOW_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
.wrap{background:#fafbfc;display:flex;flex-direction:column}
.flow{display:flex;align-items:stretch;gap:6px;margin-top:6px}
.step{flex:1;background:#fff;border:1px solid #e6e8ec;border-radius:12px;padding:14px 8px;text-align:center;font-size:12.5px;color:#1f2328;line-height:1.5}
.step .e{font-size:22px;display:block;margin-bottom:6px}
.arr{align-self:center;color:#7c4ff7;font-size:16px}
.loop{margin-top:14px;text-align:center;font-size:12.5px;color:#7c4ff7}
ul{margin:14px 0 0;padding-left:18px;font-size:13px;color:#57606a;line-height:1.8}
</style></head><body><div class="wrap">
<h2>A full work loop</h2>
<div class="flow">
<div class="step"><span class="e">📝</span>Set goals</div><div class="arr">→</div>
<div class="step"><span class="e">🌐</span>Gather refs</div><div class="arr">→</div>
<div class="step"><span class="e">💬</span>AI summary</div><div class="arr">→</div>
<div class="step"><span class="e">🖥</span>Execute</div><div class="arr">→</div>
<div class="step"><span class="e">📌</span>Distill</div>
</div>
<div class="loop">↺ Conclusions go back into a Note — next round</div>
<ul>
<li>Information on the left, action on the right, AI threading them together</li>
<li>For execution, open a terminal or a locally-installed CLI tool right on the canvas</li>
</ul>
</div></body></html>`;

const SHORTCUTS_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
table{width:100%;border-collapse:collapse;font-size:14px}
td{padding:9px 12px;border-bottom:1px solid #eaeef2;color:#1f2328}
td:first-child{width:46%;color:#57606a}
</style></head><body><div class="wrap">
<h2>⌨️ Global shortcuts</h2>
<table>
<tr><td>Command palette</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>K</kbd> or <kbd>Cmd/Ctrl</kbd> + <kbd>H</kbd></td></tr>
<tr><td>Search canvas &amp; notes</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>F</kbd></td></tr>
<tr><td>Open AI Chat</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>A</kbd></td></tr>
<tr><td>Group / ungroup</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>G</kbd> / + <kbd>Shift</kbd> + <kbd>G</kbd></td></tr>
<tr><td>Duplicate node</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>D</kbd></td></tr>
<tr><td>Focus / exit</td><td><kbd>F</kbd> / <kbd>Esc</kbd></td></tr>
</table>
</div></body></html>`;

export const WELCOME_CONTENT_EN: WelcomeContent = {
  frames: {
    welcome: '01 · Meet Pulse Canvas',
    basics: '02 · Canvas Essentials',
    organize: '03 · Organize Information',
    ai: '04 · Work with AI',
    advanced: '05 · Go Deeper',
  },
  notes: {
    welcome: {
      title: 'Welcome to Pulse Canvas',
      filename: 'welcome-to-pulse-canvas.md',
      content: `# Welcome to Pulse Canvas

Pulse Canvas is a local-first visual workspace: notes, web pages, mindmaps, terminals, and AI agents all live on the same canvas.

**This canvas is the product manual** — five zones, shallow to deep:

1. Meet Pulse Canvas (you are here)
2. Canvas essentials: nodes, edges, Frames
3. Organize information
4. Work with AI
5. Go deeper

Every node can be dragged and edited freely. You can't break anything — this canvas is yours. Head right →
`,
    },
    practice: {
      title: 'Try dragging me',
      filename: 'try-dragging-me.md',
      content: `# Drag me around

- Hold the title bar to move me
- Drag the bottom-right corner to resize
- Double-click the title to rename me
- \`Cmd/Ctrl+D\` to duplicate me

I am a **Note node**: my content is saved as a local Markdown file — great for requirements, plans, meeting notes, and summaries.
`,
    },
    answer: {
      title: "Pulse Canvas's answer",
      filename: 'one-canvas.md',
      content: `# One canvas for everything

Twenty browser tabs, three note apps, countless terminal windows… information scatters and context keeps getting lost.

Pulse Canvas's answer: **web pages, notes, and terminals all become nodes** on one canvas, with edges expressing the relations — like the line on the left.

👈 To draw one: select a node, drag from an edge anchor, drop on the target.
`,
    },
    reference: {
      title: 'Keep material within reach',
      filename: 'pin-and-reference.md',
      content: `# Keep material within reach

- The 📌 in a node's top-right corner pins it to the **Reference panel** — recall it from any canvas
- The same corner can “add to chat context”, so the AI carries it into its answers
- The **Nodes** view (left sidebar) lists every node; the **Graph** view shows relationships and tag coverage
`,
    },
    prompts: {
      title: 'Three things to ask AI first',
      filename: 'first-prompts.md',
      content: `# Three things to ask AI first

Open the AI Chat on the right (\`Cmd/Ctrl+Shift+A\`) and paste one of these:

1. \`Summarize this canvas and give me a 3-step plan for what to do next\`
2. \`Expand the “Pulse Canvas at a glance” mindmap one more level\`
3. Select the two material cards on the right, then ask: \`Merge these two nodes into one product blurb\`

> No model configured yet? Open **Settings → Models** and add an OpenAI-compatible or Anthropic-compatible provider with your API key.
`,
    },
    context: {
      title: 'Selection is context',
      filename: 'select-then-ask.md',
      content: `# Selection is context

Select nodes before you ask — the input turns into “Ask about these nodes...” and the AI works only on what you selected.

**Try it**: Shift-click the “Design principles” and “User feedback” nodes on the right, then ask the AI to merge them into one product blurb.
`,
    },
    ideas: {
      title: 'Three design principles of Pulse Canvas',
      filename: 'design-principles.md',
      content: `# Three design principles

1. **Local-first** — your data is Markdown files on your disk, never locked in a cloud
2. **Space is structure** — position, edges, and regions carry meaning; no “which folder?” up front
3. **AI-native** — the canvas is the AI's context: select things and just ask, instead of keeping AI in a side drawer
`,
    },
    project: {
      title: 'Connect the workspace to your project',
      filename: 'connect-your-project.md',
      content: `# Connect the workspace to your project

1. Sidebar → **Workspace Settings** → set a Root folder
2. Terminals and Coding Agents will then work in that directory by default (requires the CLI installed locally)
3. Use \`pulse-workspace.md\` to record goals, status, and conventions — AI Chat reads this context every turn
`,
    },
  },
  texts: {
    guide: {
      title: 'Start here',
      content: '**Start here, head right →**\n\n5 zones · shallow to deep',
    },
    practice: {
      title: 'Sticky',
      content: '👋 Double-click me and change a few words',
    },
    problem: {
      title: 'The problem',
      content: '😵 Information scattered across 20 tabs, 3 note apps, and countless terminal windows',
    },
    edgeTeach: {
      title: 'Edges',
      content: '👆 That line is an **Edge**: select a node and drag from an edge anchor',
    },
    frameIntro: {
      title: 'What is a Frame',
      content:
        'These big colored boxes are **Frames** — regions that gather related nodes.\n\nThis zone shows how Pulse Canvas organizes: mindmaps for structure, kanban for progress, references so nothing gets lost.',
    },
    aiOpen: {
      title: 'Open AI Chat',
      content: '`Cmd/Ctrl+Shift+A` opens the AI Chat on the right (or click the Pulse icon, bottom-left)',
    },
    feedback: {
      title: 'User feedback',
      content: '🗣 From users: “Finally no more window juggling” · “The AI sees what I select — so smooth”',
    },
    multiWorkspace: {
      title: 'Multiple workspaces',
      content:
        'The **+** in the left sidebar creates more workspaces; copying nodes across workspaces preserves references where possible.\n\nThis welcome canvas only appears on first launch — feel free to remodel it into your own workbench.',
    },
  },
  shape: {
    title: 'Shape',
    text: 'I am a Shape node — the toolbar also has ellipses, diamonds, and stars',
  },
  download: { title: 'Pulse Canvas Download', url: DOWNLOAD_URL },
  cards: {
    hero: { title: 'Pulse Canvas', html: HERO_HTML },
    featureGrid: { title: 'What it can do', html: FEATURE_GRID_HTML },
    concept: { title: 'Canvas essentials', html: CONCEPT_HTML },
    basics: { title: 'Canvas basics', html: BASICS_HTML },
    kanban: { title: 'Kanban with Frames', html: KANBAN_HTML },
    chatMock: { title: 'What AI Chat looks like', html: CHAT_MOCK_HTML },
    workflow: { title: 'A full work loop', html: WORKFLOW_HTML },
    shortcuts: { title: 'Global shortcuts', html: SHORTCUTS_HTML },
  },
  mindmap: {
    title: 'Pulse Canvas at a glance',
    root: {
      text: 'Pulse Canvas',
      children: [
        {
          text: '🧩 Nodes',
          children: [{ text: 'Notes / text' }, { text: 'Web / HTML' }, { text: 'Mindmaps' }, { text: 'Terminals & agents' }],
        },
        {
          text: '🗂 Organize',
          children: [{ text: 'Frames & kanban' }, { text: 'Tags & Graph' }, { text: 'Reference panel' }],
        },
        {
          text: '🤖 AI',
          children: [{ text: 'Summarize the canvas' }, { text: 'Selection is context' }, { text: 'Generate mindmaps' }],
        },
        {
          text: '💾 Data',
          children: [{ text: 'Local Markdown' }, { text: 'Multiple workspaces' }],
        },
      ],
    },
  },
  edges: {
    problemToAnswer: "Pulse Canvas's answer",
    contextToIdeas: 'try selecting these two',
  },
};
