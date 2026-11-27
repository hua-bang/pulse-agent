import './modelSettings.css';
import type { WebHostAuthSession } from './types';

export interface WebLlmConfig {
  provider: 'openai' | 'anthropic';
  apiKey: string;
  baseUrl: string;
  model: string;
}

const WEB_LLM_STORAGE_KEY = 'pulse-web-host:llm-v1';

export function readStoredWebLlmConfig(): WebLlmConfig | null {
  try {
    const raw = window.localStorage.getItem(WEB_LLM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WebLlmConfig>;
    const provider = parsed.provider === 'anthropic' ? 'anthropic' : 'openai';
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
    const baseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : '';
    const model = typeof parsed.model === 'string' ? parsed.model.trim() : '';
    if (!apiKey && !baseUrl && !model) return null;
    return { provider, apiKey, baseUrl, model };
  } catch {
    return null;
  }
}

function saveStoredWebLlmConfig(config: WebLlmConfig): void {
  try {
    window.localStorage.setItem(WEB_LLM_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage errors in private browsing.
  }
}

export function openWebModelSettingsModal(session: WebHostAuthSession): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('pulse-web-model-modal');
  if (existing) existing.remove();

  const isZh = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
  const stored = readStoredWebLlmConfig();
  const isAdmin = session.role === 'admin';

  const copy = isZh
    ? {
        eyebrow: 'PULSE AGENT · 模型设置',
        title: '配置 Agent 模型',
        subtitle: '保存后即可在 Web/手机端直接驱动 VPS 环境工具、画布工具与 Skills。',
        provider: '接口协议',
        apiKey: 'API Key',
        apiKeyPlaceholder: 'sk-... 或留空使用 VPS 已保存的 Key',
        baseUrl: 'Base URL（可选）',
        baseUrlPlaceholder: 'https://api.openai.com/v1',
        model: '模型名称',
        modelPlaceholder: '输入或点击右侧「拉取模型」选择',
        fetchModels: '拉取模型',
        fetchingModels: '拉取中...',
        pickModel: '选择已拉取的模型…',
        syncVps: '同步保存到 VPS（所有设备免重复配置）',
        save: '保存配置',
        saving: '保存中...',
        cancel: '取消',
        savedLocal: '已保存到当前浏览器',
        savedVps: '已保存到当前浏览器与 VPS',
      }
    : {
        eyebrow: 'PULSE AGENT · MODEL',
        title: 'Configure Agent Model',
        subtitle: 'Run VPS environment tools, canvas tools, and skills directly from Web/Mobile.',
        provider: 'Provider Protocol',
        apiKey: 'API Key',
        apiKeyPlaceholder: 'sk-... (leave blank to reuse VPS saved key)',
        baseUrl: 'Base URL (optional)',
        baseUrlPlaceholder: 'https://api.openai.com/v1',
        model: 'Model ID',
        modelPlaceholder: 'Type or click Fetch Models',
        fetchModels: 'Fetch Models',
        fetchingModels: 'Fetching...',
        pickModel: 'Select a fetched model…',
        syncVps: 'Also save to VPS (shared across all devices)',
        save: 'Save Model',
        saving: 'Saving...',
        cancel: 'Cancel',
        savedLocal: 'Saved in this browser',
        savedVps: 'Saved in browser and VPS',
      };

  const backdrop = document.createElement('div');
  backdrop.id = 'pulse-web-model-modal';
  backdrop.className = 'pulse-web-auth-backdrop pulse-web-model-backdrop';
  backdrop.innerHTML = `
    <form class="pulse-web-auth-card" id="pulse-web-model-form">
      <div class="pulse-web-auth-header">
        <img class="pulse-web-auth-logo" src="/icon.png" alt="Pulse Canvas" />
        <div class="pulse-web-auth-heading">
          <span class="pulse-web-auth-eyebrow">${copy.eyebrow}</span>
          <h1 class="pulse-web-auth-title">${copy.title}</h1>
        </div>
      </div>
      <div class="pulse-web-auth-body">
        <p class="pulse-web-auth-subtitle">${copy.subtitle}</p>
        <label class="pulse-web-auth-row">
          <span>${copy.provider}</span>
          <select id="pulse-web-model-provider" class="pulse-web-model-select">
            <option value="openai">OpenAI Compatible</option>
            <option value="anthropic">Anthropic (Claude)</option>
          </select>
        </label>
        <label class="pulse-web-auth-row">
          <span>${copy.apiKey}</span>
          <input id="pulse-web-model-key" type="password" autocomplete="off" placeholder="${copy.apiKeyPlaceholder}" />
        </label>
        <label class="pulse-web-auth-row">
          <span>${copy.baseUrl}</span>
          <input id="pulse-web-model-base" type="url" autocomplete="off" placeholder="${copy.baseUrlPlaceholder}" />
        </label>
        <label class="pulse-web-auth-row">
          <span>${copy.model}</span>
          <div class="pulse-web-model-input-row">
            <input id="pulse-web-model-id" type="text" autocomplete="off" placeholder="${copy.modelPlaceholder}" />
            <button id="pulse-web-model-fetch" type="button" class="pulse-web-model-fetch">${copy.fetchModels}</button>
          </div>
          <select id="pulse-web-model-picker" class="pulse-web-model-select" hidden></select>
        </label>
        ${
          isAdmin
            ? `<label class="pulse-web-model-check"><input id="pulse-web-model-sync" type="checkbox" checked /><span>${copy.syncVps}</span></label>`
            : ''
        }
        <p id="pulse-web-model-error" class="pulse-web-auth-error" hidden></p>
        <div class="pulse-web-model-actions">
          <button id="pulse-web-model-cancel" type="button" class="pulse-web-model-cancel">${copy.cancel}</button>
          <button id="pulse-web-model-submit" type="submit" class="pulse-web-auth-submit">${copy.save}</button>
        </div>
      </div>
    </form>
  `;

  document.body.appendChild(backdrop);

  const form = backdrop.querySelector<HTMLFormElement>('#pulse-web-model-form')!;
  const providerEl = backdrop.querySelector<HTMLSelectElement>('#pulse-web-model-provider')!;
  const keyEl = backdrop.querySelector<HTMLInputElement>('#pulse-web-model-key')!;
  const baseEl = backdrop.querySelector<HTMLInputElement>('#pulse-web-model-base')!;
  const modelEl = backdrop.querySelector<HTMLInputElement>('#pulse-web-model-id')!;
  const fetchBtn = backdrop.querySelector<HTMLButtonElement>('#pulse-web-model-fetch')!;
  const pickerEl = backdrop.querySelector<HTMLSelectElement>('#pulse-web-model-picker')!;
  const syncEl = backdrop.querySelector<HTMLInputElement>('#pulse-web-model-sync');
  const errorEl = backdrop.querySelector<HTMLParagraphElement>('#pulse-web-model-error')!;
  const cancelBtn = backdrop.querySelector<HTMLButtonElement>('#pulse-web-model-cancel')!;
  const submitBtn = backdrop.querySelector<HTMLButtonElement>('#pulse-web-model-submit')!;

  providerEl.value = stored?.provider ?? 'openai';
  keyEl.value = stored?.apiKey ?? '';
  baseEl.value = stored?.baseUrl ?? '';
  modelEl.value = stored?.model ?? '';

  pickerEl.addEventListener('change', () => {
    if (pickerEl.value) modelEl.value = pickerEl.value;
  });

  fetchBtn.addEventListener('click', async () => {
    errorEl.hidden = true;
    fetchBtn.disabled = true;
    fetchBtn.textContent = copy.fetchingModels;
    try {
      const res = await fetch(`${session.endpoint}/v1/agent/models`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: providerEl.value === 'anthropic' ? 'anthropic' : 'openai',
          apiKey: keyEl.value.trim(),
          baseUrl: baseEl.value.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        models?: string[];
        error?: string;
      };
      if (!res.ok || !body.ok || !Array.isArray(body.models)) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      pickerEl.innerHTML = '';
      const placeholderOpt = document.createElement('option');
      placeholderOpt.value = '';
      placeholderOpt.textContent = `${copy.pickModel} (${body.models.length})`;
      pickerEl.appendChild(placeholderOpt);
      for (const m of body.models) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        pickerEl.appendChild(opt);
      }
      pickerEl.hidden = false;
      if (modelEl.value && body.models.includes(modelEl.value)) {
        pickerEl.value = modelEl.value;
      } else if (!modelEl.value && body.models.length > 0) {
        modelEl.value = body.models[0];
        pickerEl.value = body.models[0];
      }
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
      errorEl.hidden = false;
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = copy.fetchModels;
    }
  });

  // Pre-fill non-secret VPS status if local values are empty.
  void fetch(`${session.endpoint}/v1/agent/status`, {
    headers: { Authorization: `Bearer ${session.token}` },
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((status: { provider?: string; baseUrl?: string; model?: string } | null) => {
      if (!status) return;
      if (!stored?.provider && (status.provider === 'openai' || status.provider === 'anthropic')) {
        providerEl.value = status.provider;
      }
      if (!baseEl.value && status.baseUrl) baseEl.value = status.baseUrl;
      if (!modelEl.value && status.model) modelEl.value = status.model;
    })
    .catch(() => undefined);

  const close = () => backdrop.remove();
  cancelBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = copy.saving;

    const config: WebLlmConfig = {
      provider: providerEl.value === 'anthropic' ? 'anthropic' : 'openai',
      apiKey: keyEl.value.trim(),
      baseUrl: baseEl.value.trim(),
      model: modelEl.value.trim(),
    };
    saveStoredWebLlmConfig(config);

    if (isAdmin && syncEl?.checked) {
      try {
        const res = await fetch(`${session.endpoint}/v1/agent/config`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(config),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        errorEl.textContent = `${copy.savedLocal} (${err instanceof Error ? err.message : String(err)})`;
        errorEl.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = copy.save;
        return;
      }
    }

    close();
  });
}

export function mountWebModelSettingsTrigger(session: WebHostAuthSession): void {
  if (typeof document === 'undefined' || session.role === 'viewer') return;
  if (document.getElementById('pulse-web-model-trigger')) return;
  const isZh = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
  const btn = document.createElement('button');
  btn.id = 'pulse-web-model-trigger';
  btn.type = 'button';
  btn.className = 'pulse-web-model-trigger';
  btn.textContent = isZh ? '模型设置' : 'Model';
  btn.addEventListener('click', () => openWebModelSettingsModal(session));
  document.body.appendChild(btn);
}
