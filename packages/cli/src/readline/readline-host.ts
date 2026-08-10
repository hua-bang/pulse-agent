import { DEFAULT_MODEL, PulseAgent } from 'pulse-coder-engine';
import * as readline from 'readline';
import type { Context, TaskListService } from 'pulse-coder-engine';
import { SessionCommands } from '../commands/session-commands.js';
import { InputManager } from '../shared/input-manager.js';
import { SkillCommands } from '../commands/skill-commands.js';
import { memoryIntegration, buildMemoryRunContext, recordDailyLogFromSuccessPath } from '../shared/memory-integration.js';
import { TuiRenderer, type TuiHelpItem } from './tui-renderer.js';
import { formatModelSpec, loadModelRegistry, resolveKnownModelSpec, resolveModelSpec, type ModelChoice } from '../models/model-registry.js';
import { buildModelRunOptions, resolveModelChoice } from '../models/model-run-options.js';
import { createPulseCliTools } from '../tools/runtime-tools.js';

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
  'model',
  'skills',
  'wt',
  'status',
  'mode',
  'chat',
  'plan',
  'edit',
  'auto',
  'execute',
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
  { command: '/model [<spec>|reset]', description: 'Show candidates or switch the model for this session' },
  { command: '/skills [list|<name|index> <message>]', description: 'Run one message with a selected skill' },
  { command: '/wt use <work-name>', description: 'Create a worktree + branch via worktree skill' },
  { command: '/status', description: 'Show current session status' },
  { command: '/mode', description: 'Show current plan mode' },
  { command: '/plan', description: 'Switch to planning mode' },
  { command: '/execute', description: 'Switch to executing mode' },
  { command: '/save', description: 'Save current session explicitly' },
  { command: '/tui [on|off|status]', description: 'Toggle or inspect the interactive TUI renderer' },
  { command: '/exit', description: 'Exit the application' },
];

/** Retired from the command surface; see ink-controller.ts RETIRED_COMMANDS. */
const RETIRED_COMMANDS: Record<string, string> = {
  team: '/team is retired — use sub-agents instead.',
  teams: '/teams is retired — use sub-agents instead.',
  solo: '/solo is retired along with /teams.',
  acp: '/acp is retired — the CLI no longer proxies to external ACP agents.',
};

const HELP_FOOTER = [
  'Esc (while processing) - Stop current response and accept next input',
  'Ctrl+C - Exit CLI immediately',
];

export class CoderCLI {
  private agent: PulseAgent;
  private context: Context;
  private sessionCommands: SessionCommands;
  private inputManager: InputManager;
  private skillCommands: SkillCommands;
  private tui: TuiRenderer;
  private modelChoice: ModelChoice | null = null;

