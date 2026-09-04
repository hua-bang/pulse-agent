/**
 * Failure surface for a web tab. Without it a blocked/offline/crashed page is
 * an unexplained white pane with no way out — the canvas iframe node has had
 * a friendly error state for a long time; this is the dock's equivalent, with
 * the two recoveries that actually apply here (retry, hand to the system
 * browser).
 */
import { useI18n, type I18nKey } from '../../../../i18n';
import { Button } from '../../../../components/ui';
import type { LoadErrorKind } from '../../../../platform/browser/load-error';

const MESSAGE_KEY: Record<LoadErrorKind, I18nKey> = {
  blocked: 'linkDrawer.error.blocked',
  network: 'linkDrawer.error.network',
  crashed: 'linkDrawer.error.crashed',
  unknown: 'linkDrawer.error.unknown',
};

interface Props {
  kind: LoadErrorKind;
  /** Raw Chromium code/description, shown small for bug reports. */
  detail: string;
  url: string;
  onRetry: () => void;
  onOpenExternal: () => void;
}

export const LinkTabLoadError = ({ kind, detail, url, onRetry, onOpenExternal }: Props) => {
  const { t } = useI18n();
  return (
    <div className="link-drawer__error" role="alert">
      <strong className="link-drawer__error-title">{t('linkDrawer.error.title')}</strong>
      <p className="link-drawer__error-message">{t(MESSAGE_KEY[kind])}</p>
      {url && <code className="link-drawer__error-url">{url}</code>}
      <div className="link-drawer__error-actions">
        <Button variant="secondary" size="xs" onClick={onRetry}>
          {t('linkDrawer.error.retry')}
        </Button>
        <Button variant="secondary" size="xs" onClick={onOpenExternal} disabled={!url}>
          {t('linkDrawer.openInBrowser')}
        </Button>
      </div>
      {detail && <small className="link-drawer__error-detail">{detail}</small>}
    </div>
  );
};
