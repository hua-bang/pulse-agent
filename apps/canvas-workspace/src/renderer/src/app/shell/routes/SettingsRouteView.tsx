import { lazy, Suspense } from 'react';
import type { SettingsSection } from '../../../modules/settings';
import { PulseRouterView } from '../router';

const Settings = lazy(() => import('../../../modules/settings/app').then((module) => ({ default: module.Settings })));

interface Props {
  section: SettingsSection;
  onClose: () => void;
}

/** Global settings as a full page; entry points pass `?section=`. */
export const SettingsRouteView = ({ section, onClose }: Props) => (
  <PulseRouterView name="settings">
    <Suspense fallback={null}>
      <Settings initialSection={section} onClose={onClose} />
    </Suspense>
  </PulseRouterView>
);
