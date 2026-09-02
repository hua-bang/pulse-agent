import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useI18n } from '../../../../i18n';
import type {
  CanvasModelProviderConfig,
  CanvasModelProviderStatus,
  CanvasModelStatus,
  CanvasProviderModel,
} from '../../../../types';

interface Props {
  activeProviderStatus?: CanvasModelProviderStatus;
  draft: CanvasModelProviderConfig;
  mergeModelCatalog: (...groups: Array<ReadonlyArray<CanvasProviderModel> | undefined>) => void;
  onFetchModels: (provider: CanvasModelProviderConfig) => Promise<CanvasProviderModel[]>;
  onSaveProvider: (provider: CanvasModelProviderConfig) => Promise<CanvasModelStatus | undefined>;
  setActiveProviderId: Dispatch<SetStateAction<string>>;
  setDraft: Dispatch<SetStateAction<CanvasModelProviderConfig>>;
}

export const useProviderModelActions = ({
  activeProviderStatus,
  draft,
  mergeModelCatalog,
  onFetchModels,
  onSaveProvider,
  setActiveProviderId,
  setDraft,
}: Props) => {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [localError, setLocalError] = useState<string>();

  const fetchModels = useCallback(async () => {
    setFetching(true);
    setLocalError(undefined);
    try {
      const models = await onFetchModels(draft);
      mergeModelCatalog(draft.models, models);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setFetching(false);
    }
  }, [draft, mergeModelCatalog, onFetchModels]);

  const save = useCallback(async () => {
    if (!draft.name.trim()) return setLocalError(t('models.nameRequired'));
    if (!draft.id.trim()) return setLocalError(t('models.invalidId'));
    if (!draft.base_url?.trim()) return setLocalError(t('models.baseUrlRequired'));
    if (!draft.api_key?.trim() && !activeProviderStatus?.apiKeyPresent) {
      return setLocalError(t('models.apiKeyRequired'));
    }

    setSaving(true);
    setLocalError(undefined);
    try {
      let fetchedModels: CanvasProviderModel[];
      try {
        fetchedModels = await onFetchModels(draft);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLocalError(t('models.connectionTestFailed', { message }));
        return;
      }

      mergeModelCatalog(draft.models, fetchedModels);
      if ((draft.models ?? []).length === 0 && fetchedModels.length > 0) {
        setLocalError(t('models.selectAtLeastOne'));
        return;
      }
      const saved = await onSaveProvider(draft);
      if (saved) {
        setActiveProviderId(draft.id);
        setDraft((current) => ({ ...current, api_key: '' }));
      }
    } finally {
      setSaving(false);
    }
  }, [activeProviderStatus, draft, mergeModelCatalog, onFetchModels, onSaveProvider, setActiveProviderId, setDraft, t]);

  return { fetching, fetchModels, localError, save, saving, setLocalError };
};
