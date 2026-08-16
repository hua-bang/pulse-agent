import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

import {
  classifyCanvasToolOperation,
  createCanvasAgentToolPolicy,
  createCanvasAskModeToolPolicyPlugin,
  enforceCanvasAskModeToolPolicy,
  requestAskModeApproval,
  requiresCanvasNodeCreationApproval,
} from '../tool-policy';

describe('Canvas Agent tool policy', () => {
  it('gives interactive global chat file/image tools and explicit-target canvas tools', () => {
    const policy = createCanvasAgentToolPolicy({ kind: 'global' });
    const finalNames = Object.keys({
      ...policy.builtInTools,
      ...policy.canvasTools,
    }).sort();

    expect(Object.keys(policy.builtInTools ?? {}).sort()).toEqual([
      'bash',
      'clarify',
      'edit',
      'generate_image',
      'grep',
      'ls',
      'read',
      'tavily',
      'tavily_crawl',
      'tavily_extract',
      'tavily_map',
      'write',
    ]);
    expect(finalNames).toContain('canvas_create_node');
    expect(finalNames).toContain('canvas_update_node');
    expect(finalNames).toContain('canvas_tag_node');
    expect(finalNames).toContain('workspace_node_upsert');
    expect(finalNames).not.toContain('canvas_propose_node_change');
    expect(finalNames).toContain('knowledge_search_nodes');
    expect(finalNames).toContain('knowledge_read_node');
    expect(finalNames).toContain('knowledge_analyze_image');
    // Global file/image tools are available; target-dependent Canvas tools
    // carry an explicit workspaceId in their schema.
    expect(finalNames).toContain('bash');
    expect(finalNames).toContain('edit');
    expect(finalNames).toContain('generate_image');
    expect(finalNames).toContain('write');
  });

  it('keeps scheduled runs on the narrower shell/read allowlist', () => {
    const policy = createCanvasAgentToolPolicy({ kind: 'scheduled', taskId: 'memory-report' });

    // Scheduled runs keep shell access for existing automation, but do not
    // inherit interactive Global's file/image or Canvas mutation surface.
    expect(Object.keys(policy.builtInTools ?? {})).toContain('bash');
    expect(Object.keys(policy.builtInTools ?? {})).not.toContain('edit');
    expect(Object.keys(policy.builtInTools ?? {})).not.toContain('generate_image');
    expect(Object.keys(policy.builtInTools ?? {})).not.toContain('write');
    expect(Object.keys(policy.canvasTools ?? {})).not.toContain('canvas_create_node');
  });

  it('keeps the full engine built-ins and direct canvas tools in workspace chat', () => {
    const policy = createCanvasAgentToolPolicy({ kind: 'workspace', workspaceId: 'ws-1' });

    expect(Object.keys(policy.builtInTools ?? {}).sort()).toEqual(
      expect.arrayContaining(['read', 'write', 'edit', 'bash']),
    );
    expect(policy.canvasTools.canvas_tag_node).toBeDefined();
    expect(policy.canvasTools.canvas_create_terminal_node).toBeDefined();
  });

  it('mechanically requires approval before an ask-mode write executes', async () => {
    const onClarificationRequest = vi.fn(async () => 'No');

    const result = await enforceCanvasAskModeToolPolicy({
      name: 'write',
      input: { file_path: '/tmp/do-not-write', content: 'blocked' },
      toolContext: {
        runContext: { executionMode: 'ask' },
        toolCallId: 'tool-write-1',
        onClarificationRequest,
      },
    });

    expect(onClarificationRequest).toHaveBeenCalledWith(expect.objectContaining({
      id: 'tool-approval:tool-write-1',
      question: expect.stringContaining('write'),
      defaultAnswer: 'No',
    }));
    expect(result).toMatchObject({
      output: {
        ok: false,
        cancelled: true,
        error: expect.stringContaining('did not run'),
      },
    });
  });

  it.each([
    'canvas_create',
    'mcp_runtime_canvas_create',
    'canvas_create_node',
    'canvas_create_agent_node',
    'canvas_create_terminal_node',
    'canvas_create_shape',
    'dynamic_app_create',
    'artifact_pin_to_canvas',
  ])('requires approval before %s even in Auto mode', async (name) => {
    const onClarificationRequest = vi.fn(async () => 'No');

    expect(requiresCanvasNodeCreationApproval(name)).toBe(true);
    const result = await enforceCanvasAskModeToolPolicy({
      name,
      input: { title: 'Proposed node' },
      toolContext: {
        runContext: { executionMode: 'auto' },
        toolCallId: `tool-${name}`,
        onClarificationRequest,
      },
    });

    expect(onClarificationRequest).toHaveBeenCalledWith(expect.objectContaining({
      id: `tool-approval:tool-${name}`,
      kind: 'approval',
      question: expect.stringContaining('creating a new node'),
      defaultAnswer: 'No',
    }));
    expect(result).toMatchObject({
      output: {
        ok: false,
        cancelled: true,
        error: expect.stringContaining('did not run'),
      },
    });
  });

  it('allows a confirmed Auto-mode node creation and carries the receipt forward', async () => {
    const onClarificationRequest = vi.fn(async () => 'Yes');
    const result = await enforceCanvasAskModeToolPolicy({
      name: 'canvas_create_node',
      input: { type: 'text', title: 'Approved node' },
      toolContext: {
        runContext: { executionMode: 'auto' },
        toolCallId: 'tool-create-node-1',
        onClarificationRequest,
      },
    });

    expect(result).toMatchObject({
      toolContext: {
        runContext: {
          executionMode: 'auto',
          approvalGrantedFor: 'tool-create-node-1',
        },
      },
    });
  });

  it('does not let a read classification bypass node-creation approval', async () => {
    const onClarificationRequest = vi.fn(async () => 'No');
    const result = await requestAskModeApproval({
      name: 'canvas_create_node',
      operation: 'read',
      input: { type: 'text', title: 'Still a new node' },
      context: {
        runContext: { executionMode: 'auto' },
        toolCallId: 'tool-create-node-read-classified',
        onClarificationRequest,
      },
    });

    expect(onClarificationRequest).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ approved: false, error: expect.stringContaining('did not run') });
  });

  it('fails closed when Auto-mode node creation has no approval channel', async () => {
    const result = await enforceCanvasAskModeToolPolicy({
      name: 'canvas_create_node',
      input: { type: 'text', title: 'Should not be created' },
      toolContext: { runContext: { executionMode: 'auto' } },
    });

    expect(result).toMatchObject({
      output: {
        ok: false,
        cancelled: true,
        error: expect.stringContaining('Approval unavailable'),
      },
    });
  });

  it('fails closed when ask mode has no approval channel', async () => {
    const result = await enforceCanvasAskModeToolPolicy({
      name: 'bash',
      input: { command: 'echo should-not-run' },
      toolContext: { runContext: { executionMode: 'ask' } },
    });

    expect(result).toMatchObject({
      output: {
        ok: false,
        cancelled: true,
        error: expect.stringContaining('Approval unavailable'),
      },
    });
  });

  it('does not gate read-only tools in ask mode', async () => {
    const onClarificationRequest = vi.fn(async () => 'No');

    const result = await enforceCanvasAskModeToolPolicy({
      name: 'read',
      input: { filePath: join(__dirname, '../../../../package.json') },
      toolContext: { runContext: { executionMode: 'ask' }, onClarificationRequest },
    });

    expect(result).toBeUndefined();
    expect(onClarificationRequest).not.toHaveBeenCalled();
  });

  it('gates an MCP mutation registered after the initial host tool policy', async () => {
    let hook: typeof enforceCanvasAskModeToolPolicy | undefined;
    createCanvasAskModeToolPolicyPlugin().initialize({
      registerHook: (_name, handler) => {
        hook = handler;
      },
    });
    const onClarificationRequest = vi.fn(async () => 'Yes');

    const result = await hook!({
      name: 'mcp_notion_create_page',
      input: { title: 'Launch plan' },
      toolContext: {
        runContext: { executionMode: 'ask' },
        toolCallId: 'mcp-write-1',
        onClarificationRequest,
      },
    });

    expect(onClarificationRequest).toHaveBeenCalledWith(expect.objectContaining({
      id: 'tool-approval:mcp-write-1',
      question: expect.stringContaining('mcp_notion_create_page'),
    }));
    expect(result).toMatchObject({
      toolContext: {
        runContext: {
          executionMode: 'ask',
          approvalGrantedFor: 'mcp-write-1',
        },
      },
    });
  });

  it('lets a namespaced MCP reader pass without approval', async () => {
    const onClarificationRequest = vi.fn(async () => 'No');
    const result = await enforceCanvasAskModeToolPolicy({
      name: 'mcp_drive_file_search',
      input: { query: 'launch' },
      toolContext: {
        runContext: { executionMode: 'ask' },
        onClarificationRequest,
      },
    });

    expect(result).toBeUndefined();
    expect(onClarificationRequest).not.toHaveBeenCalled();
  });

  it('fails closed when an MCP mutation also contains a reader-like word', () => {
    expect(classifyCanvasToolOperation('mcp_pages_get_or_create')).toBe('write');
    expect(classifyCanvasToolOperation('mcp_drive_search_and_delete')).toBe('destructive');
    expect(classifyCanvasToolOperation('mcp_drive_search')).toBe('read');
  });

  /**
   * The scope boundary is stated twice — once as the tool allowlist, once as
   * prose in GLOBAL_AGENT_SYSTEM_PROMPT — and the two drifted: `bash` was
   * added to the policy while the prompt still said global chat "cannot
   * execute shell commands", so the model refused to call a tool it had.
   * Prose wins that argument, so it has to be kept honest.
   */
  it('does not let the global system prompt contradict the tool allowlist', () => {
    const source = readFileSync(
      join(__dirname, '..', 'canvas-agent.ts'),
      'utf-8',
    );
    const promptStart = source.indexOf('const GLOBAL_AGENT_SYSTEM_PROMPT');
    expect(promptStart).toBeGreaterThan(-1);
    // Backticks inside the template literal are escaped in source; unescape so
    // the assertions read like the prompt the model actually receives.
    // End on the literal's own terminator (line-start backtick), not the
    // first "`;" — escaped backticks inside the prompt produce those too.
    const prompt = source
      .slice(promptStart, source.indexOf('\n`;', promptStart))
      .replace(/\\`/g, '`');
    // Guard the slice itself: a bad end marker would silently pass everything.
    expect(prompt).toContain('Ask a clarifying question');

    const builtIns = Object.keys(
      createCanvasAgentToolPolicy({ kind: 'global' }).builtInTools ?? {},
    );
    expect(builtIns).toContain('bash');

    // Whatever the wording, the prompt must name the now-available global
    // file tools and bash, and must not carry back the old unavailable-tools
    // claims that made the model refuse valid calls.
    expect(prompt).toMatch(/`bash`/);
    expect(prompt).toMatch(/`write`/);
    expect(prompt).toMatch(/`edit`/);
    expect(prompt).toContain('Before calling any node-creating tool');
    expect(prompt).toContain('do not call `user_ask` for a second confirmation');
    expect(prompt).not.toMatch(/cannot[^.]*execute shell/i);
    expect(prompt).not.toMatch(/There are no `write`\/`edit` tools/i);
  });
});
