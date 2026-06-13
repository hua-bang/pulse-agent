const manifestUrl = document.documentElement.dataset.manifestUrl || '/latest.json';
const versionLabel = document.querySelector('#version-label');
const downloadLabel = document.querySelector('#download-label');
const primaryDownload = document.querySelector('#primary-download');
const heroTitle = document.querySelector('#hero-title');
const releaseNotes = document.querySelector('#release-notes');
const releaseList = document.querySelector('#release-list');
const languageLinks = document.querySelectorAll('[data-lang-option]');

const copy = {
  zh: {
    documentTitle: '下载 Pulse Canvas',
    installNav: '安装说明',
    title: ['Pulse Canvas'],
    slogan: '组织信息，驱动动作，闭环反馈。',
    checking: '正在检查最新版本...',
    latest: (version, date) => `最新版本 ${version}${date ? ` · ${date}` : ''}`,
    download: (size) => `下载 Apple Silicon 版${size ? ` · ${size}` : ''}`,
    openDownloadPage: '打开下载页',
    unavailable: '暂时无法获取最新版本。',
    tryAgain: '稍后再试',
    installKicker: '安装',
    installTitle: 'macOS 首次打开',
    installStep1: '下载 DMG，并把 Pulse Canvas 拖进 Applications。',
    installStep2: '如果 macOS 阻止打开，右键 Pulse Canvas，选择 Open。',
    installStep3: '首次确认 Open 后，后续通常可直接启动。',
    releaseNotesKicker: '版本更新',
    releaseNotesTitle: 'Release notes',
    updatesKicker: '更新',
    updatesTitle: '手动更新',
    updatesBody: '从本页下载最新版本并替换已安装的 app。你的 canvas 数据会单独保存。',
    locale: 'zh-CN',
    htmlLang: 'zh-Hans',
  },
  en: {
    documentTitle: 'Pulse Canvas Download',
    installNav: 'Install notes',
    title: ['Pulse Canvas'],
    slogan: 'Organize information, drive action, and close the feedback loop.',
    checking: 'Checking latest version...',
    latest: (version, date) => `Latest version ${version}${date ? ` · ${date}` : ''}`,
    download: (size) => `Download for Apple Silicon${size ? ` · ${size}` : ''}`,
    openDownloadPage: 'Open download page',
    unavailable: 'Latest version is temporarily unavailable.',
    tryAgain: 'Try again later',
    installKicker: 'Install',
    installTitle: 'macOS first open',
    installStep1: 'Download the DMG and drag Pulse Canvas into Applications.',
    installStep2: 'If macOS blocks the app, right-click Pulse Canvas and choose Open.',
    installStep3: 'Confirm Open once. Later launches should open normally.',
    releaseNotesKicker: 'Versions',
    releaseNotesTitle: 'Release notes',
    updatesKicker: 'Updates',
    updatesTitle: 'Manual updates',
    updatesBody: 'Download the latest version from this page and replace the installed app. Your canvas data is stored separately.',
    locale: 'en-US',
    htmlLang: 'en',
  },
};

const platform = (() => {
  const value = navigator.userAgent.toLowerCase();
  if (value.includes('mac')) return 'mac';
  if (value.includes('win')) return 'windows';
  if (value.includes('linux')) return 'linux';
  return 'other';
})();

let activeLanguage = getInitialLanguage();
let latestManifest = null;
let primaryFile = null;

function getInitialLanguage() {
  const params = new URLSearchParams(window.location.search);
  const queryLanguage = params.get('lang');
  if (queryLanguage === 'zh' || queryLanguage === 'en') return queryLanguage;

  const storedLanguage = window.localStorage?.getItem('pulse-canvas.download-language');
  if (storedLanguage === 'zh' || storedLanguage === 'en') return storedLanguage;

  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function scoreFile(name) {
  const lower = name.toLowerCase();
  if (platform === 'mac') {
    if (lower.endsWith('.dmg')) return 100;
    if (lower.endsWith('.zip')) return 80;
  }
  if (platform === 'windows' && lower.endsWith('.exe')) return 100;
  if (platform === 'linux') {
    if (lower.endsWith('.appimage')) return 100;
    if (lower.endsWith('.deb')) return 80;
  }
  return 0;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString(copy[activeLanguage].locale);
}

function resolveLocalizedNotes(notes) {
  if (typeof notes === 'string') return notes.trim();
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return '';
  const localized = notes[activeLanguage] || notes.en || notes.zh;
  return typeof localized === 'string' ? localized.trim() : '';
}

function releaseEntries(manifest) {
  if (Array.isArray(manifest?.releases) && manifest.releases.length > 0) {
    return manifest.releases;
  }
  if (!manifest?.version || !manifest?.notes) return [];
  return [{
    version: manifest.version,
    releasedAt: manifest.releasedAt,
    notes: manifest.notes,
  }];
}

function renderNotesText(container, notes) {
  const lines = notes.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) {
    const paragraph = document.createElement('p');
    paragraph.textContent = notes;
    container.appendChild(paragraph);
    return;
  }

  const list = document.createElement('ul');
  for (const line of lines) {
    const item = document.createElement('li');
    item.textContent = line.replace(/^[-*]\s+/, '');
    list.appendChild(item);
  }
  container.appendChild(list);
}

