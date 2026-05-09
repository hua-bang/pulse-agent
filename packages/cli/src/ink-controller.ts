import { PulseAgent, type Context, type TaskListService } from 'pulse-coder-engine';
import { createJsExecutor, createRunJsTool } from 'pulse-sandbox/src';
import { getAcpState, runAcp } from 'pulse-coder-acp';

import { ACP_CLIENT_INFO, handleAcpCommand, resolveAcpPlatformKey } from './acp-commands.js';
import { InputManager } from './input-manager.js';
import { memoryIntegration, buildMemoryRunContext, recordDailyLogFromSuccessPath } from './memory-integration.js';
import { SessionCommands } from './session-commands.js';
import { SkillCommands } from './skill-commands.js';
import { runTeam, TeamsSession } from './team-commands.js';
import type { TuiHelpItem } from './tui-renderer.js';
import { InkUiBridge } from './ink-ui-bridge.js';
import type { InkCliController, InkCliSnapshot } from './ink-app.js';

const LOCAL_COMMANDS = new Set([
  'help',
  'new',
  'resume',
  'sessions',
  'search',
  'rename',
  'delete',
  'clear',
  'compact',
  'skills',
  'wt',
  'acp',
  'status',
  'mode',
  'plan',
  'execute',
  'team',
  'teams',
  'solo',
  'save',
  'tui',
  'exit',
]);

const HELP_ITEMS: TuiHelpItem[] = [
  { command: '/help', description: 'Show this help message' },
  { command: '/new [title]', description: 'Create a new session' },
  { command: '/resume <id>', description: 'Resume a saved session' },
  { command: '/sessions', description: 'List all saved sessions' },
  { command: '/search <query>', description: 'Search in saved sessions' },
  { command: '/rename <id> <new-title>', description: 'Rename a session' },
  { command: '/delete <id>', description: 'Delete a session' },
  { command: '/clear', description: 'Clear current conversation' },
  { command: '/compact', description: 'Force compact current conversation context' },
  { command: '/skills [list|<name|index> <message>]', description: 'Run one message with a selected skill' },
  { command: '/acp [status|on|off|cd]', description: 'Manage ACP mode for this CLI' },
  { command: '/wt use <work-name>', description: 'Create a worktree + branch via worktree skill' },
  { command: '/status', description: 'Show current session status' },
  { command: '/mode', description: 'Show current plan mode' },
  { command: '/plan', description: 'Switch to planning mode' },
  { command: '/execute', description: 'Switch to executing mode' },
  { command: '/team <task>', description: 'Run a multi-agent team (LLM plans DAG by default)' },
  { command: '/teams <task>', description: 'Run agent teams (enters teams mode for follow-ups)' },
  { command: '/solo', description: 'Exit teams mode, return to normal agent' },
  { command: '/save', description: 'Save current session explicitly' },
  { command: '/tui [status]', description: 'Show current Ink UI status' },
  { command: '/exit', description: 'Exit the application' },
];

const HELP_FOOTER = [
  'Enter - Send current input',
  'Ctrl+J - Insert a newline into the current draft',
  'Tab - Complete the first visible slash-command suggestion',
  'Type / - Show slash-command suggestions',
  '↑/↓ - Recall previous/next prompt',
  '←/→, Ctrl+A/E - Move cursor',
  'Ctrl+U/K/W - Delete before cursor / after cursor / previous word',
  'Ctrl+L - Clear visible transcript without clearing conversation',
  'Esc (while processing) - Stop current response and accept next input',
  'Esc (idle) - Clear current input first; exit when input is empty',
  'Ctrl+C - Save and exit CLI immediately',
];

class InkCoderController implements InkCliController {
  private readonly agent: PulseAgent;
  private readonly context: Context;
  private readonly sessionCommands: SessionCommands;
  private readonly inputManager: InputManager;
  private readonly skillCommands: SkillCommands;
  private readonly acpPlatformKey: string;
  private readonly ui: InkUiBridge;
  private readonly listeners = new Set<(snapshot: InkCliSnapshot) => void>();
  private currentAbortController: AbortController | null = null;
  private isProcessing = false;
  private isShuttingDown = false;
  private teamsSession: TeamsSession | null = null;
  private readonly queuedInputs: string[] = [];

