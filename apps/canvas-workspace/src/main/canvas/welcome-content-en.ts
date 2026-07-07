import type { WelcomeContent } from './welcome-content-types';

const DOWNLOAD_URL = 'https://pulse-canvas-download.pages.dev/';
const REFERENCE_PAGE_URL = 'https://developer.mozilla.org/en-US/docs/Web/Performance/Lazy_loading';

const CARD_BASE_CSS = `
html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
kbd{background:#f6f8fa;border:1px solid #d0d7de;border-bottom-width:3px;border-radius:6px;padding:2px 7px;font-size:12px;font-family:ui-monospace,SFMono-Regular,monospace;white-space:nowrap}
table{width:100%;border-collapse:collapse;font-size:14px}
td{padding:9px 12px;border-bottom:1px solid #eaeef2;color:#1f2328}
td:first-child{width:46%;color:#57606a}
h2{margin:0 0 12px;font-size:18px;color:#1f2328}
.wrap{padding:22px 26px;box-sizing:border-box;background:#fff;height:100%;overflow:auto}
`;

const SLOGAN_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 42px;box-sizing:border-box;background:linear-gradient(135deg,#4f6ef7 0%,#7c4ff7 55%,#b44ff7 100%);color:#fff}
h1{margin:0 0 10px;font-size:36px;letter-spacing:.5px}
p{margin:0;font-size:17px;opacity:.94}
.sub{margin-top:8px;font-size:13px;opacity:.75}
</style></head><body><div class="card"><h1>Pulse Canvas</h1><p>A workspace for thinking with AI</p><p class="sub">Notes · Web pages · Mindmaps · Terminals · Agents — all on one canvas</p></div></body></html>`;

const BASICS_CARD_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${CARD_BASE_CSS}</style></head><body><div class="wrap">
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
<p style="margin:14px 0 0;font-size:13px;color:#57606a">This card is itself an HTML web node — web pages live on the canvas too.</p>
</div></body></html>`;

const SHORTCUTS_CARD_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${CARD_BASE_CSS}</style></head><body><div class="wrap">
<h2>⌨️ Global shortcuts</h2>
<table>
<tr><td>Command palette</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>K</kbd> or <kbd>Cmd/Ctrl</kbd> + <kbd>H</kbd></td></tr>
<tr><td>Search canvas &amp; notes</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>F</kbd></td></tr>
<tr><td>Open AI Chat</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>A</kbd></td></tr>
<tr><td>Group / ungroup</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>G</kbd> / <kbd>Cmd/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd></td></tr>
<tr><td>Duplicate node</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>D</kbd></td></tr>
<tr><td>Focus / exit</td><td><kbd>F</kbd> / <kbd>Esc</kbd></td></tr>
</table>
</div></body></html>`;

export const WELCOME_CONTENT_EN: WelcomeContent = {
  frames: {
    welcome: '01 · Welcome',
    basics: '02 · Canvas Basics',
    organize: '03 · Organize Information',
    ai: '04 · Work with AI',
    advanced: '05 · Power Workflow',
  },
  notes: {
    welcome: {
      title: 'Welcome to Pulse Canvas',
      filename: 'welcome-to-pulse-canvas.md',
      content: `# Welcome to Pulse Canvas

Pulse Canvas is a local-first visual workspace: notes, web pages, mindmaps, terminals, and AI agents all live on the same canvas.

This canvas is the tutorial. Meet your guide — **Riley**, a front-end engineer using Pulse Canvas to plan a website revamp. Walk the 5 zones from left to right and see how she puts ideas, references, and AI to work side by side.

Every node here can be dragged and edited freely. You can't break anything — this canvas is yours.

Ready? Head right →
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
    solution: {
      title: 'Plan: faster first paint',
      filename: 'homepage-speedup-plan.md',
      content: `# First-paint speedup plan

Riley expanded the 💡 idea on the left into this plan:

1. Lazy-load the hero images
2. Skeleton placeholders to reduce layout shift
3. Move static assets to a CDN

👈 That **edge** on the left was drawn by hand: select a node, drag from an edge anchor, and drop onto the target. Ideas now have somewhere to go.
`,
    },
    kanban: {
      title: 'A lightweight kanban with Frames',
      filename: 'kanban-with-frames.md',
      content: `# A lightweight kanban with Frames

Riley's trick: create three Frames — “📚 References”, “🚧 In progress”, “✅ Done” — and dragging nodes between them becomes your status flow.

Frames can also:

- Be renamed with a double-click
- Collapse their contents out of the way
- Hold a group: select nodes and press \`Cmd/Ctrl+G\` first
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
2. \`Expand the “Website revamp” mindmap one more level\`
3. Select the two material nodes on the right, then ask: \`Merge the information in these two nodes into one conclusion\`

> No model configured yet? Open **Settings → Models** and add an OpenAI-compatible or Anthropic-compatible provider with your API key.
`,
    },
    context: {
      title: 'Selection is context',
      filename: 'select-then-ask.md',
      content: `# Selection is context

Select nodes before you ask — the input turns into “Ask about these nodes...” and the AI works only on what you selected.

**Try it**: Shift-click the “Meeting notes” and “User feedback” nodes on the right, then ask the AI to merge them into one conclusion.
`,
    },
    meeting: {
      title: 'Meeting notes · Website revamp',
      filename: 'meeting-notes-website-revamp.md',
      content: `# 6/30 Website revamp kickoff

- **Goal**: ship the new homepage in two weeks
- **Decision**: first-paint performance over visuals
- **Open question**: scope of mobile support
- **Risk**: design mockups won't land until 7/3
- **Owner**: Riley
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
    loop: {
      title: "Riley's full work loop",
      filename: 'a-real-work-loop.md',
      content: `# Riley's full work loop

1. Write goals and to-dos in a Note (like zone 02)
2. Drop reference pages next to it as Web nodes (like zone 04)
3. Ask AI Chat to summarize the canvas and draft a plan
4. Execute — open a terminal or a locally-installed CLI tool on the canvas when needed
5. Distill results back into a Note and start the next round

Information on the left, action on the right, AI threading them together — that's how Pulse Canvas works.
`,
    },
  },
  texts: {
    guide: {
      title: 'Start here',
      content: '**Start here, head right →**\n\n5 zones · 5 minutes',
    },
    practice: {
      title: 'Sticky',
      content: '👋 Double-click me and change a few words',
    },
    idea: {
      title: 'Idea',
      content: '💡 Idea: the homepage loads too slowly — users are dropping off',
    },
    edgeTeach: {
      title: 'Edges',
      content: '👆 That line is an **Edge**: select a node and drag from an edge anchor',
    },
    frameIntro: {
      title: 'What is a Frame',
      content:
        'These big colored boxes are **Frames** — regions that gather related nodes.\n\nThis zone stars Riley\'s “Website revamp” project: a mindmap to shape the structure, then a kanban to drive execution.',
    },
    aiOpen: {
      title: 'Open AI Chat',
      content: '`Cmd/Ctrl+Shift+A` opens the AI Chat on the right (or click the Pulse icon, bottom-left)',
    },
    feedback: {
      title: 'User feedback',
      content: '🗣 From user feedback: “I didn\'t know where to click at first” · “Homepage images load slowly”',
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
  iframes: {
    slogan: { title: 'Pulse Canvas', html: SLOGAN_HTML },
    download: { title: 'Pulse Canvas Download', url: DOWNLOAD_URL },
    referencePage: { title: 'Reference · Image lazy loading', url: REFERENCE_PAGE_URL },
    basicsCard: { title: 'Canvas basics', html: BASICS_CARD_HTML },
    shortcuts: { title: 'Global shortcuts', html: SHORTCUTS_CARD_HTML },
  },
  mindmap: {
    title: "Riley's project mindmap",
    root: {
      text: 'Website revamp',
      children: [
        {
          text: '🎯 Goals',
          children: [{ text: 'New homepage in 2 weeks' }, { text: 'First paint < 2s' }],
        },
        {
          text: '📚 References',
          children: [{ text: 'Competitor screenshots' }, { text: 'User feedback' }, { text: 'Perf report' }],
        },
        {
          text: '✅ To-dos',
          children: [{ text: 'Information architecture' }, { text: 'Visual design' }, { text: 'Lazy-loading work' }],
        },
      ],
    },
  },
  edges: {
    ideaToSolution: 'expand into a plan',
    contextToMeeting: 'try selecting these two',
  },
};
