import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../i18n';
import type { CanvasProviderModel } from '../../../types';
import { Button, SegmentedControl, TextField } from '../../ui';
import { matchesModelQuery } from '../../../utils/modelCatalog';
import './index.css';

interface Props {
  activeProviderId: string;
  availableModels: CanvasProviderModel[];
  selectedModels: CanvasProviderModel[];
  onToggleModel: (model: CanvasProviderModel, selected: boolean) => void;
}

export const ModelCatalog = ({
  activeProviderId,
  availableModels,
  selectedModels,
  onToggleModel,
}: Props) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const selectedModelIds = useMemo(
    () => new Set(selectedModels.map((model) => model.id)),
    [selectedModels],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = useMemo(() => availableModels.filter((model) => {
    if (selectedOnly && !selectedModelIds.has(model.id)) return false;
    if (!normalizedQuery) return true;
    return matchesModelQuery(model, normalizedQuery);
  }), [availableModels, normalizedQuery, selectedModelIds, selectedOnly]);

  useEffect(() => {
    setQuery('');
    setSelectedOnly(false);
  }, [activeProviderId]);

  return (
    <div className="chat-model-catalog">
      <div className="chat-model-catalog-head">
        <strong>{t('models.models')}</strong>
        <span>{t('models.selectionSummary', {
          selected: selectedModelIds.size,
          total: availableModels.length,
        })}</span>
      </div>
      <div className="chat-model-model-search-wrap">
        <TextField
          className="chat-model-model-search"
          value={query}
          type="search"
          placeholder={t('models.searchModels')}
          aria-label={t('models.searchModels')}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <SegmentedControl
        className="chat-model-model-filters"
        value={selectedOnly ? 'selected' : 'all'}
        onChange={(value) => setSelectedOnly(value === 'selected')}
        options={[
          { id: 'all', label: t('models.allModels') },
          { id: 'selected', label: t('models.selectedModels', { count: selectedModelIds.size }) },
        ]}
      />
      <div className="chat-model-model-list" role="group" aria-label={t('models.availableModelsAria')}>
        {filteredModels.length > 0 ? filteredModels.map((model) => {
          const selected = selectedModelIds.has(model.id);
          return (
            <Button
              key={model.id}
              size="xs"
              role="checkbox"
              aria-checked={selected}
              className={`chat-model-model-row${selected ? ' chat-model-model-row--selected' : ''}`}
              onClick={() => onToggleModel(model, !selected)}
            >
              <span className="chat-model-model-checkbox" aria-hidden="true">
                {selected ? '✓' : ''}
              </span>
              <span className="chat-model-model-row-copy">
                <strong>{model.name ?? model.id}</strong>
                {model.name && model.name !== model.id && <small>{model.id}</small>}
              </span>
            </Button>
          );
        }) : (
          <div className="chat-model-catalog-empty">
            {availableModels.length > 0 ? t('models.noModelMatches') : t('models.emptyModelList')}
          </div>
        )}
      </div>
    </div>
  );
};