  constructor() {
    const runJsTool = createRunJsTool({
      executor: createJsExecutor()
    });

    this.agent = new PulseAgent({
      enginePlugins: {
        plugins: [memoryIntegration.enginePlugin],
        dirs: ['.pulse-coder/engine-plugins', '.coder/engine-plugins', '~/.pulse-coder/engine-plugins', '~/.coder/engine-plugins'],
        scan: true
      },
      userConfigPlugins: {
        dirs: ['.pulse-coder/config', '.coder/config', '~/.pulse-coder/config', '~/.coder/config'],
        scan: true
      },
      tools: {
        [runJsTool.name]: runJsTool
      }
    });
    this.context = { messages: [] };
    this.ui = new InkUiBridge({
      onChange: snapshot => this.notify(snapshot),
    });
    this.sessionCommands = new SessionCommands(message => this.ui.info(message ?? ''));
    this.inputManager = new InputManager({
      onRequest: request => this.ui.clarification(request),
    });
    this.skillCommands = new SkillCommands(this.agent, message => this.ui.info(message ?? ''));
    this.acpPlatformKey = resolveAcpPlatformKey();
  }

  async initialize(): Promise<void> {
    this.ui.showWelcome();
    await this.sessionCommands.initialize();
    await memoryIntegration.initialize();
    await this.agent.initialize();

    const pluginStatus = this.agent.getPluginStatus();
    this.ui.showPluginStatus(pluginStatus.enginePlugins.length);

    await this.sessionCommands.createSession();
    await this.syncSessionTaskListBinding();
    this.publishSession('Ready');
  }

  getSnapshot(): InkCliSnapshot {
    return this.ui.getSnapshot();
  }

