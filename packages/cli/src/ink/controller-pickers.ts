import type { InkCoderController } from './ink-controller.js';
import { publishSession, resetUsageCounters, syncSessionTaskListBinding } from './controller-session.js';
import { formatModelSpec, parseModelSpec, shortModelLabel } from '../models/model-spec.js';
import { loadModelRegistry } from '../models/model-registry.js';
import { DEFAULT_MODEL } from 'pulse-coder-engine';
import { formatRelativeTime } from './ink-app.js';
import { applyModelOverride, describeConnection, restoreSessionModel } from './controller-model.js';

/** Modal pickers rendered in place of the composer (/model, /resume). */

export async function openModelPicker(controller: InkCoderController): Promise<void> {
  const registry = await loadModelRegistry();
  registry.warnings.forEach(warning => controller.ui.log(`[models.json] ${warning}`));
  const currentModel = controller.modelOverride?.model ?? DEFAULT_MODEL;
  const seen = new Set<string>();
  controller.pickerModelChoices = new Map();
  const items = [
    {
      id: DEFAULT_MODEL,
      label: shortModelLabel(DEFAULT_MODEL, 40),
      hint: 'env default',
      preview: DEFAULT_MODEL,
      isCurrent: !controller.modelOverride,
    },
    ...registry.models.map(choice => {
      const id = `${choice.providerName ?? choice.modelType ?? ''}${choice.providerName || choice.modelType ? ':' : ''}${choice.model}`;
      controller.pickerModelChoices.set(id, choice);
      return {
        id,
        label: choice.label ?? shortModelLabel(choice.model, 40),
        hint: `${choice.providerName ?? choice.modelType ?? 'default provider'}${choice.contextWindow ? ` · ${Math.round(choice.contextWindow / 1000)}k ctx` : ''}`,
        preview: choice.model,
        // Marks the row the picker opens on — matching on the full spec, not
        // just the model id, so two providers serving the same id stay apart.
        isCurrent: Boolean(controller.modelOverride) && formatModelSpec(choice) === formatModelSpec(controller.modelOverride!),
      };
    }),
  ].filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  if (items.length <= 1) {
    controller.ui.section('Model', [
      `Current: ${currentModel}${controller.modelOverride ? ' (session override)' : ' (env default)'}`,
      'Switch directly: /model <id> · /model <provider>:<id> · /model claude:<id> · /model reset',
      'Add candidates + providers in .pulse-coder/models.json — see README §模型候选配置',
    ]);
    return;
  }

  controller.activePicker = 'model';
  controller.ui.showPicker({ title: 'Select model', items });
}

export async function openSessionPicker(controller: InkCoderController): Promise<void> {
  const sessions = await controller.sessionCommands.listForPicker();
  if (sessions.length === 0) {
    controller.ui.info('No previous sessions with messages. Use /sessions to list everything.');
    return;
  }

  controller.activePicker = 'session';
  controller.ui.showPicker({
    title: 'Resume session',
    items: sessions.map(session => ({
      id: session.id,
      label: session.title,
      hint: `${session.messageCount} msgs · ${formatRelativeTime(session.updatedAt)}`,
      preview: session.preview,
    })),
  });
}

export async function resumeSessionRef(controller: InkCoderController, ref: string): Promise<void> {
  if (await controller.sessionCommands.resumeSession(ref)) {
    await controller.sessionCommands.loadContext(controller.context);
    await restoreSessionModel(controller);
    resetUsageCounters(controller);
    await syncSessionTaskListBinding(controller);
    publishSession(controller, 'Session resumed');
  }
}

export function pickerSelect(controller: InkCoderController, id: string): void {
  const kind = controller.activePicker;
  controller.activePicker = null;

  if (kind === 'model') {
    controller.ui.hidePicker();
    const choice = controller.pickerModelChoices.get(id) ?? parseModelSpec(id);
    controller.pickerModelChoices = new Map();
    if (choice) {
      const isPlainDefault = choice.model === DEFAULT_MODEL && !choice.modelType && !choice.contextWindow && !choice.providerName;
      controller.modelOverride = isPlainDefault ? null : choice;
      applyModelOverride(controller, controller.modelOverride
        ? `Model set: ${choice.model}${describeConnection(controller, choice)}`
        : 'Model reset to env default', true);
    }
    return;
  }

  controller.ui.hidePicker('Resuming session…');
  void resumeSessionRef(controller, id);
}

export function pickerCancel(controller: InkCoderController): void {
  controller.activePicker = null;
  controller.ui.hidePicker();
  publishSession(controller, 'Ready');
}
