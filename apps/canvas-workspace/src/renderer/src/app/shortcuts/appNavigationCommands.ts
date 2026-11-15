import { useEffect } from 'react';
import type { I18nKey, useI18n } from '../../i18n';
import { requestOpenAppSettings } from '../../shared/appShell';
import { publishAppCommands, type AppNavigationCommand } from '../../shared/appCommands';

export interface AppNavigationRoutes {
  canvas: string;
  chat: string;
  home: string;
  plugins: string;
  scheduled: string;
  skills: string;
}

interface Input {
  workspaces: Array<{ id: string; name: string }>;
  routes: AppNavigationRoutes;
  selectWorkspace: (id: string) => void;
  setLocation: (path: string) => void;
  t: ReturnType<typeof useI18n>['t'];
}

type PageRoute = Exclude<keyof AppNavigationRoutes, 'canvas'>;

const PAGES: Array<{ route: PageRoute; titleKey: I18nKey; aliases: string[] }> = [
  { route: 'home', titleKey: 'app.palette.goHome', aliases: ['home', 'launcher', 'start', '首页'] },
  { route: 'chat', titleKey: 'app.palette.goChat', aliases: ['chat', 'ai', 'conversation', '聊天'] },
  { route: 'plugins', titleKey: 'app.palette.goPlugins', aliases: ['plugins', 'market', '插件'] },
  { route: 'scheduled', titleKey: 'app.palette.goScheduled', aliases: ['scheduled', 'cron', 'tasks', '定时'] },
  { route: 'skills', titleKey: 'app.palette.goSkills', aliases: ['skills', '技能'] },
];

/** Pages first, then one entry per workspace. */
export const buildAppNavigationCommands = ({
  workspaces,
  routes,
  selectWorkspace,
  setLocation,
  t,
}: Input): AppNavigationCommand[] => [
  ...PAGES.map((page): AppNavigationCommand => ({
    id: `page:${page.route}`,
    title: t(page.titleKey),
    aliases: page.aliases,
    run: () => setLocation(routes[page.route]),
  })),
  {
    id: 'page:settings',
    title: t('app.palette.goSettings'),
    aliases: ['settings', 'preferences', '设置'],
    run: () => requestOpenAppSettings(),
  },
  ...workspaces.map((workspace): AppNavigationCommand => ({
    id: `workspace:${workspace.id}`,
    title: t('app.palette.openWorkspace', { name: workspace.name }),
    aliases: [workspace.name, 'workspace', 'canvas', '工作区'],
    run: () => {
      selectWorkspace(workspace.id);
      setLocation(routes.canvas);
    },
  })),
];

/** Keep the published palette commands in sync with the workspace list. */
export const useAppNavigationCommands = (input: Input): void => {
  const { workspaces, routes, selectWorkspace, setLocation, t } = input;
  useEffect(() => {
    publishAppCommands(buildAppNavigationCommands({ workspaces, routes, selectWorkspace, setLocation, t }));
  }, [routes, selectWorkspace, setLocation, t, workspaces]);
};
