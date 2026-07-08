import type { WelcomeContent } from './welcome-content-types';
import {
  chatMockCard,
  conceptCard,
  featureGrid,
  heroCard,
  kanbanCard,
  settingsMockCard,
  stepListCard,
  tableCard,
  workflowCard,
} from './welcome-cards';

const DOWNLOAD_URL = 'https://pulse-canvas-download.pages.dev/';

const HERO_HTML = heroCard({
  nameA: 'Pulse',
  nameB: 'Canvas',
  tagline: 'A workspace for thinking with AI',
  chips: ['LOCAL-FIRST', 'EVERYTHING IS A NODE', 'AI-NATIVE'],
  frameLabel: 'FRAME',
  nodeA: '📝 Note',
  nodeB: '🌐 Web',
});

const FIRST_MINUTE_HTML = stepListCard(
  'FIRST MINUTE',
  'Learn three things in your first minute',
  [
    { icon: 'pan', n: 'STEP 01', title: 'Pan the canvas', desc: 'Hold empty space and drag — zone 02 is to the right' },
    { icon: 'zoom', n: 'STEP 02', title: 'Zoom', desc: 'Cmd/Ctrl + scroll to zoom; press F to focus a selection' },
    { icon: 'edit', n: 'STEP 03', title: 'Edit', desc: 'Double-click the yellow sticky below and change a few words' },
  ],
  '✓ Done all three? Head right →',
);

const FEATURE_GRID_HTML = featureGrid('WHAT IT CAN DO', 'What it can do', [
  { icon: 'note', title: 'Notes are files', desc: 'Local Markdown on disk' },
  { icon: 'globe', title: 'Web on canvas', desc: 'URLs & HTML as nodes' },
  { icon: 'mindmap', title: 'Mindmaps', desc: 'A tree in one node' },
  { icon: 'chat', title: 'AI Chat', desc: 'The canvas is its context' },
  { icon: 'terminal', title: 'Terminals & agents', desc: 'CLIs on the canvas' },
  { icon: 'frame', title: 'Space is structure', desc: 'Position carries meaning' },
]);

const CONCEPT_HTML = conceptCard({
  eyebrow: 'CANVAS ESSENTIALS',
  heading: 'Three canvas essentials',
  frameLabel: 'FRAME',
  nodeA: 'An idea',
  nodeB: 'A plan',
  edgeLabel: 'EDGE',
  caps: [
    { term: 'Nodes', desc: 'hold content' },
    { term: 'Edges', desc: 'express relations' },
    { term: 'Frames', desc: 'gather regions' },
  ],
});

const BASICS_HTML = tableCard(
  'BASICS',
  'Canvas basics',
  [
    { label: 'Move a node', value: 'Drag it' },
    { label: 'Resize', value: 'Drag a corner' },
    { label: 'Rename', value: 'Double-click the title' },
    { label: 'Duplicate', value: '<kbd>Cmd/Ctrl</kbd> + <kbd>D</kbd>' },
    { label: 'Nudge position', value: 'Arrow keys (<kbd>Shift</kbd> for big steps)' },
    { label: 'Pan the canvas', value: 'Drag empty space / scroll' },
    { label: 'Zoom', value: '<kbd>Cmd/Ctrl</kbd> + scroll / pinch' },
    { label: 'Focus selection', value: '<kbd>F</kbd>' },
    { label: 'Exit focus / clear selection', value: '<kbd>Esc</kbd>' },
  ],
  'This card is itself an HTML web node — web pages live on the canvas too.',
);

const KANBAN_HTML = kanbanCard(
  'ORGANIZE',
  'A lightweight kanban with three Frames',
  [
    { dot: '#8B93A3', label: 'References', items: ['Competitor picks', 'Idea scraps'] },
    { dot: '#3A63F2', label: 'In progress', items: ['Requirements draft', 'Project mindmap'] },
    { dot: '#2F9E63', label: 'Done', items: ['Goal alignment'] },
  ],
  'Dragging nodes between Frames is your status flow. Frames rename and collapse; select nodes and press <kbd>Cmd/Ctrl</kbd>+<kbd>G</kbd> to group first.',
);

