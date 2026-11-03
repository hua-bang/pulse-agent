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
  body: `# create-canvas-plugin

Write a plugin folder, install it with \`canvas_plugin_install\`, and hand the user one click to enable it.

## 1. Agree on the plugin

1. Restate the plugin in one or two sentences: what the page shows, what the user does there, and what data it keeps.
2. Pick a name: 1-64 lowercase letters, digits, periods, or hyphens (for example \`session-stats\`). The name is the plugin id everywhere.
3. Ask only when the request has no clear page or no clear data. Otherwise start.

## 2. Write the files

Write to \`~/.pulse-coder/canvas/local-plugins/<name>/\` unless the user names another folder. Use the \`write\` tool. Keep the folder small:

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

Leave out \`main\` when the page needs no storage, canvas data, or agent tools. Top-level fields other than \`$schema\`, \`name\`, \`version\`, \`description\`, \`author\`, \`homepage\`, \`repository\`, \`license\`, \`keywords\`, and \`extensions\` cause warnings.

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
    return h('div', { style: { padding: 24, overflow: 'auto', height: '100%', boxSizing: 'border-box' } },
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
- \`addTextToChat(text)\`: put text into the chat composer, for example a quote the user selected. The user still sends it. Implement the selection or highlight UI inside your page.

Style with inline styles that use the host CSS variables, for example \`var(--surface)\`, \`var(--ink)\`, \`var(--radius-md)\`, so the page follows the theme.

### main.mjs (optional)

\`\`\`js
export default {
  id: '<name>',
  activate(ctx) {
    ctx.handle('list', async () => (await ctx.store.get('items')) ?? []);
    ctx.handle('save', async (_event, items) => { await ctx.store.set('items', items); return true; });
  },
};
\`\`\`

Main \`ctx\` (\`MainCtx\`):

- \`store.get/set/delete/list\`: persistent key-value storage for this plugin. Use it instead of writing your own files.
- \`canvas.listWorkspaces()\` and \`canvas.read(workspaceId)\`: read-only canvas data (workspace list, nodes).
- \`handle(channel, handler)\`: the handler gets \`(event, ...args)\`; return JSON-safe data.
- \`registerCanvasTool(factory)\`: give the Canvas Agent new tools for this plugin.

The \`id\` in \`main.mjs\` and in the renderer must equal \`name\` in plugin.json.

## 3. Install and check

1. Call \`canvas_plugin_install\` with the absolute folder path. If it is not in your tool list, find it with \`tool_search_tool_bm25\`.
2. Read the JSON result. If \`ok\` is false, fix every \`error\` diagnostic and call the tool again. Fix warnings when they are cheap.
3. When \`nativeEnabled\` is false, tell the user to press **Enable and open** on the install card in this chat. That card is the trust gate: you cannot enable plugin code yourself, and the user should not need to open settings.
4. When the plugin was already enabled, tell the user that code changes take effect after they restart Pulse Canvas.

## Rules

- Keep the plugin self-contained in its folder. No network calls, no shell commands, and no reads outside \`ctx\` APIs unless the user asked for them.
- Do not write into the Pulse Canvas source tree or the plugin market packages folder.
- Never claim the plugin works before the user has enabled it and seen the page.
`,
};
