import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskList } from '../task-list.js';
import { Mailbox } from '../mailbox.js';
import { createTeamMCPServer } from '../mcp-server.js';
import {
  generateMCPConfig,
  getMCPConfigPath,
  setupMCPConfig,
  getMCPArgs,
} from '../mcp-config.js';

describe('MCP Config', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'team-mcp-test-'));
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('generates valid MCP config', () => {
    const config = generateMCPConfig(stateDir, 'researcher', '/path/to/mcp-server.js');
    expect(config.mcpServers['agent-team']).toBeDefined();
    expect(config.mcpServers['agent-team'].command).toBe('node');
    expect(config.mcpServers['agent-team'].args).toContain('--state-dir');
    expect(config.mcpServers['agent-team'].args).toContain(stateDir);
    expect(config.mcpServers['agent-team'].args).toContain('--teammate-id');
    expect(config.mcpServers['agent-team'].args).toContain('researcher');
  });

  it('generates config file path', () => {
    const path = getMCPConfigPath(stateDir, 'coder');
    expect(path).toContain('mcp-configs');
    expect(path).toContain('coder.json');
  });

  it('writes config file to disk', () => {
    const configPath = setupMCPConfig(stateDir, 'tester', '/path/to/mcp-server.js');
    const { existsSync, readFileSync } = require('node:fs');
    expect(existsSync(configPath)).toBe(true);
    const content = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(content.mcpServers['agent-team'].args).toContain('tester');
  });

  it('returns correct MCP args for each runtime', () => {
    const configPath = '/tmp/config.json';
    expect(getMCPArgs('claude-code', configPath)).toEqual(['--mcp-config', configPath]);
    expect(getMCPArgs('codex', configPath)).toEqual(['--mcp-config', configPath]);
    expect(getMCPArgs('pulse-agent', configPath)).toEqual(['--mcp-config', configPath]);
  });
});

describe('Team MCP Server', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'team-mcp-test-'));
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates server instance', () => {
    const server = createTeamMCPServer(stateDir, 'researcher');
    expect(server).toBeDefined();
  });

  it('TaskList and Mailbox work with the same state dir', async () => {
    // Simulate what the MCP server does internally
    const taskList = new TaskList(stateDir);
    const mailbox = new Mailbox(stateDir);

    // Create a task
    const task = await taskList.create(
      { title: 'Test task', description: 'A test task' },
      'lead',
    );
    expect(task.id).toBeDefined();
    expect(task.status).toBe('pending');

    // Claim it
    const claimed = await taskList.claim('researcher');
    expect(claimed?.id).toBe(task.id);
    expect(claimed?.status).toBe('in_progress');

    // Complete it
    const completed = await taskList.complete(task.id, 'Done!');
    expect(completed?.status).toBe('completed');

    // Send a message
    const msg = mailbox.send('researcher', 'lead', 'message', 'Task is done');
    expect(msg.id).toBeDefined();

    // Read messages
    const messages = mailbox.readUnread('lead');
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('Task is done');
  });
});
