import { DEFAULT_MODEL } from 'pulse-coder-engine';
import type { FileGoalPluginService } from 'pulse-coder-plugin-kit/goal';
import { formatModelSpec, resolveModelSpec, type ModelChoice } from '../models/model-spec.js';
import { loadModelRegistry } from '../models/model-registry.js';
import { parseGoalSetArgs } from '../ink/controller-commands.js';
import { HELP_FOOTER, HELP_ITEMS } from './command-surface.js';
import { estimateTokens, getKeepLastTurns, restoreSessionModel, syncSessionTaskListBinding, type ReadlineHost } from './host-context.js';

/** Slash-command handlers for the readline host (the Ink host has its own controller). */
export class ReadlineCommands {
  constructor(private readonly host: ReadlineHost) {}

  async handleCommand(command: string, args: string[]): Promise<void> {
    try {
      switch (command.toLowerCase()) {
        case 'help':
          this.host.tui.showHelp(HELP_ITEMS, HELP_FOOTER);
          break;

        case 'new':
          const newTitle = args.join(' ') || undefined;
          await this.host.sessionCommands.createSession(newTitle);
          this.host.context.messages = [];
          await syncSessionTaskListBinding(this.host);
          break;

        case 'resume':
          if (args.length === 0) {
            this.host.tui.error('Please provide a session ID');
            this.host.tui.info('Usage: /resume <session-id>');
            break;
          }
          const sessionId = args[0];
          const success = await this.host.sessionCommands.resumeSession(sessionId);
          if (success) {
            await this.host.sessionCommands.loadContext(this.host.context);
            await restoreSessionModel(this.host);
            await syncSessionTaskListBinding(this.host);
          }
          break;

        case 'sessions':
          {
            const allDirectories = args.some(arg => arg === '--all' || arg === '-a');
            const countArg = args.find(arg => /^\d+$/.test(arg));
            await this.host.sessionCommands.listSessions(countArg ? Number(countArg) : undefined, { allDirectories });
          }
          break;

        case 'search':
          if (args.length === 0) {
            this.host.tui.error('Please provide a search query');
            this.host.tui.info('Usage: /search <query>');
            break;
          }
          const query = args.join(' ');
          await this.host.sessionCommands.searchSessions(query);
          break;

        case 'rename':
          if (args.length < 2) {
            this.host.tui.error('Please provide session ID and new title');
            this.host.tui.info('Usage: /rename <session-id> <new-title>');
            break;
          }
          const renameId = args[0];
          const newName = args.slice(1).join(' ');
          await this.host.sessionCommands.renameSession(renameId, newName);
          break;

        case 'delete':
          if (args.length === 0) {
            this.host.tui.error('Please provide a session ID');
            this.host.tui.info('Usage: /delete <session-id>');
            break;
          }
          const deleteId = args[0];
          await this.host.sessionCommands.deleteSession(deleteId);
          break;

        case 'clear':
          this.host.context.messages = [];
          this.host.tui.success('Current conversation cleared!');
          break;

        case 'model':
          await this.handleModelCommand(args);
          break;

        case 'compact':
          if (this.host.context.messages.length === 0) {
            this.host.tui.info('Context is empty, nothing to compact.');
            break;
          }

          const beforeCount = this.host.context.messages.length;
          const beforeTokens = estimateTokens(this.host.context.messages);
          const keepLastTurns = getKeepLastTurns();
          const compactResult = await this.host.agent.compactContext(this.host.context, { force: true });

          if (!compactResult.didCompact || !compactResult.newMessages) {
            this.host.tui.info('No compaction was applied.');
            this.host.tui.plain(`Messages: ${beforeCount}, estimated tokens: ~${beforeTokens}, KEEP_LAST_TURNS=${keepLastTurns}`);
            break;
          }

          this.host.context.messages = compactResult.newMessages;
          await this.host.sessionCommands.saveContext(this.host.context);

          const afterCount = this.host.context.messages.length;
          const afterTokens = estimateTokens(this.host.context.messages);
          const tokenDelta = beforeTokens - afterTokens;
          const tokenDeltaText = tokenDelta >= 0 ? `-${tokenDelta}` : `+${Math.abs(tokenDelta)}`;
          const reasonSuffix = compactResult.reason ? ` (${compactResult.reason})` : '';

          this.host.tui.section(`Context compacted${reasonSuffix}`, [
            `Messages: ${beforeCount} -> ${afterCount}`,
            `Estimated tokens: ~${beforeTokens} -> ~${afterTokens} (${tokenDeltaText})`,
            `KEEP_LAST_TURNS=${keepLastTurns}`,
          ]);
          break;

        case 'skills':
          this.host.tui.info('Use /skills <name|index> <message> directly in input for one-shot skill execution.');
          break;

        case 'goal': {
          const subcommand = (args[0] ?? '').toLowerCase();
          const goalService = this.host.agent.getService<FileGoalPluginService>('goalService');
          if (!goalService) {
            this.host.tui.warn('Goal plugin unavailable.');
            break;
          }

          if (subcommand === 'status') {
            const snapshot = await goalService.snapshot();
            if (snapshot.status === 'none') {
              this.host.tui.info('No active goal. Set one with /goal <objective>');
              break;
            }
            this.host.tui.section('Goal', [
              `Status: ${snapshot.status}`,
              `Objective: ${snapshot.objective ?? '(none)'}`,
              `Rounds used: ${snapshot.roundsUsed}${snapshot.maxRounds ? `/${snapshot.maxRounds}` : ''}`,
              snapshot.verifyCommand ? `Verify: ${snapshot.verifyCommand}` : null,
              snapshot.lastProgress ? `Last progress: ${snapshot.lastProgress}` : null,
              snapshot.completedSummary ? `Completed: ${snapshot.completedSummary}` : null,
            ].filter((line): line is string => line !== null));
            break;
          }

          if (subcommand === 'clear') {
            const cleared = await goalService.clearGoal();
            this.host.tui[cleared ? 'success' : 'info'](cleared ? 'Goal cleared.' : 'No active goal to clear.');
            break;
          }

          if (subcommand === 'complete') {
            const summary = args.slice(1).join(' ').trim() || 'Marked complete by user';
            const goal = await goalService.completeGoal({ summary });
            this.host.tui[goal ? 'success' : 'info'](goal ? 'Goal marked complete.' : 'No active goal to complete.');
            break;
          }

          if (subcommand === 'help' || subcommand === '') {
            this.host.tui.section('Goal usage', [
              '/goal <objective>            Set a goal the agent keeps working toward',
              '/goal <objective> --verify <cmd>  Also verify completion by running <cmd>',
              '/goal <objective> --rounds <n>    Limit automatic continuation rounds to <n>',
              '/goal status                  Show the current goal and progress',
              '/goal complete [summary]      Mark the current goal complete',
              '/goal clear                   Stop working toward the goal',
            ]);
            break;
          }

          const { objective, verifyCommand, maxRounds } = parseGoalSetArgs(args);
          if (!objective) {
            this.host.tui.error('Please provide a goal objective.');
            this.host.tui.info('Usage: /goal <objective> [--verify <cmd>] [--rounds <n>]');
            break;
          }

          const goal = await goalService.setGoal({ objective, verifyCommand, maxRounds });
          this.host.tui.success('Goal set.');
          this.host.tui.section('Active goal', [
            `Objective: ${goal.objective}`,
            goal.verifyCommand ? `Verify: ${goal.verifyCommand}` : 'Verify: none (declaration + user confirmation)',
            `Max rounds: ${goal.maxRounds ?? 'unlimited'}`,
          ]);
          this.host.tui.info('The agent keeps working toward this goal until it is met, verified, or you stop it.');
          break;
        }

        case 'status':
          const currentId = this.host.sessionCommands.getCurrentSessionId();
          const currentTaskListId = this.host.sessionCommands.getCurrentTaskListId();
          this.host.tui.section('Session Status', [
            `Current Session: ${currentId || 'None (new session)'}`,
            `Task List: ${currentTaskListId || 'None'}`,
            `Messages: ${this.host.context.messages.length}`,
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
            this.host.tui.info(`Current mode: ${this.host.agent.getMode() ?? 'unavailable'}`);
            break;
          }
          {
            const requested = command.toLowerCase() === 'mode' ? args[0]?.toLowerCase() : command.toLowerCase();
            const target = requested === 'plan' || requested === 'planning' ? 'planning' : 'executing';
            if (this.host.agent.setMode(target, `cli:/${command.toLowerCase()}`)) {
              this.host.tui.success(`Switched to ${target} mode`);
            } else {
              this.host.tui.error('Failed to switch mode: plan mode plugin unavailable');
            }
          }
          break;

        case 'plan':
          if (this.host.agent.setMode('planning', 'cli:/plan')) {
            this.host.tui.success('Switched to planning mode');
          } else {
            this.host.tui.error('Failed to switch mode: plan mode plugin unavailable');
          }
          break;

        case 'execute':
          if (this.host.agent.setMode('executing', 'cli:/execute')) {
            this.host.tui.success('Switched to executing mode');
          } else {
            this.host.tui.error('Failed to switch mode: plan mode plugin unavailable');
          }
          break;

        case 'tui': {
          const action = (args[0] ?? 'status').toLowerCase();
          if (action === 'on') {
            if (this.host.tui.setEnabled(true)) {
              this.host.tui.success('TUI enabled for this process.');
            } else {
              this.host.tui.warn('TUI is not available in this terminal. Staying in plain mode.');
            }
          } else if (action === 'off') {
            this.host.tui.setEnabled(false);
            this.host.tui.info('TUI disabled for this process.');
          } else if (action === 'status') {
            this.host.tui.showTuiStatus();
          } else {
            this.host.tui.warn('Usage: /tui [on|off|status]');
          }
          break;
        }

        case 'save':
          if (this.host.sessionCommands.getCurrentSessionId()) {
            await this.host.sessionCommands.saveContext(this.host.context);
            this.host.tui.success('Current session saved!');
          } else {
            this.host.tui.error('No active session. Create one with /new');
          }
          break;

        case 'exit':
          this.host.tui.info('Saving current session...');
          await this.host.sessionCommands.saveContext(this.host.context);
          this.host.tui.success('Goodbye!');
          process.exit(0);
          break;

        default:
          this.host.tui.warn(`Unknown command: ${command}`);
          this.host.tui.info('Type /help to see available commands');
      }
    } catch (error) {
      this.host.tui.error(`Error executing command: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * `/model` for the readline host. No modal picker here (that is Ink-only), so
   * the list is printed with indexes and switching is `/model <spec|index>` —
   * the same registry, resolver and run options the Ink host uses.
   */
  private async handleModelCommand(args: string[]): Promise<void> {
    const registry = await loadModelRegistry();
    registry.warnings.forEach(warning => this.host.tui.warn(`[models.json] ${warning}`));

    const describe = (choice: ModelChoice | null) =>
      (choice ? `${formatModelSpec(choice)}${choice.contextWindow ? ` · ${Math.round(choice.contextWindow / 1000)}k ctx` : ''}` : `${DEFAULT_MODEL} (env default)`);
    const spec = args[0]?.trim();

    if (!spec) {
      this.host.tui.section('Model', [
        `Current: ${describe(this.host.modelChoice)}`,
        ...(registry.models.length > 0
          ? ['Candidates:', ...registry.models.map((choice, index) => `  ${index + 1}. ${describe(choice)}`)]
          : ['No candidates in models.json — see README §模型候选配置']),
        'Switch: /model <index> · /model <id> · /model <provider>:<id> · /model reset',
      ]);
      return;
    }

    if (spec === 'reset') {
      this.host.modelChoice = null;
      this.host.tui.success(`Model reset to ${DEFAULT_MODEL} (env default)`);
      return;
    }

    // A numeric spec is ALWAYS an index — never let it fall through to the
    // lenient resolver, which would happily accept a model literally named "1".
    if (/^\d+$/.test(spec)) {
      const byIndex = registry.models[Number(spec) - 1];
      if (!byIndex) {
        this.host.tui.error(`No candidate #${spec}. Run /model to see the list.`);
        return;
      }
      this.host.modelChoice = byIndex;
      this.host.tui.success(`Model switched to ${describe(byIndex)}`);
      return;
    }

    const resolved = resolveModelSpec(spec, registry);
    if (!resolved) {
      this.host.tui.error(`Unknown model "${spec}". Run /model to see the candidates.`);
      return;
    }

    this.host.modelChoice = resolved;
    this.host.tui.success(`Model switched to ${describe(resolved)}`);
  }
}
