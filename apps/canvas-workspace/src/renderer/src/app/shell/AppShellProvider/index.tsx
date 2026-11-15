import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_TOAST_DURATION_MS } from '../../../constants/interaction';
import type { ConfirmOptions, ToastInput, ToastRecord } from '../../../types/ui-interaction';
import { useI18n } from '../../../i18n';
import { Modal } from '../../../components/ui';
import { AppShellPortProvider, useAppShell, type AppShellPort } from '../../../shared/appShell';
import { OPEN_APP_COMMAND_PALETTE_EVENT } from '../../../shared/appCommands';
import { ToastTimers, visibleToasts } from './toastTimers';
import './index.css';

const ShortcutsDialog = lazy(() =>
  import('./ShortcutsDialog').then((module) => ({ default: module.ShortcutsDialog })),
);
// Off the canvas route, Cmd/Ctrl+K opens the same palette with only the app
// navigation commands (workspaces and pages).
const CommandPalette = lazy(() =>
  import('../../../modules/canvas/components/canvas/CommandPalette')
    .then((module) => ({ default: module.CommandPalette })),
);
const NO_NODES: never[] = [];
const NO_COMMANDS: never[] = [];
const ignoreNode = () => undefined;

export const AppShellProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const toastCounterRef = useRef(0);
  // Records by id, so a close can run the toast's `onClose` exactly once.
  const toastRecordsRef = useRef<Map<string, ToastRecord>>(new Map());
  const toastTimersRef = useRef<ToastTimers | null>(null);

  /** Removes a toast. `onClose` runs unless the user picked an action. */
  const closeToast = useCallback((id: string, viaAction: boolean) => {
    toastTimersRef.current?.remove(id);
    const record = toastRecordsRef.current.get(id);
    toastRecordsRef.current.delete(id);
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    if (record && !viaAction) record.onClose?.();
  }, []);

  if (!toastTimersRef.current) {
    toastTimersRef.current = new ToastTimers((id) => closeToast(id, false));
  }
  const toastTimers = toastTimersRef.current;

  const dismissToast = useCallback((id: string) => {
    closeToast(id, false);
  }, [closeToast]);

  const runToastAction = useCallback((id: string, onClick: () => void) => {
    // Close before firing so action handlers that themselves open a new
    // toast don't race against this one.
    closeToast(id, true);
    onClick();
  }, [closeToast]);

  // A timer runs only while its toast is visible (see toastTimers.ts).
  useEffect(() => {
    toastTimers.sync(visibleToasts(toasts));
  }, [toastTimers, toasts]);

  const notify = useCallback((toast: ToastInput) => {
    const id = `toast-${Date.now()}-${toastCounterRef.current++}`;
    const autoCloseMs = toast.autoCloseMs ?? (toast.tone === 'loading' ? 0 : DEFAULT_TOAST_DURATION_MS);
    const record: ToastRecord = {
      id,
      createdAt: Date.now(),
      ...toast,
      autoCloseMs,
    };
    toastRecordsRef.current.set(id, record);
    setToasts((prev) => [...prev, record]);
    return id;
  }, []);

  const updateToast = useCallback((id: string, patch: Partial<Omit<ToastRecord, 'id' | 'createdAt'>>) => {
    const current = toastRecordsRef.current.get(id);
    if (current) toastRecordsRef.current.set(id, { ...current, ...patch });
    setToasts((prev) => prev.map((toast) => (
      toast.id === id
        ? { ...toast, ...patch }
        : toast
    )));
    // A new duration starts again; the sync effect restarts the timer.
    if (Object.prototype.hasOwnProperty.call(patch, 'autoCloseMs')) {
      toastTimers.reset(id);
    }
  }, [toastTimers]);

  // Pause auto-dismiss while the pointer is over a toast so users can
  // read it or reach its action button; the remaining time continues on
  // mouse-leave.
  const pauseToast = useCallback((id: string) => {
    toastTimers.pause(id);
  }, [toastTimers]);

  const resumeToast = useCallback((toast: ToastRecord) => {
    toastTimers.resume(toast.id);
  }, [toastTimers]);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false);
    }
    confirmResolverRef.current = resolve;
    setConfirmState(options);
  }), []);

  const closeConfirm = useCallback((accepted: boolean) => {
    setConfirmState(null);
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    resolve?.(accepted);
  }, []);

  const openShortcuts = useCallback(() => {
    setShortcutsOpen(true);
  }, []);

  const closeShortcuts = useCallback(() => {
    setShortcutsOpen(false);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
  }, []);

  useEffect(() => {
    const open = () => setCommandPaletteOpen(true);
    window.addEventListener(OPEN_APP_COMMAND_PALETTE_EVENT, open);
    return () => window.removeEventListener(OPEN_APP_COMMAND_PALETTE_EVENT, open);
  }, []);

  useEffect(() => () => {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false);
      confirmResolverRef.current = null;
    }
    toastTimers.clear();
  }, [toastTimers]);

  const isOverlayOpen = shortcutsOpen || commandPaletteOpen || Boolean(confirmState);

  const value = useMemo<AppShellPort>(() => ({
    notify,
    updateToast,
    dismissToast,
    confirm,
    openShortcuts,
    closeShortcuts,
    shortcutsOpen,
    isOverlayOpen,
  }), [notify, updateToast, dismissToast, confirm, openShortcuts, closeShortcuts, shortcutsOpen, isOverlayOpen]);

  return (
    <AppShellPortProvider value={value}>
      {children}
      <ToastViewport
        toasts={toasts}
        onDismiss={dismissToast}
        onAction={runToastAction}
        onPause={pauseToast}
        onResume={resumeToast}
      />
      {confirmState && (
        <ConfirmDialog
          options={confirmState}
          onCancel={() => closeConfirm(false)}
          onConfirm={() => closeConfirm(true)}
          t={t}
        />
      )}
      {shortcutsOpen && (
        <Suspense fallback={null}>
          <ShortcutsDialog onClose={closeShortcuts} />
        </Suspense>
      )}
      {commandPaletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            nodes={NO_NODES}
            commands={NO_COMMANDS}
            appCommands="list"
            onSelectNode={ignoreNode}
            onClose={closeCommandPalette}
          />
        </Suspense>
      )}
    </AppShellPortProvider>
  );
};

