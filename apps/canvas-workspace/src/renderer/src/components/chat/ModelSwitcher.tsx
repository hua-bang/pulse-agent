import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CanvasModelStatus } from '../../types';
import { CheckIcon } from '../icons';
import type { ModelSelection } from './modelSettingsTypes';
import { providerLabel } from './modelSettingsTypes';

interface ModelSwitcherProps {
  status?: CanvasModelStatus;
  selection: ModelSelection;
  label: string;
  onSelectAuto: () => Promise<void>;
  onSelectModel: (providerId: string, modelId: string) => Promise<void>;
  onOpenSettings: () => void;
}

const MODEL_MENU_WIDTH = 292;
const MODEL_MENU_GAP = 8;
const MODEL_MENU_VIEWPORT_MARGIN = 12;

export const ModelSwitcher = ({
  status,
  selection,
  label,
  onSelectAuto,
  onSelectModel,
  onOpenSettings,
}: ModelSwitcherProps) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const menuEl = menuRef.current;
    const menuHeight = menuEl?.offsetHeight ?? 360;
    const menuWidth = menuEl?.offsetWidth ?? MODEL_MENU_WIDTH;

    let top = rect.top - menuHeight - MODEL_MENU_GAP;
    if (top < MODEL_MENU_VIEWPORT_MARGIN) {
      const below = rect.bottom + MODEL_MENU_GAP;
      top = Math.min(below, viewportHeight - menuHeight - MODEL_MENU_VIEWPORT_MARGIN);
      top = Math.max(top, MODEL_MENU_VIEWPORT_MARGIN);
    }

    let left = rect.right - menuWidth;
    left = Math.min(left, viewportWidth - menuWidth - MODEL_MENU_VIEWPORT_MARGIN);
    left = Math.max(left, MODEL_MENU_VIEWPORT_MARGIN);

    setMenuPosition({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onResize = () => updateMenuPosition();
    const onScroll = () => updateMenuPosition();
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, updateMenuPosition]);

  const providers = useMemo(() => status?.providers ?? [], [status?.providers]);
  const hasConfiguredModels = providers.some((provider) => provider.models.length > 0);
  const notConfigured = status !== undefined && !status.apiKeyPresent;

  return (
    <div className="chat-model-switcher">
      <button
        ref={triggerRef}
        type="button"
        className={`chat-model-switcher-btn${notConfigured ? ' chat-model-switcher-btn--warning' : ''}`}
        onClick={() => {
          if (notConfigured) {
            onOpenSettings();
            return;
          }
          setOpen((value) => !value);
        }}
        title={notConfigured ? '还没配模型，点击去 Settings 配置' : '选择本次使用的模型'}
        aria-label={notConfigured ? '配置模型 provider' : '选择模型'}
      >
        <span className="chat-model-switcher-dot" />
        <span className="chat-model-switcher-label">{notConfigured ? 'Configure model' : label}</span>
        {!notConfigured && (
          <span className="chat-model-switcher-chevron" aria-hidden="true">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2.75 4L5 6.25L7.25 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="chat-model-menu"
          style={{
            top: menuPosition?.top ?? -9999,
            left: menuPosition?.left ?? -9999,
            visibility: menuPosition ? 'visible' : 'hidden',
          }}
        >
          <div className="chat-model-menu-label">Use model</div>
          <button
            type="button"
            className={`chat-model-menu-item${selection.mode === 'auto' ? ' chat-model-menu-item--active' : ''}`}
            onClick={() => {
              setOpen(false);
              void onSelectAuto();
            }}
          >
            <span className="chat-model-menu-check">{selection.mode === 'auto' ? <CheckIcon /> : null}</span>
            <span className="chat-model-menu-main">
              <span className="chat-model-menu-title">Auto</span>
              <span className="chat-model-menu-subtitle">自动使用当前默认配置</span>
            </span>
          </button>
          {providers.length > 0 && <div className="chat-model-menu-divider" />}
          {providers.map((provider) => (
            <div key={provider.id} className="chat-model-menu-provider">
              <div className="chat-model-menu-provider-head">
                <span>{provider.name}</span>
                <span>{providerLabel(provider.provider_type)}</span>
              </div>
              {provider.models.length > 0 ? provider.models.map((model) => {
                const active = selection.mode === 'model' && selection.providerId === provider.id && selection.modelId === model.id;
                return (
                  <button
                    key={`${provider.id}:${model.id}`}
                    type="button"
                    className={`chat-model-menu-item chat-model-menu-item--model${active ? ' chat-model-menu-item--active' : ''}`}
                    onClick={() => {
                      setOpen(false);
                      void onSelectModel(provider.id, model.id);
                    }}
                  >
                    <span className="chat-model-menu-check">{active ? <CheckIcon /> : null}</span>
                    <span className="chat-model-menu-main">
                      <span className="chat-model-menu-title">{model.name ?? model.id}</span>
                      <span className="chat-model-menu-subtitle">{model.id}</span>
                    </span>
                  </button>
                );
              }) : (
                <div className="chat-model-menu-empty">No models yet</div>
              )}
            </div>
          ))}
          {!hasConfiguredModels && (
            <div className="chat-model-menu-hint">
              配置 API Key / Base URL 后可拉取模型，也可以手动添加。
            </div>
          )}
          <div className="chat-model-menu-divider" />
          <button
            type="button"
            className="chat-model-menu-action"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            Manage providers...
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
};
