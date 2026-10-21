/**
 * Usage data section of the global Settings page — the opt-out switch for
 * anonymous telemetry. Main owns the stored value
 * (`~/.pulse-coder/canvas/telemetry.json`); a change applies immediately.
 * Hidden when this build has no gateway URL, because nothing is sent.
 *
 * Built from the blessed set (SectionHeader / SegmentedControl), like
 * BrowserSection.
 */
import { useEffect, useState } from 'react';
import type { TelemetryStatus } from '../../../../types';
import { useI18n } from '../../../../i18n';
import { SectionHeader, SegmentedControl } from '../../../../components/ui';
import './TelemetrySection.css';

export const TelemetrySection = () => {
  const { t } = useI18n();
  const [status, setStatus] = useState<TelemetryStatus | null>(null);

  useEffect(() => {
    let active = true;
    void window.canvasWorkspace.telemetry.status().then((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!status?.configured) return null;

  return (
    <div className="cfg-pane">
      <div className="telemetry-settings">
        <SectionHeader
          title={t('settings.telemetry.title')}
          description={t('settings.telemetry.description')}
        />
        <SegmentedControl
          options={[
            { id: 'on', label: t('experimental.on') },
            { id: 'off', label: t('experimental.off') },
          ]}
          value={status.enabled ? 'on' : 'off'}
          onChange={(id) => {
            void window.canvasWorkspace.telemetry.setEnabled(id === 'on').then(setStatus);
          }}
          ariaLabel={t('settings.telemetry.title')}
        />
      </div>
    </div>
  );
};
