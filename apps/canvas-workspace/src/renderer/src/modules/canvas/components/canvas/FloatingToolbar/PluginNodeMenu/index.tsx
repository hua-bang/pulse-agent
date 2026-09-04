import { useCallback, useEffect, useMemo, useState } from 'react';
import { DropdownShell } from '../../../../../../components/ui';
import { CANVAS_PLUGINS_CHANGED_EVENT } from '../../../../../../constants/canvasPlugins';
import { useI18n } from '../../../../../../i18n';
import type { CanvasPluginsStatus } from '../../../../../../types/settings-config';
import { PluginNodeIcon, inferPluginIcon } from '../PluginNodeIcon';
import type { AddCanvasNode } from '../types';
import {
  optionsFromPluginStatus,
  statusFromPluginsChangedEvent,
  type PluginNodeOption,
} from './model';
import './index.css';

export const PluginNodeMenu = ({ onAddNode }: { onAddNode: AddCanvasNode }) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<CanvasPluginsStatus>();
  const [loading, setLoading] = useState(false);
  const options = useMemo(() => optionsFromPluginStatus(status), [status]);

  const load = useCallback(async () => {
    const api = window.canvasWorkspace?.canvasPlugins;
    if (!api?.list) return;
    setLoading(true);
    try {
      const result = await api.list();
      if (result.ok) setStatus(result.status);
      else console.warn('[canvas-toolbar] failed to load plugins:', result.error);
    } catch (error) {
      console.warn('[canvas-toolbar] failed to load plugins:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const handleFocus = () => void load();
    const handlePluginsChanged = (event: Event) => {
      const nextStatus = statusFromPluginsChangedEvent(event);
      if (nextStatus) setStatus(nextStatus);
      else void load();
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener(CANVAS_PLUGINS_CHANGED_EVENT, handlePluginsChanged);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener(CANVAS_PLUGINS_CHANGED_EVENT, handlePluginsChanged);
    };
  }, [load]);

  const createNode = (option: PluginNodeOption) => {
    onAddNode('plugin', { label: option.title, nodePatch: option.nodePatch });
  };

  if (options.length === 0) return null;

  return (
    <DropdownShell
      className="plugin-tool-menu"
      panelClassName="plugin-tool-popover"
      placement="top"
      align="end"
      role="menu"
      ariaLabel={t('canvas.toolbar.plugin')}
      onOpenChange={(open) => {
        if (open) void load();
      }}
      trigger={({ open, toggle }) => (
        <button
          className={`toolbar-btn toolbar-btn--create${open ? ' toolbar-btn--active' : ''}`}
          onClick={toggle}
          aria-label={t('canvas.toolbar.addPluginNode')}
          aria-haspopup="menu"
          aria-expanded={open}
          data-tooltip={t('canvas.toolbar.plugin')}
        >
          <PluginNodeIcon icon="plugin" />
          <span className="toolbar-btn-label">{t('canvas.toolbar.plugin')}</span>
        </button>
      )}
    >
      {({ close }) => (
        <>
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              className="plugin-tool-option"
              role="menuitem"
              onClick={() => {
                close();
                createNode(option);
              }}
            >
              <span className="plugin-tool-option__icon">
                <PluginNodeIcon icon={option.icon ?? inferPluginIcon(option.nodeType)} />
              </span>
              <span className="plugin-tool-option__copy">
                <span className="plugin-tool-option__title">{option.title}</span>
              </span>
            </button>
          ))}
          {loading && (
            <div className="plugin-tool-empty">{t('canvas.toolbar.pluginLoading')}</div>
          )}
        </>
      )}
    </DropdownShell>
  );
};
