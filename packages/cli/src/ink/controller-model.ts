import { DEFAULT_MODEL } from 'pulse-coder-engine';
import type { InkCoderController } from './ink-controller.js';
import { publishSession } from './controller-session.js';
import { CONTEXT_WINDOW_TOKENS } from 'pulse-coder-engine';
import { findDefaultModel, formatModelSpec, resolveKnownModelSpec, resolveModelSpec, shortModelLabel, type ModelChoice } from '../models/model-spec.js';
import { loadModelRegistry } from '../models/model-registry.js';
import { buildModelRunOptions, type ModelRunOptions } from '../models/model-run-options.js';

/** Model choice lifecycle for the Ink host: startup resolution, /model
 *  overrides, per-session restore, and engine run options. */

/**
 * Model precedence at startup:
 *   1. --model flag (this run only)
 *   2. the last /model choice, persisted in ~/.pulse-coder/preferences.json
 *   3. a models.json entry marked "default": true
 *   4. the engine's env default (ANTHROPIC_MODEL / OPENAI_MODEL / …)
 */
export async function resolveStartupModel(controller: InkCoderController): Promise<void> {
  const registry = await loadModelRegistry();
  registry.warnings.forEach(warning => controller.ui.log(`[models.json] ${warning}`));

  if (controller.modelPinnedByFlag) {
    // Re-resolve the flag against the registry so it picks up the entry's
    // provider connection and contextWindow, not just the bare id.
    if (controller.modelOverride) {
      controller.modelOverride = resolveModelSpec(formatModelSpec(controller.modelOverride), registry) ?? controller.modelOverride;
    }
    applyModelOverride(controller, `Model pinned by --model: ${controller.modelOverride?.model}`);
    return;
  }

  const preferences = await controller.preferences.load();
  if (preferences.lastModel) {
    // Strict on purpose: a silent restore must not resurrect a spec whose
    // provider has since left models.json as a literal `provider:model` id.
    const restored = resolveKnownModelSpec(preferences.lastModel, registry);
    if (restored) {
      controller.modelOverride = restored;
      applyModelOverride(controller, `Model restored from last session: ${restored.model}`);
      return;
    }
    controller.ui.log(`[warn] last model "${preferences.lastModel}" is no longer in models.json — using the default`);
  }

  const fallback = findDefaultModel(registry);
  if (fallback) {
    controller.modelOverride = fallback;
    applyModelOverride(controller, `Model from models.json default: ${fallback.model}`);
  }
}

export function currentContextWindow(controller: InkCoderController): number {
  return controller.modelOverride?.contextWindow ?? CONTEXT_WINDOW_TOKENS;
}

export function describeConnection(controller: InkCoderController, choice: ModelChoice): string {
  if (choice.providerName) {
    return ` (provider ${choice.providerName})`;
  }
  return choice.modelType ? ` (${choice.modelType})` : '';
}

export function applyModelOverride(controller: InkCoderController, note: string, persist = false): void {
  if (persist) {
    void controller.preferences.update({ lastModel: controller.modelOverride ? formatModelSpec(controller.modelOverride) : null });
  }
  controller.ui.updateSnapshot({
    modelLabel: shortModelLabel(controller.modelOverride?.model ?? DEFAULT_MODEL),
    contextWindowTokens: currentContextWindow(controller),
  });
  const keyEnv = controller.modelOverride?.apiKeyEnv;
  if (keyEnv && !process.env[keyEnv]) {
    controller.ui.log(`[warn] ${keyEnv} is not set — falling back to the channel's default API key env`);
  }
  controller.ui.info(`${note} · ctx window ${Math.round(currentContextWindow(controller) / 1000)}k · applies to new runs in this process`);
  publishSession(controller, 'Ready');
}

/** Per-run overrides derived from the model choice; a provider-bound choice gets its own connection factory. */
export function modelRunOptions(controller: InkCoderController): ModelRunOptions {
  // Session-anchored so opt-in providers get a stable prompt_cache_key:
  // /resume restores the session's key, /new and model switches change an
  // input and produce a fresh one.
  return buildModelRunOptions(controller.modelOverride, process.env, {
    sessionId: controller.sessionCommands.getCurrentSessionId(),
  });
}

/**
 * Applies the model recorded in the just-loaded session, so a resumed
 * conversation continues on the model it was actually using. Silent restore:
 * it never overwrites the global last-model preference (that records
 * explicit choices only), and --model still pins the whole process.
 */
export async function restoreSessionModel(controller: InkCoderController): Promise<void> {
  const spec = controller.sessionCommands.getLoadedModelSpec();
  if (!spec || controller.modelPinnedByFlag) {
    return;
  }
  if (controller.modelOverride && formatModelSpec(controller.modelOverride) === spec) {
    return;
  }

  const registry = await loadModelRegistry();
  const restored = resolveKnownModelSpec(spec, registry);
  if (!restored) {
    controller.ui.log(`[warn] session model "${spec}" is no longer in models.json — keeping the current model`);
    return;
  }

  controller.modelOverride = restored;
  applyModelOverride(controller, `Model restored from session: ${restored.model}`);
}