const SETUP_HTML = settingsMockCard({
  eyebrow: 'STEP 0 · SETUP',
  heading: 'Set up a model first',
  nav: [{ label: 'General' }, { label: 'Models', on: true }, { label: 'Agent' }, { label: 'About' }],
  fields: [
    { label: 'Provider', value: 'Anthropic-compatible ▾' },
    { label: 'Base URL', value: 'https://api.example.com/v1' },
    { label: 'API Key', value: '••••••••••••' },
  ],
  button: 'Save & test',
  steps: ['Open Settings', 'Pick Models', 'Add provider + key', 'Come back and ask'],
  hint: 'This is Settings → Models — configure a model and the three prompts on the right will actually send.',
});

const CHAT_MOCK_HTML = chatMockCard(
  'AI CHAT',
  [
    { who: 'user', html: 'Summarize this canvas and give me a next-step plan' },
    {
      who: 'ai',
      html: 'This canvas has 5 zones: product intro, canvas essentials, organizing, AI collaboration, and power moves. Suggested next steps:<ol><li>Double-click the sticky in zone 02 to feel node editing</li><li>Select the two material cards in zone 04 and let me merge them</li><li>Expand the “Pulse Canvas at a glance” mindmap one more level</li></ol>',
    },
    { who: 'user', html: 'How do you know what I selected?' },
    { who: 'ai', html: 'Selected nodes ride along as context with your question — that is “selection is context”.' },
  ],
  '↑ This is what AI Chat looks like — press <kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> to talk to the real one',
);

const WORKFLOW_HTML = workflowCard(
  'WORKFLOW',
  'A full work loop',
  [
    { n: '01', label: 'Set goals' },
    { n: '02', label: 'Gather refs' },
    { n: '03', label: 'AI summary' },
    { n: '04', label: 'Execute' },
    { n: '05', label: 'Distill' },
  ],
  '↺ Conclusions go back into a Note — next round',
  [
    'Information on the left, action on the right, AI threading them together',
    'For execution, open a terminal or a locally-installed CLI tool right on the canvas',
  ],
);

const SHORTCUTS_HTML = tableCard('SHORTCUTS', 'Global shortcuts', [
  { label: 'Command palette', value: '<kbd>Cmd/Ctrl</kbd> + <kbd>K</kbd> or <kbd>Cmd/Ctrl</kbd> + <kbd>H</kbd>' },
  { label: 'Search canvas & notes', value: '<kbd>Cmd/Ctrl</kbd> + <kbd>F</kbd>' },
  { label: 'Open AI Chat', value: '<kbd>Cmd/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>A</kbd>' },
  { label: 'Group / ungroup', value: '<kbd>Cmd/Ctrl</kbd> + <kbd>G</kbd> / + <kbd>Shift</kbd> + <kbd>G</kbd>' },
  { label: 'Duplicate node', value: '<kbd>Cmd/Ctrl</kbd> + <kbd>D</kbd>' },
  { label: 'Focus / exit', value: '<kbd>F</kbd> / <kbd>Esc</kbd>' },
]);

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

01 Meet → 02 Essentials → 03 Organize → 04 Work with AI → 05 Go deeper

Do the three "first minute" steps at the top right, then head right. You can't break anything — this canvas is yours.
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

> No model configured yet? See the “Step 0” card on the left.
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
  download: { title: 'Download · Share with a friend', url: DOWNLOAD_URL },
  cards: {
    hero: { title: 'Pulse Canvas', html: HERO_HTML },
    firstMinute: { title: 'First minute', html: FIRST_MINUTE_HTML },
    featureGrid: { title: 'What it can do', html: FEATURE_GRID_HTML },
    concept: { title: 'Canvas essentials', html: CONCEPT_HTML },
    basics: { title: 'Canvas basics', html: BASICS_HTML },
    kanban: { title: 'Kanban with Frames', html: KANBAN_HTML },
    setup: { title: 'Step 0 · Set up a model', html: SETUP_HTML },
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
