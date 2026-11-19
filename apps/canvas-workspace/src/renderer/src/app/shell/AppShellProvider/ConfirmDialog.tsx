import { useEffect, useRef } from 'react';
import type { ConfirmOptions } from '../../../types/ui-interaction';
import { useI18n } from '../../../i18n';
import { Modal } from '../../../components/ui';
import './shell-dialog.css';

export const ConfirmDialog = ({
  options,
  onCancel,
  onConfirm,
}: {
  options: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const { t } = useI18n();
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