function renderReleaseNotes() {
  if (!latestManifest) {
    releaseNotes.hidden = true;
    releaseList.replaceChildren();
    return;
  }

  const entries = releaseEntries(latestManifest)
    .map((entry) => ({
      version: typeof entry.version === 'string' ? entry.version.trim() : '',
      releasedAt: typeof entry.releasedAt === 'string' ? entry.releasedAt : '',
      notes: resolveLocalizedNotes(entry.notes),
    }))
    .filter((entry) => entry.version && entry.notes);

  releaseNotes.hidden = entries.length === 0;
  releaseList.replaceChildren(...entries.map((entry) => {
    const article = document.createElement('article');
    article.className = 'release-entry';

    const header = document.createElement('div');
    header.className = 'release-entry__header';

    const version = document.createElement('span');
    version.className = 'release-entry__version';
    version.textContent = `v${entry.version}`;
    header.appendChild(version);

    const date = formatDate(entry.releasedAt);
    if (date) {
      const time = document.createElement('time');
      time.className = 'release-entry__date';
      time.dateTime = entry.releasedAt;
      time.textContent = date;
      header.appendChild(time);
    }

    const body = document.createElement('div');
    body.className = 'release-entry__body';
    renderNotesText(body, entry.notes);

    article.append(header, body);
    return article;
  }));
}

function renderTitle(parts) {
  heroTitle.replaceChildren(...parts.map((part) => {
    const span = document.createElement('span');
    span.textContent = part;
    return span;
  }));
}

function renderStaticCopy() {
  const text = copy[activeLanguage];
  document.documentElement.lang = text.htmlLang;
  document.title = text.documentTitle;
  renderTitle(text.title);

  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n;
    if (typeof text[key] === 'string') {
      node.textContent = text[key];
    }
  });

  languageLinks.forEach((link) => {
    const isActive = link.dataset.langOption === activeLanguage;
    link.setAttribute('aria-current', String(isActive));
  });
}

function renderReleaseState() {
  const text = copy[activeLanguage];
  if (!latestManifest) {
    versionLabel.textContent = text.checking;
    downloadLabel.textContent = text.download('');
    renderReleaseNotes();
    return;
  }

  versionLabel.textContent = text.latest(latestManifest.version, formatDate(latestManifest.releasedAt));
  renderReleaseNotes();

  if (primaryFile) {
    primaryDownload.href = primaryFile.url;
    primaryDownload.removeAttribute('aria-disabled');
    downloadLabel.textContent = text.download(formatBytes(primaryFile.size));
    primaryDownload.title = primaryFile.name;
  } else if (latestManifest.downloadUrl) {
    primaryDownload.href = latestManifest.downloadUrl;
    primaryDownload.removeAttribute('aria-disabled');
    downloadLabel.textContent = text.openDownloadPage;
  }
}

function setLanguage(language, { persist = true, pushState = false } = {}) {
  activeLanguage = language === 'en' ? 'en' : 'zh';
  if (persist) {
    window.localStorage?.setItem('pulse-canvas.download-language', activeLanguage);
  }
  if (pushState) {
    const url = new URL(window.location.href);
    url.searchParams.set('lang', activeLanguage);
    window.history.replaceState({}, '', url);
  }
  renderStaticCopy();
  renderReleaseState();
}

languageLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    setLanguage(link.dataset.langOption, { pushState: true });
  });
});

setLanguage(activeLanguage, { persist: false });

try {
  const response = await fetch(manifestUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
  latestManifest = await response.json();
  const files = Array.isArray(latestManifest.files)
    ? latestManifest.files.filter((file) => file?.url && file?.name)
    : [];
  const visibleFiles = files.filter((file) => !/(\.blockmap|^latest.*\.ya?ml$|\.json)$/i.test(file.name));
  primaryFile = visibleFiles
    .map((file) => ({ file, score: scoreFile(file.name) }))
    .sort((a, b) => b.score - a.score)[0]?.file ?? null;

  renderReleaseState();
} catch (err) {
  versionLabel.textContent = copy[activeLanguage].unavailable;
  downloadLabel.textContent = copy[activeLanguage].tryAgain;
  releaseNotes.hidden = true;
  console.error(err);
}
