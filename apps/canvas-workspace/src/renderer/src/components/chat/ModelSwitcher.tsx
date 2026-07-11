import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CanvasModelStatus } from '../../types';
import { CheckIcon } from '../icons';
import type { ModelSelection } from './modelSettingsTypes';
import { providerLabel } from './modelSettingsTypes';
import { useI18n } from '../../i18n';
import { Popover } from '../ui/Popover';

interface ModelSwitcherProps {
  status?: CanvasModelStatus;
  selection: ModelSelection;
  label: string;
  onSelectAuto: () => Promise<void>;
  onSelectModel: (providerId: string, modelId: string) => Promise<void>;
  onOpenSettings: () => void;
}

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

  // 'escape' restores focus to the trigger (a deliberate dismiss); 'outside'
  // (and the plain setOpen(false) each menu item's own onClick already
  // does) leaves focus alone — the user's attention already moved
  // elsewhere. Matches the pre-migration closeMenuAndRestoreFocus /
  // bare-setOpen(false) split exactly (see ui/Popover's own onClose reason
  // doc).
  const handlePopoverClose = useCallback((reason?: 'escape' | 'outside') => {
    setOpen(false);
    if (reason === 'escape') triggerRef.current?.focus();
  }, []);

  const providers = useMemo(() => status?.providers ?? [], [status?.providers]);
  const hasConfiguredModels = providers.some((provider) => provider.models.length > 0);
  const notConfigured = status !== undefined && !status.apiKeyPresent;

  const openMenuFromKeyboard = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    // Once the menu is mounted, ui/Popover's own arrow-nav (global-scope,
    // capture-phase) intercepts and stops Arrow{Up,Down} before this
    // bubble-phase trigger handler would ever see them — same dead-code
    // drop the API-extension batch made for chat/ChatAnchors migrating onto
    // DropdownShell. This handler now only needs to OPEN a closed menu.
    if (notConfigured || open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
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
      {open && (
        <Popover
          anchorRef={triggerRef}
          onClose={handlePopoverClose}
          placement="top"
          align="end"
          gap={MODEL_MENU_GAP}
          viewportMargin={MODEL_MENU_VIEWPORT_MARGIN}
          panelId={menuId}
          ariaLabel={t('chat.model.useModel')}
          className="chat-model-menu"
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
        </Popover>
      )}
    </div>
  );
};