  subscribe(listener: (snapshot: InkCliSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  requestStop(): void {
    if (this.isProcessing) {
      if (this.currentAbortController && !this.currentAbortController.signal.aborted) {
        this.currentAbortController.abort();
        this.ui.abort('Request cancelled by Esc. You can type the next message now.');
      } else {
        this.ui.abort('Cancellation already requested. Waiting for current step to finish...');
      }
      return;
    }

    if (this.inputManager.hasPendingRequest()) {
      this.inputManager.cancel('User interrupted with Esc');
      this.ui.abort('Clarification cancelled.');
    }
  }

  async submitInput(input: string): Promise<void> {
    const trimmedInput = input.trim();

    if (this.inputManager.handleUserInput(trimmedInput)) {
      this.ui.user(trimmedInput || '(empty clarification response)');
      this.publishSession('Clarification submitted');
      return;
    }

    if (this.isProcessing) {
      if (this.currentAbortController?.signal.aborted) {
        if (trimmedInput) {
          this.queuedInputs.push(trimmedInput);
          this.ui.queued('Input queued. It will run right after the current step finishes.');
        }
        return;
      }

      this.ui.warn('Still processing. Press Esc to stop current request first.');
      return;
    }

    if (!trimmedInput) {
      return;
    }

    if (trimmedInput.toLowerCase() === 'exit') {
      await this.shutdown();
      return;
    }

    await this.handleInput(trimmedInput);
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }
    this.isShuttingDown = true;

    if (this.isProcessing && this.currentAbortController && !this.currentAbortController.signal.aborted) {
      this.currentAbortController.abort();
    }

    if (this.inputManager.hasPendingRequest()) {
      this.inputManager.cancel('User interrupted with Ctrl+C');
    }

    this.ui.info('Saving current session...');
    try {
      if (this.teamsSession?.active) {
        await this.teamsSession.stop();
      }
      await this.sessionCommands.saveContext(this.context);
      this.ui.success('Goodbye!');
    } catch (error) {
      this.ui.error(`Error while shutting down: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleInput(input: string): Promise<void> {
    let messageInput = input;
    let forceAcp = false;

    if (input.startsWith('//')) {
      const acpState = await getAcpState(this.acpPlatformKey);
      if (!acpState) {
        this.ui.warn('ACP 未启用，请先使用 /acp on <claude|codex>。');
        return;
      }
      messageInput = input.slice(1);
      forceAcp = true;
    }

    if (messageInput.startsWith('/') && !forceAcp) {
      const commandLine = messageInput.substring(1);
      const parts = commandLine.split(/\s+/).filter(part => part.length > 0);

      if (parts.length === 0) {
        this.ui.warn('Please provide a command after "/"');
        return;
      }

      const command = parts[0];
      const args = parts.slice(1);
      const normalizedCommand = command.toLowerCase();

      if (normalizedCommand === 'acp') {
        await this.handleCommand(command, args);
        return;
      }

      if (!LOCAL_COMMANDS.has(normalizedCommand)) {
        const acpState = await getAcpState(this.acpPlatformKey);
        if (acpState) {
          forceAcp = true;
        } else {
          this.ui.warn(`Unknown command: /${command}`);
          this.ui.info('Type /help to see available commands');
          return;
        }
      }

      if (!forceAcp) {
        if (normalizedCommand === 'team') {
          await this.runExclusive(async () => runTeam(this.agent, args));
          return;
        }

        if (normalizedCommand === 'teams') {
          await this.runExclusive(async () => {
            const session = await TeamsSession.start(args);
            if (session) {
              this.teamsSession = session;
              this.ui.success('Entered teams mode. Use /solo to return to normal agent.');
            }
          });
          return;
        }

        if (normalizedCommand === 'solo') {
          if (this.teamsSession?.active) {
            await this.runExclusive(async () => {
              await this.teamsSession?.stop();
              this.teamsSession = null;
              this.ui.success('Exited teams mode.');
            });
          } else {
            this.ui.warn('Not in teams mode. Use /teams <task> to start.');
          }
          return;
        }

        if (normalizedCommand === 'skills') {
          const transformedMessage = await this.skillCommands.transformSkillsCommandToMessage(args);
          if (!transformedMessage) {
            return;
          }
          messageInput = transformedMessage;
        } else if (normalizedCommand === 'wt') {
          if (args.length < 2 || args[0].toLowerCase() !== 'use') {
            this.ui.error('Usage: /wt use <work-name>');
            return;
          }

          const workName = args.slice(1).join(' ').trim();
          if (!workName) {
            this.ui.error('Worktree name cannot be empty.');
            this.ui.info('Usage: /wt use <work-name>');
            return;
          }

          messageInput = `[use skill](worktree) new ${workName}`;
          this.ui.success('Worktree request prepared via skill: worktree');
        } else {
          await this.handleCommand(command, args);
          return;
        }
      }
    }

    if (this.teamsSession?.active && !forceAcp) {
      await this.runExclusive(async () => this.teamsSession?.followUp(messageInput));
      return;
    }

    await this.runMessage(messageInput, forceAcp);
  }

  private async handleCommand(command: string, args: string[]): Promise<void> {
    try {
      switch (command.toLowerCase()) {
        case 'help':
          this.ui.showHelp(HELP_ITEMS, HELP_FOOTER);
          break;
        case 'new':
          await this.sessionCommands.createSession(args.join(' ') || undefined);
          this.context.messages = [];
          await this.syncSessionTaskListBinding();
          this.publishSession('New session created');
          break;
        case 'resume':
          if (args.length === 0) {
            this.ui.error('Please provide a session ID');
            this.ui.info('Usage: /resume <session-id>');
            break;
          }
          if (await this.sessionCommands.resumeSession(args[0])) {
            await this.sessionCommands.loadContext(this.context);
            await this.syncSessionTaskListBinding();
            this.publishSession('Session resumed');
          }
          break;
        case 'sessions':
          await this.sessionCommands.listSessions();
          break;
        case 'search':
          if (args.length === 0) {
            this.ui.error('Please provide a search query');
            this.ui.info('Usage: /search <query>');
            break;
          }
          await this.sessionCommands.searchSessions(args.join(' '));
          break;
        case 'rename':
          if (args.length < 2) {
            this.ui.error('Please provide session ID and new title');
            this.ui.info('Usage: /rename <session-id> <new-title>');
            break;
          }
          await this.sessionCommands.renameSession(args[0], args.slice(1).join(' '));
          break;
        case 'delete':
          if (args.length === 0) {
            this.ui.error('Please provide a session ID');
            this.ui.info('Usage: /delete <session-id>');
            break;
          }
          await this.sessionCommands.deleteSession(args[0]);
          this.publishSession('Session deleted');
          break;
        case 'clear':
          this.context.messages = [];
          this.ui.success('Current conversation cleared!');
          this.publishSession('Ready');
          break;
        case 'compact':
          await this.compactContext();
          break;
        case 'skills':
          this.ui.info('Use /skills <name|index> <message> directly in input for one-shot skill execution.');
          break;
        case 'acp': {
          const message = await handleAcpCommand(this.acpPlatformKey, args);
          this.ui.info(message);
          break;
        }
        case 'status':
          this.ui.section('Session Status', [
            `Current Session: ${this.sessionCommands.getCurrentSessionId() || 'None (new session)'}`,
            `Task List: ${this.sessionCommands.getCurrentTaskListId() || 'None'}`,
            `Messages: ${this.context.messages.length}`,
          ]);
          break;
        case 'mode': {
          const currentMode = this.agent.getMode();
          if (!currentMode) {
            this.ui.warn('plan mode plugin unavailable');
          } else {
            this.ui.info(`Current mode: ${currentMode}`);
          }
          break;
        }
        case 'plan':
          if (this.agent.setMode('planning', 'cli:/plan')) {
            this.ui.success('Switched to planning mode');
            this.publishSession('Ready');
          } else {
            this.ui.error('Failed to switch mode: plan mode plugin unavailable');
          }
          break;
        case 'execute':
          if (this.agent.setMode('executing', 'cli:/execute')) {
            this.ui.success('Switched to executing mode');
            this.publishSession('Ready');
          } else {
            this.ui.error('Failed to switch mode: plan mode plugin unavailable');
          }
          break;
        case 'tui':
          this.ui.showTuiStatus();
          break;
        case 'save':
          if (this.sessionCommands.getCurrentSessionId()) {
            await this.sessionCommands.saveContext(this.context);
            this.ui.success('Current session saved!');
          } else {
            this.ui.error('No active session. Create one with /new');
          }
          break;
        case 'exit':
          await this.shutdown();
          break;
        default:
          this.ui.warn(`Unknown command: ${command}`);
          this.ui.info('Type /help to see available commands');
      }
    } catch (error) {
      this.ui.error(`Error executing command: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async compactContext(): Promise<void> {
    if (this.context.messages.length === 0) {
      this.ui.info('Context is empty, nothing to compact.');
      return;
    }

    const beforeCount = this.context.messages.length;
    const beforeTokens = this.estimateTokens(this.context.messages);
    const keepLastTurns = this.getKeepLastTurns();
    const compactResult = await this.agent.compactContext(this.context, { force: true });

    if (!compactResult.didCompact || !compactResult.newMessages) {
      this.ui.info('No compaction was applied.');
      this.ui.info(`Messages: ${beforeCount}, estimated tokens: ~${beforeTokens}, KEEP_LAST_TURNS=${keepLastTurns}`);
      return;
    }

    this.context.messages = compactResult.newMessages;
    await this.sessionCommands.saveContext(this.context);

    const afterCount = this.context.messages.length;
    const afterTokens = this.estimateTokens(this.context.messages);
    const tokenDelta = beforeTokens - afterTokens;
    const tokenDeltaText = tokenDelta >= 0 ? `-${tokenDelta}` : `+${Math.abs(tokenDelta)}`;
    const reasonSuffix = compactResult.reason ? ` (${compactResult.reason})` : '';

    this.ui.section(`Context compacted${reasonSuffix}`, [
      `Messages: ${beforeCount} -> ${afterCount}`,
      `Estimated tokens: ~${beforeTokens} -> ~${afterTokens} (${tokenDeltaText})`,
      `KEEP_LAST_TURNS=${keepLastTurns}`,
    ]);
    this.publishSession('Ready');
  }

  private async runExclusive(task: () => Promise<unknown>): Promise<void> {
    this.isProcessing = true;
    this.ui.startProcessing('Running command');
    try {
      await task();
      this.publishSession('Ready');
    } catch (error) {
      this.ui.error(`Command error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.isProcessing = false;
      this.ui.stopProcessing();
    }
  }

  private async runMessage(messageInput: string, forceAcp: boolean): Promise<void> {
    this.ui.user(messageInput);
    this.ui.session({
      sessionId: this.sessionCommands.getCurrentSessionId(),
      taskListId: this.sessionCommands.getCurrentTaskListId(),
      messages: this.context.messages.length,
      estimatedTokens: this.estimateTokens(this.context.messages),
      mode: this.agent.getMode(),
    });

    this.context.messages.push({
      role: 'user',
      content: messageInput,
    });

    this.ui.startProcessing(forceAcp ? 'Running ACP agent' : 'Running agent');

    const ac = new AbortController();
    this.currentAbortController = ac;
    this.isProcessing = true;

    let sawText = false;
    let toolCalls = 0;
    const runStartedAt = Date.now();

    try {
      await this.syncSessionTaskListBinding();
      const acpState = await getAcpState(this.acpPlatformKey);
      const currentSessionId = this.resolveCurrentSessionId();

      const runAgent = async () => this.agent.run(this.context, {
        abortSignal: ac.signal,
        onText: (delta) => {
          sawText = true;
          this.ui.text(delta);
        },
        onToolCall: (toolCall) => {
          toolCalls += 1;
          const input = this.getToolInput(toolCall);
          this.ui.toolCall(this.resolveToolName(toolCall), input);
        },
        onToolResult: (toolResult) => {
          const toolName = this.resolveToolName(toolResult as Record<string, unknown>);
          this.ui.toolResult(toolName);
        },
        onStepFinish: (step) => {
          this.ui.stepFinished(step.finishReason);
        },
        onClarificationRequest: async (request) => {
          return await this.inputManager.requestInput(request);
        },
        onCompacted: (newMessages) => {
          this.context.messages = newMessages;
        },
        onResponse: (messages) => {
          this.context.messages.push(...messages);
        },
      });

      const runAcpAgent = async () => {
        if (!acpState) {
          return '';
        }
        const result = await runAcp({
          platformKey: this.acpPlatformKey,
          agent: acpState.agent,
          cwd: acpState.cwd,
          sessionId: acpState.sessionId,
          userText: messageInput,
          abortSignal: ac.signal,
          clientInfo: ACP_CLIENT_INFO,
          callbacks: {
            onText: (delta) => {
              sawText = true;
              this.ui.text(delta);
            },
            onToolCall: (toolCall) => {
              toolCalls += 1;
              const input = this.getToolInput(toolCall);
              this.ui.toolCall(this.resolveToolName(toolCall), input);
            },
            onToolResult: (toolResult) => {
              const toolName = this.resolveToolName(toolResult as Record<string, unknown>);
              this.ui.toolResult(toolName);
            },
            onClarificationRequest: async (request) => {
              return await this.inputManager.requestInput(request);
            },
          },
        });
        return result.text;
      };

      const result = currentSessionId
        ? await memoryIntegration.withRunContext(
          buildMemoryRunContext({
            sessionId: currentSessionId,
            userText: messageInput,
          }),
          acpState ? runAcpAgent : runAgent,
        )
        : await (acpState ? runAcpAgent() : runAgent());

      this.ui.runSummary({
        elapsedMs: Date.now() - runStartedAt,
        toolCalls,
        messages: this.context.messages.length,
        estimatedTokens: this.estimateTokens(this.context.messages),
        mode: this.agent.getMode(),
      });

      if (result) {
        if (!sawText) {
          this.ui.plain(result);
        }

        await this.sessionCommands.saveContext(this.context);

        if (currentSessionId) {
          await recordDailyLogFromSuccessPath({
            sessionId: currentSessionId,
            userText: messageInput,
            assistantText: result,
          });
        }
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        this.ui.abort('Operation cancelled.');
      } else {
        this.ui.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      this.isProcessing = false;
      this.currentAbortController = null;
      this.publishSession('Ready');

      if (this.queuedInputs.length > 0) {
        const nextInput = this.queuedInputs.shift();
        if (nextInput) {
          this.ui.info('Running queued input...');
          setImmediate(() => {
            void this.submitInput(nextInput);
          });
        }
      }
    }
  }

  private async syncSessionTaskListBinding(): Promise<void> {
    const taskListId = this.sessionCommands.getCurrentTaskListId();
    if (!taskListId) {
      return;
    }

    process.env.PULSE_CODER_TASK_LIST_ID = taskListId;

    const service = this.agent.getService<TaskListService>('taskListService');
    if (!service?.setTaskListId) {
      return;
    }

    try {
      const result = await service.setTaskListId(taskListId);
      if (result.switched) {
        this.ui.success(`Switched task list to ${result.taskListId}`);
      }
    } catch (error: any) {
      this.ui.warn(`Failed to switch task list binding: ${error?.message ?? String(error)}`);
    }
  }

  private resolveCurrentSessionId(): string | null {
    const currentId = this.sessionCommands.getCurrentSessionId();
    if (currentId) {
      return currentId;
    }

    this.ui.warn('No active session ID; memory tools and daily logs are skipped for this run.');
    return null;
  }

  private publishSession(status: string): void {
    this.ui.updateSnapshot({
      sessionId: this.sessionCommands.getCurrentSessionId(),
      taskListId: this.sessionCommands.getCurrentTaskListId(),
      messages: this.context.messages.length,
      estimatedTokens: this.estimateTokens(this.context.messages),
      mode: this.agent.getMode(),
      isProcessing: this.isProcessing,
      status,
    });
  }

  private notify(snapshot: InkCliSnapshot): void {
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private estimateTokens(messages: Context['messages']): number {
    let totalChars = 0;

    for (const message of messages) {
      totalChars += message.role.length;
      if (typeof message.content === 'string') {
        totalChars += message.content.length;
      } else {
        totalChars += this.safeStringify(message.content).length;
      }
    }

    return Math.ceil(totalChars / 4);
  }

  private getKeepLastTurns(): number {
    const value = Number(process.env.KEEP_LAST_TURNS ?? 4);
    if (!Number.isFinite(value) || value <= 0) {
      return 4;
    }

    return Math.floor(value);
  }

  private getToolInput(toolCall: Record<string, unknown>): unknown {
    const input = (toolCall as { input?: unknown }).input;
    if (input !== undefined) {
      return input;
    }
    const args = (toolCall as { args?: unknown }).args;
    if (args !== undefined) {
      return args;
    }
    return undefined;
  }

  private resolveToolName(payload: Record<string, unknown>): string {
    const name = (payload as { toolName?: unknown }).toolName
      ?? (payload as { name?: unknown }).name
      ?? (payload as { tool?: unknown }).tool
      ?? (payload as { title?: unknown }).title
      ?? (payload as { kind?: unknown }).kind;
    if (typeof name === 'string' && name.trim()) {
      return name;
    }
    const toolCallId = (payload as { toolCallId?: unknown }).toolCallId;
    if (typeof toolCallId === 'string' && toolCallId.trim()) {
      return toolCallId;
    }
    return 'tool';
  }
}

export async function createInkCoderController(): Promise<InkCliController> {
  const controller = new InkCoderController();
  await controller.initialize();
  return controller;
}
