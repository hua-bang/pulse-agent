import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../../../i18n';
import type { CanvasProviderModel } from '../../../../../types';
import { Button, SegmentedControl, TextField } from '../../../../../components/ui';
import { matchesModelQuery } from '../../../../../utils/modelCatalog';
import { modelSettingsCopy } from '../copy';
import './index.css';

interface Props {
  activeProviderId: string;
  availableModels: CanvasProviderModel[];
  selectedModels: CanvasProviderModel[];
  onToggleModel: (model: CanvasProviderModel, selected: boolean) => void;
  /** Select or clear every model the current search and filter show. */
  onSetModelsSelected: (models: CanvasProviderModel[], selected: boolean) => void;
  /** Set or clear (`undefined`) the window the user chose for one model. */
  onSetModelContextWindow: (modelId: string, tokens: number | undefined) => void;
}

const DEFAULT_WINDOW_K = 128;

export const ModelCatalog = ({
  activeProviderId,
  availableModels,
  selectedModels,
  onToggleModel,
  onSetModelsSelected,
  onSetModelContextWindow,
}: Props) => {
  const { language, t } = useI18n();
  const copy = modelSettingsCopy(language);
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

  const allShownSelected = filteredModels.length > 0
    && filteredModels.every((model) => selectedModelIds.has(model.id));

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
        <Button
          size="xs"
          variant="secondary"
          className="chat-model-catalog-bulk"
          disabled={filteredModels.length === 0}
          onClick={() => onSetModelsSelected(filteredModels, !allShownSelected)}
        >
          {allShownSelected ? copy.clearAll : copy.selectAll}
        </Button>
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
          const reportedK = model.context_window ? Math.round(model.context_window / 1000) : DEFAULT_WINDOW_K;
          return (
            <div
              key={model.id}
              className={`chat-model-model-item${selected ? ' chat-model-model-item--selected' : ''}`}
            >
              <Button
                size="xs"
                role="checkbox"
                aria-checked={selected}
                className="chat-model-model-row"
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
              {/* Empty shows the reported window as the placeholder and uses it. */}
              <span className="chat-model-model-window" title={copy.contextWindowTitle}>
                <TextField
                  className="chat-model-model-window-input"
                  type="number"
                  min={1}
                  step={1}
                  value={model.custom_context_window ? String(Math.round(model.custom_context_window / 1000)) : ''}
                  placeholder={String(reportedK)}
                  aria-label={copy.contextWindowLabel.replace('{model}', model.name ?? model.id)}
                  onChange={(event) => {
                    const thousands = Math.round(Number(event.target.value));
                    onSetModelContextWindow(model.id, thousands > 0 ? thousands * 1000 : undefined);
                  }}
                />
                <span aria-hidden="true">K</span>
              </span>
            </div>
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
