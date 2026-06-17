import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { CanvasModelStatus } from '../../types';
import { CheckIcon } from '../icons';
import type { ModelSelection } from './modelSettingsTypes';
import { providerLabel } from './modelSettingsTypes';
import { useI18n } from '../../i18n';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useMenuKeyboardNav } from '../../hooks/useMenuKeyboardNav';

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
  const { t } = useI18n();
  const menuId = useId();
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

  const closeMenuAndRestoreFocus = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useMenuKeyboardNav(menuRef, closeMenuAndRestoreFocus, open);
  // Trigger + menu both count as "inside" so clicking the trigger toggles
  // rather than double-firing a close.
  useClickOutside([triggerRef, menuRef], () => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    const reposition = () => updateMenuPosition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, updateMenuPosition]);

  const providers = useMemo(() => status?.providers ?? [], [status?.providers]);
  const hasConfiguredModels = providers.some((provider) => provider.models.length > 0);
  const notConfigured = status !== undefined && !status.apiKeyPresent;

  const openMenuFromKeyboard = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (notConfigured) return;
    event.preventDefault();
    event.stopPropagation();
    if (!open) {
      setOpen(true);
      return;
    }
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    );
    const target = event.key === 'ArrowUp' ? items[items.length - 1] : items[0];
    target?.focus();
  }, [notConfigured, open]);

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
        onKeyDown={openMenuFromKeyboard}
        title={notConfigured ? t('chat.model.notConfiguredTitle') : t('chat.model.chooseTitle')}
        aria-label={notConfigured ? t('chat.model.configureProviderAria') : t('chat.model.chooseModelAria')}
        aria-haspopup={!notConfigured ? 'menu' : undefined}
        aria-expanded={!notConfigured ? open : undefined}
        aria-controls={!notConfigured && open ? menuId : undefined}
      >
        <span className="chat-model-switcher-dot" />
        <span className="chat-model-switcher-label">{notConfigured ? t('chat.model.configure') : label}</span>
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
          id={menuId}
          className="chat-model-menu"
          role="menu"
          aria-label={t('chat.model.useModel')}
          style={{
            top: menuPosition?.top ?? -9999,
            left: menuPosition?.left ?? -9999,
            visibility: menuPosition ? 'visible' : 'hidden',
          }}
        >
          <div className="chat-model-menu-label">{t('chat.model.useModel')}</div>
          <button
            type="button"
            className={`chat-model-menu-item${selection.mode === 'auto' ? ' chat-model-menu-item--active' : ''}`}
            role="menuitemradio"
            aria-checked={selection.mode === 'auto'}
            data-menu-autofocus={selection.mode === 'auto' ? 'true' : undefined}
            onClick={() => {
              setOpen(false);
              void onSelectAuto();
            }}
          >
            <span className="chat-model-menu-check">{selection.mode === 'auto' ? <CheckIcon /> : null}</span>
            <span className="chat-model-menu-main">
              <span className="chat-model-menu-title">{t('chat.model.auto')}</span>
              <span className="chat-model-menu-subtitle">{t('chat.model.autoSubtitle')}</span>
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
                    role="menuitemradio"
                    aria-checked={active}
                    data-menu-autofocus={active ? 'true' : undefined}
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
                <div className="chat-model-menu-empty">{t('chat.model.noModels')}</div>
              )}
            </div>
          ))}
          {!hasConfiguredModels && (
            <div className="chat-model-menu-hint">
              {t('chat.model.emptyHint')}
            </div>
          )}
          <div className="chat-model-menu-divider" />
          <button
            type="button"
            className="chat-model-menu-action"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            {t('chat.model.manageProviders')}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
};
