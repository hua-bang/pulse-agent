import type { AppTranslation } from './en';

const zh: AppTranslation = {
  common: {
    close: '关闭',
  },
  settings: {
    kicker: '设置',
    ariaLabel: '设置',
    sectionsAriaLabel: '设置分类',
    sections: {
      models: {
        label: '模型',
        description: '服务商、API 密钥、当前模型',
        title: '模型与服务商',
      },
      replyStyle: {
        label: '回复风格',
        description: '预设与自定义提示词',
        title: '回复风格与自定义提示词',
      },
      agent: {
        label: 'Agent',
        description: 'Skills 与外部 Agent 配置',
        title: 'Agent',
      },
      experimental: {
        label: '实验功能',
        description: '开启不稳定的实验性功能',
        title: '实验功能',
      },
      language: {
        label: '语言',
        description: '界面语言',
        title: '语言',
      },
    },
    language: {
      intro: '选择 Canvas Workspace 的界面语言。',
      hint: '大部分界面会立即生效；部分系统原生对话框会在下次触发时更新。',
      options: {
        en: 'English (英文)',
        zh: '简体中文',
      },
      savedToast: {
        title: '语言已更新',
      },
      saveErrorToast: {
        title: '语言切换失败',
      },
    },
  },
};

export default zh;