export { useAppShell };

const ToastViewport = ({
  toasts,
  onDismiss,
  onAction,
  onPause,
  onResume,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
  onAction: (id: string, onClick: () => void) => void;
  onPause: (id: string) => void;
  onResume: (toast: ToastRecord) => void;
}) => {
  const { t } = useI18n();

  // Cap the visible stack: rapid-fire actions (e.g. bulk node operations)
  // could otherwise overflow the viewport. Older toasts stay queued and
  // surface as newer ones dismiss.
  const visible = visibleToasts(toasts);

  // Each toast is its own live region: errors interrupt (role="alert"),
  // everything else waits for the reader (role="status").
  return (
    <div className="shell-toast-region">
      {visible.map((toast) => (
        <article
          key={toast.id}
          className={`shell-toast shell-toast--${toast.tone}`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
          onMouseEnter={() => onPause(toast.id)}
          onMouseLeave={() => onResume(toast)}
        >
          <span className="shell-toast__icon" aria-hidden="true">
            <ToastIcon tone={toast.tone} />
          </span>
          <div className="shell-toast__body">
            <div className="shell-toast__title">{toast.title}</div>
            {toast.description && (
              <div className="shell-toast__description">{toast.description}</div>
            )}
          </div>
          {[toast.action, toast.secondaryAction].map((action, index) => action && (
            <button
              key={index}
              type="button"
              className="shell-toast__action"
              onClick={() => onAction(toast.id, action.onClick)}
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            className="shell-toast__close"
            aria-label={t('shell.dismissNotification')}
            onClick={() => onDismiss(toast.id)}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </article>
      ))}
    </div>
  );
};

const ToastIcon = ({ tone }: { tone: ToastRecord['tone'] }) => {
  if (tone === 'loading') {
    return <span className="shell-spinner" />;
  }

  if (tone === 'error') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M7 4.2v3.5M7 9.6h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (tone === 'success') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4.2 7.2l1.8 1.8 3.8-4.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 6.1v3M7 4.1h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
};

const ConfirmDialog = ({
  options,
  onCancel,
  onConfirm,
  t,
}: {
  options: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
  t: ReturnType<typeof useI18n>['t'];
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const intent = options.intent ?? 'default';

  // Focus a button on open so Enter answers; Esc is handled by the Modal
  // shell (useEscapeClose). A destructive dialog focuses Cancel: it often
  // opens from Delete or Enter, and a repeated key must not confirm it.
  useEffect(() => {
    (intent === 'danger' ? cancelRef : confirmRef).current?.focus();
  }, [intent]);

  return (
    <Modal open onClose={onCancel} width={520} labelledBy="shell-confirm-title">
      <div className="shell-dialog__header">
        <div className={`shell-dialog__eyebrow${intent === 'danger' ? ' shell-dialog__eyebrow--danger' : ''}`}>
          {intent === 'danger' ? t('shell.confirmDestructive') : t('shell.confirmAction')}
        </div>
        <h2 className="shell-dialog__title" id="shell-confirm-title">{options.title}</h2>
      </div>
      {options.description && (
        <div className="shell-dialog__description">{options.description}</div>
      )}
      <div className="shell-dialog__footer">
        <button ref={cancelRef} type="button" className="shell-dialog__button" onClick={onCancel}>
          {options.cancelLabel ?? t('shell.cancel')}
        </button>
        <button
          ref={confirmRef}
          type="button"
          className={`shell-dialog__button${intent === 'danger' ? ' shell-dialog__button--danger' : ' shell-dialog__button--primary'}`}
          onClick={onConfirm}
        >
          {options.confirmLabel ?? t('shell.continue')}
        </button>
      </div>
    </Modal>
  );
};