  constructor(private readonly modelSpec?: string) {
    // 🎯 现在引擎自动包含内置插件，无需显式配置！
    this.agent = new PulseAgent({
      enginePlugins: {
        plugins: [memoryIntegration.enginePlugin],
        // 只配置扩展插件目录，内置插件会自动加载
        dirs: ['.pulse-coder/engine-plugins', '.coder/engine-plugins', '~/.pulse-coder/engine-plugins', '~/.coder/engine-plugins'],
        scan: true
      },
      userConfigPlugins: {
        dirs: ['.pulse-coder/config', '.coder/config', '~/.pulse-coder/config', '~/.coder/config'],
        scan: true
      },
      tools: createPulseCliTools()
      // 注意：不再需要 plugins: [...] 配置
    });
    this.context = { messages: [] };
    this.sessionCommands = new SessionCommands();
    // Mirrors the Ink host: saves record the active model so a resumed session
    // comes back on the model it was using.
    this.sessionCommands.setModelSpecProvider(() =>
      this.modelChoice ? formatModelSpec(this.modelChoice) : null);
    this.inputManager = new InputManager();
    this.skillCommands = new SkillCommands(this.agent);
    this.tui = new TuiRenderer();
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


  private resolveCurrentSessionId(): string | null {
    const currentId = this.sessionCommands.getCurrentSessionId();
    if (currentId) {
      return currentId;
    }

    this.tui.warn('No active session ID; memory tools and daily logs are skipped for this run.');
    return null;
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
        this.tui.success(`Switched task list to ${result.taskListId}`);
      }
    } catch (error: any) {
      this.tui.warn(`Failed to switch task list binding: ${error?.message ?? String(error)}`);
    }
  }

  private async handleCommand(command: string, args: string[]): Promise<void> {
    try {
      switch (command.toLowerCase()) {
        case 'help':
          this.tui.showHelp(HELP_ITEMS, HELP_FOOTER);
          break;

        case 'new':
          const newTitle = args.join(' ') || undefined;
          await this.sessionCommands.createSession(newTitle);
          this.context.messages = [];
          await this.syncSessionTaskListBinding();
          break;

        case 'resume':
          if (args.length === 0) {
            this.tui.error('Please provide a session ID');
            this.tui.info('Usage: /resume <session-id>');
            break;
          }
          const sessionId = args[0];
          const success = await this.sessionCommands.resumeSession(sessionId);
          if (success) {
            await this.sessionCommands.loadContext(this.context);
            await this.restoreSessionModel();
            await this.syncSessionTaskListBinding();
          }
          break;

        case 'sessions':
          {
            const allDirectories = args.some(arg => arg === '--all' || arg === '-a');
            const countArg = args.find(arg => /^\d+$/.test(arg));
            await this.sessionCommands.listSessions(countArg ? Number(countArg) : undefined, { allDirectories });
          }
          break;

        case 'search':
          if (args.length === 0) {
            this.tui.error('Please provide a search query');
            this.tui.info('Usage: /search <query>');
            break;
          }
          const query = args.join(' ');
          await this.sessionCommands.searchSessions(query);
          break;

        case 'rename':
          if (args.length < 2) {
            this.tui.error('Please provide session ID and new title');
            this.tui.info('Usage: /rename <session-id> <new-title>');
            break;
          }
          const renameId = args[0];
          const newName = args.slice(1).join(' ');
          await this.sessionCommands.renameSession(renameId, newName);
          break;

        case 'delete':
          if (args.length === 0) {
            this.tui.error('Please provide a session ID');
            this.tui.info('Usage: /delete <session-id>');
            break;
          }
          const deleteId = args[0];
          await this.sessionCommands.deleteSession(deleteId);
          break;

        case 'clear':
          this.context.messages = [];
          this.tui.success('Current conversation cleared!');
          break;

        case 'model':
          await this.handleModelCommand(args);
          break;

        case 'compact':
          if (this.context.messages.length === 0) {
            this.tui.info('Context is empty, nothing to compact.');
            break;
          }

          const beforeCount = this.context.messages.length;
          const beforeTokens = this.estimateTokens(this.context.messages);
          const keepLastTurns = this.getKeepLastTurns();
          const compactResult = await this.agent.compactContext(this.context, { force: true });

          if (!compactResult.didCompact || !compactResult.newMessages) {
            this.tui.info('No compaction was applied.');
            this.tui.plain(`Messages: ${beforeCount}, estimated tokens: ~${beforeTokens}, KEEP_LAST_TURNS=${keepLastTurns}`);
            break;
          }

          this.context.messages = compactResult.newMessages;
          await this.sessionCommands.saveContext(this.context);

          const afterCount = this.context.messages.length;
          const afterTokens = this.estimateTokens(this.context.messages);
          const tokenDelta = beforeTokens - afterTokens;
          const tokenDeltaText = tokenDelta >= 0 ? `-${tokenDelta}` : `+${Math.abs(tokenDelta)}`;
          const reasonSuffix = compactResult.reason ? ` (${compactResult.reason})` : '';

          this.tui.section(`Context compacted${reasonSuffix}`, [
            `Messages: ${beforeCount} -> ${afterCount}`,
            `Estimated tokens: ~${beforeTokens} -> ~${afterTokens} (${tokenDeltaText})`,
            `KEEP_LAST_TURNS=${keepLastTurns}`,
          ]);
          break;

        case 'skills':
          this.tui.info('Use /skills <name|index> <message> directly in input for one-shot skill execution.');
          break;

        case 'status':
          const currentId = this.sessionCommands.getCurrentSessionId();
          const currentTaskListId = this.sessionCommands.getCurrentTaskListId();
          this.tui.section('Session Status', [
            `Current Session: ${currentId || 'None (new session)'}`,
            `Task List: ${currentTaskListId || 'None'}`,
            `Messages: ${this.context.messages.length}`,
            ...(currentId ? ['To save this session, use: /save'] : []),
          ]);
          break;

        // NOTE: `case 'mode'` belongs to the switch group below, which handles
        // both the bare `/mode` query and `/mode <target>`. An earlier duplicate
        // clause here used to shadow it, so `/mode plan` only ever printed the
        // current mode and never switched.
        case 'chat':
        case 'auto':
        case 'edit':
        case 'mode':
          if (command.toLowerCase() === 'mode' && !args[0]) {
            this.tui.info(`Current mode: ${this.agent.getMode() ?? 'unavailable'}`);
            break;
          }
          {
            const requested = command.toLowerCase() === 'mode' ? args[0]?.toLowerCase() : command.toLowerCase();
            const target = requested === 'plan' || requested === 'planning' ? 'planning' : 'executing';
            if (this.agent.setMode(target, `cli:/${command.toLowerCase()}`)) {
              this.tui.success(`Switched to ${target} mode`);
            } else {
              this.tui.error('Failed to switch mode: plan mode plugin unavailable');
            }
          }
          break;

        case 'plan':
          if (this.agent.setMode('planning', 'cli:/plan')) {
            this.tui.success('Switched to planning mode');
          } else {
            this.tui.error('Failed to switch mode: plan mode plugin unavailable');
          }
          break;

        case 'execute':
          if (this.agent.setMode('executing', 'cli:/execute')) {
            this.tui.success('Switched to executing mode');
          } else {
            this.tui.error('Failed to switch mode: plan mode plugin unavailable');
          }
          break;

        case 'tui': {
          const action = (args[0] ?? 'status').toLowerCase();
          if (action === 'on') {
            if (this.tui.setEnabled(true)) {
              this.tui.success('TUI enabled for this process.');
            } else {
              this.tui.warn('TUI is not available in this terminal. Staying in plain mode.');
            }
          } else if (action === 'off') {
            this.tui.setEnabled(false);
            this.tui.info('TUI disabled for this process.');
          } else if (action === 'status') {
            this.tui.showTuiStatus();
          } else {
            this.tui.warn('Usage: /tui [on|off|status]');
          }
          break;
        }

        case 'save':
          if (this.sessionCommands.getCurrentSessionId()) {
            await this.sessionCommands.saveContext(this.context);
            this.tui.success('Current session saved!');
          } else {
            this.tui.error('No active session. Create one with /new');
          }
          break;

        case 'exit':
          this.tui.info('Saving current session...');
          await this.sessionCommands.saveContext(this.context);
          this.tui.success('Goodbye!');
          process.exit(0);
          break;

        default:
          this.tui.warn(`Unknown command: ${command}`);
          this.tui.info('Type /help to see available commands');
      }
    } catch (error) {
      this.tui.error(`Error executing command: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * `/model` for the readline host. No modal picker here (that is Ink-only), so
   * the list is printed with indexes and switching is `/model <spec|index>` —
   * the same registry, resolver and run options the Ink host uses.
   */
  private async handleModelCommand(args: string[]): Promise<void> {
    const registry = await loadModelRegistry();
    registry.warnings.forEach(warning => this.tui.warn(`[models.json] ${warning}`));

    const describe = (choice: ModelChoice | null) =>
      (choice ? `${formatModelSpec(choice)}${choice.contextWindow ? ` · ${Math.round(choice.contextWindow / 1000)}k ctx` : ''}` : `${DEFAULT_MODEL} (env default)`);
    const spec = args[0]?.trim();

    if (!spec) {
      this.tui.section('Model', [
        `Current: ${describe(this.modelChoice)}`,
        ...(registry.models.length > 0
          ? ['Candidates:', ...registry.models.map((choice, index) => `  ${index + 1}. ${describe(choice)}`)]
          : ['No candidates in models.json — see README §模型候选配置']),
        'Switch: /model <index> · /model <id> · /model <provider>:<id> · /model reset',
      ]);
      return;
    }

    if (spec === 'reset') {
      this.modelChoice = null;
      this.tui.success(`Model reset to ${DEFAULT_MODEL} (env default)`);
      return;
    }

    // A numeric spec is ALWAYS an index — never let it fall through to the
    // lenient resolver, which would happily accept a model literally named "1".
    if (/^\d+$/.test(spec)) {
      const byIndex = registry.models[Number(spec) - 1];
      if (!byIndex) {
        this.tui.error(`No candidate #${spec}. Run /model to see the list.`);
        return;
      }
      this.modelChoice = byIndex;
      this.tui.success(`Model switched to ${describe(byIndex)}`);
      return;
    }

    const resolved = resolveModelSpec(spec, registry);
    if (!resolved) {
      this.tui.error(`Unknown model "${spec}". Run /model to see the candidates.`);
      return;
    }

    this.modelChoice = resolved;
    this.tui.success(`Model switched to ${describe(resolved)}`);
  }

  /**
   * Applies the model recorded in the just-loaded session (see the Ink host's
   * restoreSessionModel). A --model flag pins the process and wins; an
   * unresolvable spec warns and keeps the current model.
   */
  private async restoreSessionModel(): Promise<void> {
    const spec = this.sessionCommands.getLoadedModelSpec();
    if (!spec || this.modelSpec) {
      return;
    }
    if (this.modelChoice && formatModelSpec(this.modelChoice) === spec) {
      return;
    }

    const registry = await loadModelRegistry();
    const restored = resolveKnownModelSpec(spec, registry);
    if (!restored) {
      this.tui.warn(`Session model "${spec}" is no longer in models.json — keeping the current model`);
      return;
    }

    this.modelChoice = restored;
    this.tui.info(`Model restored from session: ${formatModelSpec(restored)}`);
  }

  async start(options: { continueLast?: boolean } = {}) {
    this.tui.showWelcome();

    // Resolve --model once, against the same merged home+project registry the Ink
    // host uses, so a provider-bound spec reaches the engine with its connection.
    this.modelChoice = await resolveModelChoice(this.modelSpec, warning => this.tui.info(warning));
    if (this.modelSpec && this.modelChoice) {
      this.tui.info(`Model: ${formatModelSpec(this.modelChoice)}`);
    }

    await this.sessionCommands.initialize();
    await memoryIntegration.initialize();
    await this.agent.initialize();

    // 显示插件状态
    const pluginStatus = this.agent.getPluginStatus();
    this.tui.showPluginStatus(pluginStatus.enginePlugins.length);

    // Resume the most recent session with --continue, otherwise auto-create one
    if (options.continueLast && await this.sessionCommands.resumeLatest()) {
      await this.sessionCommands.loadContext(this.context);
      await this.restoreSessionModel();
    } else {
      await this.sessionCommands.createSession();
    }
    await this.syncSessionTaskListBinding();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.tui.prompt()
    });

    let currentAbortController: AbortController | null = null;
    let isProcessing = false;
    const queuedInputs: string[] = [];

    readline.emitKeypressEvents(process.stdin);

    const requestStopCurrentRun = (): boolean => {
      if (isProcessing) {
        if (currentAbortController && !currentAbortController.signal.aborted) {
          currentAbortController.abort();
          this.tui.abort('Request cancelled by Esc. You can type the next message now.');
        } else {
          this.tui.abort('Cancellation already requested. Waiting for current step to finish...');
        }
        rl.prompt();
        return true;
      }

      if (this.inputManager.hasPendingRequest()) {
        this.inputManager.cancel('User interrupted with Esc');
        this.tui.abort('Clarification cancelled.');
        rl.prompt();
        return true;
      }

      return false;
    };

    const onKeypress = (_char: string, key: readline.Key) => {
      if (key?.name === 'escape') {
        requestStopCurrentRun();
      }
    };

    process.stdin.on('keypress', onKeypress);

    // Handle SIGINT/SIGTERM gracefully.
    //
    // This host runs the terminal in normal mode, so every Ctrl+C is a real
    // signal. Without the re-entrancy guard a second press (the natural reflex,
    // and the gesture the Ink host trains) starts a SECOND concurrent
    // saveContext against the same file, and whichever settles first calls
    // process.exit() without waiting for the other — killing the process
    // mid-write. saveSession is atomic now; this keeps the races out entirely.
    let isShuttingDown = false;
    const shutdown = () => {
      if (isShuttingDown) {
        return;
      }
      isShuttingDown = true;

      process.stdin.off('keypress', onKeypress);

      if (isProcessing && currentAbortController && !currentAbortController.signal.aborted) {
        currentAbortController.abort();
      }

      if (this.inputManager.hasPendingRequest()) {
        this.inputManager.cancel('User interrupted with Ctrl+C');
      }

      this.tui.info('Saving current session...');
      this.sessionCommands.saveContext(this.context).finally(() => {
        this.tui.success('Goodbye!');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Main input handler
    const handleInput = async (input: string) => {
      const trimmedInput = input.trim();

      // Handle clarification requests first. An empty answer to a request that
      // advertised "(Default: x)" means x — same rule as the Ink host, and the
      // substitution is echoed so the user sees what was sent.
      const clarificationAnswer = this.inputManager.resolveAnswer(trimmedInput);
      const substitutedDefault = !trimmedInput && clarificationAnswer;

      if (this.inputManager.handleUserInput(clarificationAnswer)) {
        if (substitutedDefault) {
          this.tui.info(`Using default answer: ${clarificationAnswer}`);
        }
        return;
      }

      if (isProcessing) {
        if (currentAbortController?.signal.aborted) {
          if (!trimmedInput) {
            rl.prompt();
            return;
          }

          queuedInputs.push(trimmedInput);
          this.tui.queued('Input queued. It will run right after the current step finishes.');
          rl.prompt();
          return;
        }

        this.tui.warn('Still processing. Press Esc to stop current request first.');
        rl.prompt();
        return;
      }

      if (trimmedInput.toLowerCase() === 'exit') {
        this.tui.info('Saving current session...');
        await this.sessionCommands.saveContext(this.context);
        this.tui.success('Goodbye!');
        rl.close();
        return;
      }

      if (!trimmedInput) {
        rl.prompt();
        return;
      }

      let messageInput = trimmedInput;

      if (trimmedInput.startsWith('//')) {
        this.tui.warn(`${RETIRED_COMMANDS.acp} The "//" ACP passthrough prefix is retired with it.`);
        rl.prompt();
        return;
      }

      // Handle commands
      if (messageInput.startsWith('/')) {
        const commandLine = messageInput.substring(1);
        const parts = commandLine.split(/\s+/).filter(part => part.length > 0);

        if (parts.length === 0) {
          this.tui.warn('Please provide a command after "/"');
          rl.prompt();
          return;
        }

        const command = parts[0];
        const args = parts.slice(1);
        const normalizedCommand = command.toLowerCase();

        const retiredNotice = RETIRED_COMMANDS[normalizedCommand];
        if (retiredNotice) {
          this.tui.warn(retiredNotice);
          rl.prompt();
          return;
        }

        if (!LOCAL_COMMANDS.has(normalizedCommand)) {
          // built-in > skill > error (same order as the Ink host).
          const skill = this.skillCommands.findSkill(command);
          const skillMessage = args.join(' ').trim();
          if (skill && skillMessage) {
            messageInput = `[use skill](${skill.name}) ${skillMessage}`;
          } else {
            if (skill) {
              this.tui.error(`Usage: /${skill.name} <message>`);
            } else {
              this.tui.warn(`Unknown command: /${command}`);
              this.tui.info('Type /help for commands, /skills list for skills');
            }
            rl.prompt();
            return;
          }
        }

        {
          if (normalizedCommand === 'skills') {
            const transformedMessage = await this.skillCommands.transformSkillsCommandToMessage(args);
            if (!transformedMessage) {
              rl.prompt();
              return;
            }

            messageInput = transformedMessage;
          } else if (normalizedCommand === 'wt') {
            if (args.length < 2 || args[0].toLowerCase() !== 'use') {
              this.tui.error('Usage: /wt use <work-name>');
              rl.prompt();
              return;
            }

            const workName = args.slice(1).join(' ').trim();
            if (!workName) {
              this.tui.error('Worktree name cannot be empty.');
              this.tui.info('Usage: /wt use <work-name>');
              rl.prompt();
              return;
            }

            messageInput = `[use skill](worktree) new ${workName}`;
            this.tui.success('Worktree request prepared via skill: worktree');
          } else {
            await this.handleCommand(command, args);
            rl.prompt();
            return;
          }
        }
      }

      // Regular message processing
      this.tui.session({
        sessionId: this.sessionCommands.getCurrentSessionId(),
        taskListId: this.sessionCommands.getCurrentTaskListId(),
        messages: this.context.messages.length,
        estimatedTokens: this.estimateTokens(this.context.messages),
        mode: this.agent.getMode(),
      });

      if (this.context.messages.length === 0) {
        await this.sessionCommands.maybeAutoTitle(messageInput);
      }

      this.context.messages.push({
        role: 'user',
        content: messageInput,
      });


      this.tui.startProcessing('Running agent');

      const ac = new AbortController();
      currentAbortController = ac;
      isProcessing = true;

      let sawText = false;
      let toolCalls = 0;
      const runStartedAt = Date.now();

      const getToolInput = (toolCall: Record<string, unknown>): unknown => {
        const input = (toolCall as { input?: unknown }).input;
        if (input !== undefined) {
          return input;
        }
        const args = (toolCall as { args?: unknown }).args;
        if (args !== undefined) {
          return args;
        }
        return undefined;
      };

      const resolveToolName = (payload: Record<string, unknown>): string => {
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
      };

      try {
        await this.syncSessionTaskListBinding();

        const currentSessionId = this.resolveCurrentSessionId();

        // Registry-resolved, so a provider-bound spec (`deepseek:v4`) carries its
        // baseUrl/apiKey/contextWindow here exactly as it does in the Ink host.
        const runAgent = async () => this.agent.run(this.context, {
          abortSignal: ac.signal,
          ...buildModelRunOptions(this.modelChoice, process.env, {
            sessionId: this.sessionCommands.getCurrentSessionId(),
          }),
          onText: (delta) => {
            sawText = true;
            this.tui.text(delta);
          },
          onToolCall: (toolCall) => {
            toolCalls += 1;
            const input = getToolInput(toolCall);
            this.tui.toolCall(resolveToolName(toolCall), input);
          },
          onToolResult: (toolResult) => {
            const toolName = resolveToolName(toolResult as Record<string, unknown>);
            this.tui.toolResult(toolName);
          },
          onStepFinish: (step) => {
            this.tui.stepFinished(step.finishReason);
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
        const result = currentSessionId
          ? await memoryIntegration.withRunContext(
            buildMemoryRunContext({
              sessionId: currentSessionId,
              userText: messageInput,
            }),
            runAgent,
          )
          : await runAgent();

        // The engine does not throw on abort: loop() returns the plain sentinel
        // string 'Request aborted.' as an ordinary result, so the AbortError catch
        // below never sees an engine-side cancellation. Without this check the
        // success path would print that sentinel as the model's reply and persist
        // the cancelled turn to the session and the daily log.
        if (ac.signal.aborted) {
          this.tui.abort('Operation cancelled.');
          return;
        }

        this.tui.runSummary({
          elapsedMs: Date.now() - runStartedAt,
          toolCalls,
          messages: this.context.messages.length,
          estimatedTokens: this.estimateTokens(this.context.messages),
          mode: this.agent.getMode(),
        });

        if (result) {
          if (!sawText) {
            this.tui.plain(result);
          } else {
            this.tui.plain();
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
      } catch (error) {
        if (error.name === 'AbortError') {
          this.tui.abort('Operation cancelled.');
        } else {
          this.tui.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      } finally {
        isProcessing = false;
        currentAbortController = null;

        if (queuedInputs.length > 0) {
          const nextInput = queuedInputs.shift();
          if (nextInput) {
            this.tui.info('Running queued input...');
            setImmediate(() => {
              void handleInput(nextInput);
            });
            return;
          }
        }

        rl.prompt();
      }
    };

    // Start the CLI
    rl.prompt();
    rl.on('line', handleInput);

    // Handle terminal close
    rl.on('close', async () => {
      process.stdin.off('keypress', onKeypress);
      this.tui.info('Saving current session...');
      await this.sessionCommands.saveContext(this.context);
      this.tui.success('Goodbye!');
      process.exit(0);
    });
  }
}
