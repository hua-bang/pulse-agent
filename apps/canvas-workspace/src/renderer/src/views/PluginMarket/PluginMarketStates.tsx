import { MagnifyingGlass, PuzzlePiece, WarningCircle } from '@phosphor-icons/react';
import { Button, EmptyState } from '../../components/ui';
import { SpinnerIcon } from '../../components/icons';
import { useI18n } from '../../i18n';
import { pluginMarketKeys as keys } from './i18nKeys';

export const PluginMarketLoading = () => {
  const { t } = useI18n();
  return (
    <div className="plugin-market__loading" role="status" aria-label={t(keys.loading)}>
      <div className="plugin-market__loading-copy">
        <SpinnerIcon size={18} className="plugin-market__spin" />
        <span>
          <strong>{t(keys.loading)}</strong>
          <small>{t(keys.loadingDescription)}</small>
        </span>
      </div>
      <div className="plugin-market__loading-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <span key={index} className="plugin-market__loading-row" />
        ))}
      </div>
    </div>
  );
};

interface ErrorProps {
  error: string;
  onRetry: () => void;
}

export const PluginMarketError = ({ error, onRetry }: ErrorProps) => {
  const { t } = useI18n();
  return (
    <EmptyState
      className="plugin-market__state"
      icon={<WarningCircle size={25} />}
      titleAs="h2"
      title={t(keys.loadFailed)}
      description={error}
      action={<Button variant="primary" onClick={onRetry}>{t(keys.retry)}</Button>}
    />
  );
};

interface EmptyProps {
  filtered: boolean;
  onClear: () => void;
}

export const PluginMarketEmpty = ({ filtered, onClear }: EmptyProps) => {
  const { t } = useI18n();
  return (
    <EmptyState
      className="plugin-market__state"
      icon={filtered ? <MagnifyingGlass size={25} /> : <PuzzlePiece size={25} />}
      titleAs="h2"
      title={t(filtered ? keys.noResultsTitle : keys.emptyTitle)}
      description={t(filtered ? keys.noResultsDescription : keys.emptyDescription)}
      action={filtered
        ? <Button onClick={onClear}>{t(keys.clearSearch)}</Button>
        : undefined}
    />
  );
};
