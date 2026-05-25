/**
 * English UI strings.
 *
 * The bundled keys are the i18n-infrastructure starter set: just enough
 * to wire react-i18next end-to-end (Settings rail + LanguageSection).
 * Per-module string extraction lands in follow-up PRs.
 */

const en = {
  common: {
    close: 'Close',
  },
  settings: {
    kicker: 'Settings',
    ariaLabel: 'Settings',
    sectionsAriaLabel: 'Settings sections',
    sections: {
      models: {
        label: 'Models',
        description: 'Providers, API keys, current model',
        title: 'Models & Providers',
      },
      replyStyle: {
        label: 'Reply Style',
        description: 'Preset + custom prompt',
        title: 'Reply Style & Custom Prompt',
      },
      agent: {
        label: 'Agent',
        description: 'Skills & external agent setup',
        title: 'Agent',
      },
      experimental: {
        label: 'Experimental',
        description: 'Opt in to unstable features',
        title: 'Experimental Features',
      },
      language: {
        label: 'Language',
        description: 'Interface language',
        title: 'Language',
      },
    },
    language: {
      intro: 'Choose the interface language for Canvas Workspace.',
      hint: 'Most of the UI updates immediately. Some OS-native dialogs update on the next file action.',
      options: {
        en: 'English',
        zh: '简体中文 (Simplified Chinese)',
      },
      savedToast: {
        title: 'Language updated',
      },
      saveErrorToast: {
        title: 'Could not change language',
      },
    },
  },
};

export default en;
export type AppTranslation = typeof en;
