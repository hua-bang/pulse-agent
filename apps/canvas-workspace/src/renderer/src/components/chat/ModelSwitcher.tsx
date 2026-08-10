import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CanvasModelStatus } from '../../types';
import { CheckIcon } from '../icons';
import type { ModelSelection } from './modelSettingsTypes';
import { providerLabel } from './modelSettingsTypes';
import { matchesModelQuery } from './modelCatalogUtils';
import { useI18n } from '../../i18n';
import { isImeComposing } from '../../utils/ime';
import { Popover } from '../ui/Popover';
import { SegmentedControl } from '../ui/SegmentedControl';
import { TextField } from '../ui/TextField';

interface Props {
  status?: CanvasModelStatus;
  selection: ModelSelection;
  label: string;
  disabled?: boolean;
  onSelectModel: (providerId: string, modelId: string) => Promise<void>;
  onOpenSettings: () => void;
}

const MODEL_MENU_GAP = 8;
const MODEL_MENU_VIEWPORT_MARGIN = 12;
const ALL_PROVIDERS = '';

export const ModelSwitcher = ({
  status,
  selection,
  label,
  disabled = false,
  onSelectModel,
  onOpenSettings,
}: Props) => {
  const { t } = useI18n();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState(ALL_PROVIDERS);
  const [selectionError, setSelectionError] = useState<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

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

  // The trigger carries provider + model, not the bare model name: several
  // providers can serve identically-named models, so the model alone doesn't
  // say which endpoint the next message goes to.
  const activeProviderName = useMemo(() => {
    if (selection.mode !== 'model' || !selection.providerId) return undefined;
    return providers.find((provider) => provider.id === selection.providerId)?.name;
  }, [providers, selection]);

  // The provider list is long enough (a fetched OpenAI-compatible catalog runs
  // to dozens of entries) that scrolling to a model is the slow path — filter
  // over provider name, model name, and model id.
  const normalizedQuery = query.trim().toLowerCase();
  const filteredProviders = useMemo(() => {
    const scopedProviders = providerFilter === ALL_PROVIDERS
      ? providers
      : providers.filter((provider) => provider.id === providerFilter);
    if (!normalizedQuery) return scopedProviders.map((provider) => ({ provider, models: provider.models }));
    return scopedProviders
      .map((provider) => {
        // A provider-name hit keeps that provider's whole catalog, so typing
        // "openai" is a way to narrow to one provider rather than one model.
        const providerHit = provider.name.toLowerCase().includes(normalizedQuery);
        const models = providerHit
          ? provider.models
          : provider.models.filter((model) => matchesModelQuery(model, normalizedQuery));
        return { provider, models };
      })
      .filter((entry) => entry.models.length > 0);
  }, [normalizedQuery, providerFilter, providers]);
  const visibleModelCount = useMemo(
    () => filteredProviders.reduce((total, entry) => total + entry.models.length, 0),
    [filteredProviders],
  );

  const openMenuFromKeyboard = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    // Once the menu is mounted, ui/Popover's own arrow-nav (global-scope,
    // capture-phase) intercepts and stops Arrow{Up,Down} before this
    // bubble-phase trigger handler would ever see them — same dead-code
    // drop the API-extension batch made for chat/ChatAnchors migrating onto
    // DropdownShell. This handler now only needs to OPEN a closed menu.
    if (disabled || notConfigured || open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
  }, [disabled, notConfigured, open]);

  const runSelection = useCallback(async (select: () => Promise<void>) => {
    setSelectionError(undefined);
    try {
      await select();
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const pickModel = useCallback((providerId: string, modelId: string) => {
    setOpen(false);
    void runSelection(() => onSelectModel(providerId, modelId));
  }, [onSelectModel, runSelection]);

  // Focus lands in the filter box, not on a menu item — typing is the fast
  // path through a long list, and Popover's own arrow-nav still walks the
  // items from there. The rect-anchored panel mounts hidden until its first
  // measurement (Chromium drops focus calls inside that commit), so both the
  // focus and the scroll-into-view wait a frame.
  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => {
      searchBoxRef.current?.querySelector('input')?.focus();
      activeItemRef.current?.scrollIntoView?.({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setProviderFilter(ALL_PROVIDERS);
    }
  }, [open]);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // The Enter that confirms a CJK candidate is aimed at the IME, not at us.
    if (event.key !== 'Enter' || isImeComposing(event)) return;
    const first = filteredProviders[0];
    const model = first?.models[0];
    if (!first || !model) return;
    event.preventDefault();
    pickModel(first.provider.id, model.id);
  };

  return (
    <div className="chat-model-switcher">
      {selectionError && (
        <div className="chat-model-switcher-error" role="alert">{selectionError}</div>
      )}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
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
        <span className="chat-model-switcher-label">
          {notConfigured ? t('chat.model.configure') : (
            <>
              {activeProviderName && (
                <span className="chat-model-switcher-provider">{activeProviderName}</span>
              )}
              <span className="chat-model-switcher-model">{label}</span>
            </>
          )}
        </span>
        {!notConfigured && (
          <span className="chat-model-switcher-chevron" aria-hidden="true">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2.75 4L5 6.25L7.25 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
      </button>
      {open && !disabled && (
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
          // Focus belongs in the filter input below, so Popover must not
          // claim it for the first menu button on mount.
          autoFocus={false}
        >
          <div className="chat-model-menu-controls">
            <div className="chat-model-menu-search" ref={searchBoxRef}>
              <TextField
                className="chat-model-menu-search-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder={t('chat.model.searchPlaceholder')}
                aria-label={t('chat.model.searchPlaceholder')}
              />
            </div>
            <div className="chat-model-menu-toolbar">
              {providers.length > 1 && (
                <SegmentedControl
                  className="chat-model-menu-provider-filter"
                  value={providerFilter}
                  onChange={setProviderFilter}
                  ariaLabel={t('chat.model.filterProviderAria')}
                  options={[
                    { id: ALL_PROVIDERS, label: t('chat.model.allProviders') },
                    ...providers.map((provider) => ({ id: provider.id, label: provider.name })),
                  ]}
                />
              )}
              <span className="chat-model-menu-result-count">
                {visibleModelCount === 1
                  ? t('chat.model.resultCountOne')
                  : t('chat.model.resultCount', { count: visibleModelCount })}
              </span>
            </div>
          </div>
          {filteredProviders.map(({ provider, models }) => (
            <div key={provider.id} className="chat-model-menu-provider">
              <div className="chat-model-menu-provider-head">
                <span>{provider.name}</span>
                <span>{providerLabel(provider.provider_type)}</span>
              </div>
              {models.length > 0 ? models.map((model) => {
                const active = selection.mode === 'model' && selection.providerId === provider.id && selection.modelId === model.id;
                return (
                  <button
                    key={`${provider.id}:${model.id}`}
                    ref={active ? activeItemRef : undefined}
                    type="button"
                    className={`chat-model-menu-item chat-model-menu-item--model${active ? ' chat-model-menu-item--active' : ''}`}
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => pickModel(provider.id, model.id)}
                  >
                    <span className="chat-model-menu-check">{active ? <CheckIcon /> : null}</span>
                    <span className="chat-model-menu-main">
                      <span className="chat-model-menu-title">{model.name ?? model.id}</span>
                      {model.name && model.name !== model.id && (
                        <span className="chat-model-menu-subtitle">{model.id}</span>
                      )}
                    </span>
                  </button>
                );
              }) : (
                <div className="chat-model-menu-empty">{t('chat.model.noModels')}</div>
              )}
            </div>
          ))}
          {normalizedQuery && filteredProviders.length === 0 && (
            <div className="chat-model-menu-empty">{t('chat.model.noMatches')}</div>
          )}
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
