import type { DefaultSkill } from './default-skills';

/**
 * Write a Pulse Canvas plugin from a chat request, then install it with
 * `canvas_plugin_install`. The template is a hand-written global-script
 * remote, so the plugin needs no build step.
 */
export const CREATE_CANVAS_PLUGIN_SKILL: DefaultSkill = {
  slug: 'create-canvas-plugin',
  name: 'create-canvas-plugin',
  description:
    'Build a Pulse Canvas plugin from a chat request: a sidebar page, a tool panel, a reader, a dashboard, or a canvas node. Use when the user asks to make, generate, or change a plugin, an app inside Pulse Canvas, or a sidebar page, e.g. "做一个插件", "帮我生成一个侧边栏页面".',
  // 0.1.91: without plugin data tools. 0.1.92: without ctx.agent.
  // Then: without the embedded web page section. Then: a raw <webview>.
  legacyHashes: [
    '5ce21fed69674b41eb1f6bf4274e0a0b31b94c8febb4a943232775e3b63cccfc',
    'afa9e49faa10f3d462bec1a26d14b32f5d1b1e9b340c5afaf6efbdaa31261f23',
    'a1db4fb12894980d9d11fddc949e72c314069dd77e355447d54b2cb9448fa3ff',
    'a054e5c949fb181b912c57307c4f44449ad7ffa9d7568f5d4db5254ab7a99f26',
  ],
  body: `# create-canvas-plugin

Write a plugin folder, install it with \`canvas_plugin_install\`, and hand the user one click to enable it.

## 1. Agree on the plugin

1. Restate the plugin in one or two sentences: what the page shows, what the user does there, and what data it keeps.
2. Pick a name: 1-64 lowercase letters, digits, periods, or hyphens (for example \`session-stats\`). The name is the plugin id everywhere.
3. Ask only when the request has no clear page or no clear data. Otherwise start.

## 2. Write the files

Write to \`~/.pulse-coder/canvas-plugins/<name>/\` unless the user names another folder. Use the \`write\` tool. Keep the folder small:

\`\`\`text
<name>/
  plugin.json
  renderer/remoteEntry.js   # page UI, no build step
  main.mjs                  # optional: storage, canvas reads, agent tools
\`\`\`

### plugin.json

\`\`\`json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "<name>",
  "version": "0.1.0",
  "description": "<one sentence>",
  "extensions": {
    "com.pulsecanvas": {
      "renderer": {
        "remoteName": "pulse_plugin_<name_with_underscores>",
        "entry": "renderer/remoteEntry.js",
        "expose": "./plugin",
        "type": "global"
      },
      "main": { "entry": "main.mjs", "format": "esm", "runtime": "electron-main" }
    }
  }
}
\`\`\`

Leave out \`main\` only when the page keeps no data and the user will never ask you about its content. Top-level fields other than \`$schema\`, \`name\`, \`version\`, \`description\`, \`author\`, \`homepage\`, \`repository\`, \`license\`, \`keywords\`, and \`extensions\` cause warnings.

### renderer/remoteEntry.js

Plain browser JavaScript. Use the host React through \`globalThis.__PULSE_CANVAS_PLUGIN_REACT__\` and \`React.createElement\`. Do not import modules and do not use JSX.

\`\`\`js
(function () {
  const remoteName = 'pulse_plugin_<name_with_underscores>';
  const React = globalThis.__PULSE_CANVAS_PLUGIN_REACT__;
  const h = React.createElement;
  let ctx = null;

  function Page() {
    const [items, setItems] = React.useState([]);
    React.useEffect(function () {
      ctx.invoke('list').then(setItems).catch(function () { setItems([]); });
    }, []);
    return h('div', { style: { padding: 24, overflow: 'auto', width: '100%', height: '100%', boxSizing: 'border-box' } },
      h('h2', null, '<Title>'),
      items.map(function (item) { return h('div', { key: item.id }, item.text); }),
    );
  }

  globalThis[remoteName] = {
    init: function () {},
    get: function () {
      return Promise.resolve(function () {
        return {
          default: {
            id: '<name>',
            activate: function (hostCtx) {
              ctx = hostCtx;
              ctx.registerRoute('/plugin/<name>', Page);
              ctx.registerNavItem({ id: '<name>', path: '/plugin/<name>', label: '<Short label>' });
            },
          },
        };
      });
    },
  };
})();
\`\`\`

Renderer \`ctx\` (\`RendererCtx\`):

- \`registerRoute(path, Component)\` and \`registerNavItem({ id, path, label, title? })\`: a page plus its entry in the sidebar Plugins group. Use \`/plugin/<name>\` paths.
- \`registerNodeView(nodeType, Component)\`: a canvas node view. Declare the node in \`com.pulsecanvas.nodes\` with the same renderer block.
- \`invoke(channel, ...args)\`: call a channel that \`main.mjs\` registered with \`ctx.handle\`.
- \`addTextToChat(text)\`: put text into the chat composer, for example a quote the user selected. The user still sends it.
- \`WebView\`, \`readPage(viewId?)\`, \`readSelection(viewId?)\`: show and read a third-party site. See the next section.

Style with inline styles that use the host CSS variables, for example \`var(--surface)\`, \`var(--ink)\`, \`var(--radius-md)\`, so the page follows the theme.

### Show a third-party web page

When the plugin shows a real website (for example Douyin, Bilibili, Xiaohongshu, WeRead, a docs site), render the host component \`ctx.WebView\`. Never use an \`iframe\` (most sites block it with \`X-Frame-Options\` or CSP) and never create a raw \`webview\` element.

\`\`\`js
h(ctx.WebView, {
  src: url,
  viewId: 'main',
  style: { width: '100%', height: '100%' },
  onNavigate: function (nextUrl) { /* optional: track the page the user is on */ },
})
\`\`\`

The host does the browser work, so the plugin does not:

- It keeps the login across restarts in the plugin's own \`persist:plugin-<name>\` session. Login hops and new-tab links stay in the page.
- It shows a load failure with a retry button.
- It registers the page as \`plugin:<name>/<viewId>\`. You and external agents can then read it with \`browser_read_page\` and \`browser_read_selection\`; the chat lists open plugin pages for you.

Rules:

- Give every \`WebView\` on screen its own \`viewId\` (1-64 lowercase letters, digits, periods, or hyphens). Default: \`main\`.
- Give it a fixed size and keep it mounted. Unmounting it, moving it in the tree, or hiding it with \`display: none\`, \`visibility: hidden\`, or \`opacity: 0\` can reload the page and drop what the user typed. To switch between pages, stack them and put the active one on top with \`z-index\`. When the user leaves the plugin page, the host unmounts it; on return the site reloads, and only the login remains.
- Navigate by changing \`src\`.
- Read the page from the plugin with \`ctx.readPage(viewId?)\` and \`ctx.readSelection(viewId?)\`. \`readSelection\` returns \`{ ok, text, before, after, url, title }\`; \`text\` is empty when nothing is selected. Use it for buttons such as "Quote selection": read the selection, add what only the plugin knows (book title, chapter), and pass the result to \`ctx.addTextToChat\`.

### main.mjs

Put data access in one place, then give it to both the page (\`ctx.handle\`) and you (\`ctx.registerCanvasTool\`):

\`\`\`js
export default {
  id: '<name>',
  activate(ctx) {
    const list = async () => (await ctx.store.get('items')) ?? [];
    ctx.handle('list', list);
    ctx.handle('save', async (_event, items) => { await ctx.store.set('items', items); return true; });

    ctx.registerCanvasTool(() => ({
      <name_with_underscores>_read: {
        description: 'Read the <name> items the user keeps on the <Title> page. Returns JSON.',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => JSON.stringify(await list()),
      },
    }));
  },
};
\`\`\`

When the plugin keeps or shows data, always register a read tool like this one. Later questions such as "what is on my list" must go through that tool, so the answer matches the page. Add a write tool only when the user wants you to change the data from chat.

Main \`ctx\` (\`MainCtx\`):

- \`store.get/set/delete/list\`: persistent key-value storage for this plugin. Use it instead of writing your own files.
- \`canvas.listWorkspaces()\` and \`canvas.read(workspaceId)\`: read-only canvas data (workspace list, nodes).
- \`handle(channel, handler)\`: the handler gets \`(event, ...args)\`; return JSON-safe data.
- \`agent.complete(prompt, { system? })\`: one call to the user's current model, without tools. Use it for summaries, labels, translation, and rewrites.
- \`agent.run(prompt, { system?, maxSteps? })\`: a full agent loop in the background. It can read canvases, knowledge, chat sessions, and memory, but it cannot change them. Use it when the answer needs that context.
- Both return \`{ ok: true, text }\` or \`{ ok: false, error }\`. They never write to the user's chat history. Call them from a \`ctx.handle\` handler, so the page triggers them with \`invoke\` and shows a loading state; a run can take a minute.
- \`registerCanvasTool(factory)\`: give the Canvas Agent tools for this plugin. The factory returns \`{ <tool_name>: { description, inputSchema, execute } }\`. Write \`inputSchema\` as plain JSON Schema; \`execute(input)\` returns a string. Prefix tool names with the plugin name so they do not clash. The tools are registered dynamically: they work in workspace and All-workspaces chat as soon as the plugin is enabled or reloaded, even in the same turn, without an app restart.

The \`id\` in \`main.mjs\` and in the renderer must equal \`name\` in plugin.json.

## 3. Install and check

1. Call \`canvas_plugin_install\` with the absolute folder path. If it is not in your tool list, find it with \`tool_search_tool_bm25\`.
2. Read the JSON result. If \`ok\` is false, fix every \`error\` diagnostic and call the tool again. Fix warnings when they are cheap.
3. Follow \`nextStep\` in the result. When \`nativeEnabled\` is false, tell the user to press **Enable and open** on the install card in this chat. That card is the trust gate: you cannot enable plugin code yourself, and the user should not need to open settings. When it is true, the plugin is already live; never ask the user to enable it.
   Keep the reply short: the card already shows the install status. Say in one sentence what the plugin does and in one sentence what the user does next (for example, where to paste a key). The page itself should explain the rest.
4. After every later change to the files, call \`canvas_plugin_install\` again. For an enabled plugin it hot-reloads the plugin in the open app, so tell the user to look at the page again. Keep \`main.mjs\` in one file: only the entry file reloads, and modules it imports stay cached.
5. A \`main.load-failed\` diagnostic means \`main.mjs\` threw, so the page gets "No handler registered" errors. Fix the error it names and install again.

## Rules

- Keep the plugin self-contained in its folder. No network calls, no shell commands, and no reads outside \`ctx\` APIs unless the user asked for them. A \`ctx.WebView\` that shows a site the user asked for is allowed.
- Do not write into the Pulse Canvas source tree or the plugin market packages folder.
- Never put a plugin inside \`~/.pulse-coder/canvas/\`: every folder there is read as a workspace.
- Never claim the plugin works before the user has enabled it and seen the page.
- When a plugin needs AI (summarize, classify, suggest, answer from canvas content), use \`ctx.agent\`. Never ask the user for an API key and never call a model provider directly.
- To answer a question about a plugin's data, call that plugin's tools. Do not search the disk for its storage files. If the plugin has no tool for it, add one to \`main.mjs\` and install again.
`,
};
