import './index.css';
import type { RefObject, ReactNode } from 'react';
import { useI18n } from '../../../../i18n';
import { CloseIcon } from '../../../../components/icons';
import { Button, Popover } from '../../../../components/ui';

interface Props {
  anchorRef: RefObject<HTMLElement>;
  children?: ReactNode;
  onClose: () => void;
  panelId: string;
  title: string;
}

export const NodeDetailInspector = ({
  anchorRef,
  children,
  onClose,
  panelId,
  title,
}: Props) => {
  const { t } = useI18n();
  const closeAndRestoreFocus = () => {
    onClose();
    window.requestAnimationFrame(() => anchorRef.current?.focus());
  };

  return (
    <Popover
      anchorRef={anchorRef}
      align="end"
      onClose={(reason) => {
        if (reason === 'escape') closeAndRestoreFocus();
        else onClose();
      }}
      role="region"
      autoFocus={false}
      keyboardNavigation={false}
      ariaLabel={title}
      panelId={panelId}
      className="node-detail-panel__inspector"
    >
      <div className="node-detail-panel__inspector-header">
        <strong>{title}</strong>
        <Button variant="icon" size="xs" aria-label={t('shell.close')} onClick={closeAndRestoreFocus}>
          <CloseIcon size={13} />
        </Button>
      </div>
      {children}
    </Popover>
  );
};
