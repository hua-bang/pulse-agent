const configuredManifestUrl = document.documentElement.dataset.manifestUrl;
const manifestUrl = configuredManifestUrl && !configuredManifestUrl.includes('__PULSE_CANVAS_MANIFEST_URL__')
  ? configuredManifestUrl
  : './latest.sample.json';
const versionLabel = document.querySelector('#version-label');
const downloadLabel = document.querySelector('#download-label');
const primaryDownload = document.querySelector('#primary-download');
const downloadOptions = document.querySelector('#download-options');
const heroTitle = document.querySelector('#hero-title');
const releaseNotes = document.querySelector('#release-notes');
const releaseList = document.querySelector('#release-list');
const languageLinks = document.querySelectorAll('[data-lang-option]');
const INITIAL_RELEASE_COUNT = 3;

const copy = {
  zh: {
    documentTitle: '下载 Pulse Canvas',
    installNav: '安装说明',
    title: ['Pulse Canvas'],
    slogan: '组织信息，驱动动作，闭环反馈。',
    checking: '正在检查最新版本...',
    latest: (version, date) => `最新版本 ${version}${date ? ` · ${date}` : ''}`,
    download: (label, size) => `${label}${size ? ` · ${size}` : ''}`,
    downloadRecommended: '下载推荐版本',
    macAppleSilicon: 'macOS Apple Silicon',
    macIntel: 'macOS Intel',
    windowsX64: 'Windows x64',
    linuxX64: 'Linux x64',
    otherDownload: '下载此版本',
    comingSoon: '即将提供',
    checksum: 'SHA256',
    openDownloadPage: '打开下载页',
    unavailable: '暂时无法获取最新版本。',
    tryAgain: '稍后再试',
    unsignedNotice: '当前为早期测试版，尚未经过 Apple notarization。首次打开可能需要在“系统设置 > 隐私与安全性”中选择“仍要打开”。',
    installKicker: '安装',
    installTitle: 'macOS 首次打开',
    installStep1: '下载 DMG，并把 Pulse Canvas 拖进 Applications。',
    installStep2: '从 Applications 打开一次；如果看到“Pulse Canvas Not Opened”，点击 Done。',
    installStep3: '打开“系统设置 > 隐私与安全性”，在 Security 区域点击“仍要打开”。',
    installStep4: '再次确认“打开”。后续通常可直接启动。',
    installNote: '这是早期版本暂未使用 Apple Developer ID 签名导致的安全提示，不影响本地使用。',
    releaseNotesKicker: '版本更新',
    releaseNotesTitle: 'Release notes',
    showMoreReleases: '查看更多版本',
    showFewerReleases: '收起版本',
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
    download: (label, size) => `${label}${size ? ` · ${size}` : ''}`,
    downloadRecommended: 'Download recommended build',
    macAppleSilicon: 'macOS Apple Silicon',
    macIntel: 'macOS Intel',
    windowsX64: 'Windows x64',
    linuxX64: 'Linux x64',
    otherDownload: 'Download this build',
    comingSoon: 'Coming soon',
    checksum: 'SHA256',
    openDownloadPage: 'Open download page',
    unavailable: 'Latest version is temporarily unavailable.',
    tryAgain: 'Try again later',
    unsignedNotice: 'This early build is not Apple-notarized yet. On first launch, macOS may require System Settings > Privacy & Security > Open Anyway.',
    installKicker: 'Install',
    installTitle: 'macOS first open',
    installStep1: 'Download the DMG and drag Pulse Canvas into Applications.',
    installStep2: 'Open Pulse Canvas once from Applications. If macOS shows “Pulse Canvas Not Opened”, click Done.',
    installStep3: 'Open System Settings > Privacy & Security, then click Open Anyway in the Security section.',
    installStep4: 'Confirm Open once. Later launches should open normally.',
    installNote: 'This security prompt appears because the early build does not use an Apple Developer ID signature yet. Local use is still supported.',
    releaseNotesKicker: 'Versions',
    releaseNotesTitle: 'Release notes',
    showMoreReleases: 'Show more versions',
    showFewerReleases: 'Show fewer versions',
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
let visibleFiles = [];
let showAllReleases = false;

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
    if (lower.includes('arm64') && lower.endsWith('.dmg')) return 110;
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

function isVisibleDownload(file) {
  return file?.url && file?.name && !/(\.blockmap|^latest.*\.ya?ml$|\.json)$/i.test(file.name);
}

function getFileKind(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.dmg') || name.endsWith('.zip')) {
    return name.includes('arm64') || name.includes('aarch64') ? 'mac-arm64' : 'mac-x64';
  }
  if (name.endsWith('.exe')) return 'windows-x64';
  if (name.endsWith('.appimage') || name.endsWith('.deb')) return 'linux-x64';
  return 'other';
}

function labelForFile(file) {
  const text = copy[activeLanguage];
  switch (getFileKind(file)) {
    case 'mac-arm64':
      return text.macAppleSilicon;
    case 'mac-x64':
      return text.macIntel;
    case 'windows-x64':
      return text.windowsX64;
    case 'linux-x64':
      return text.linuxX64;
    default:
      return text.otherDownload;
  }
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
    if (isImportantReleaseNoteLine(notes)) {
      paragraph.className = 'release-entry__highlight';
    }
    container.appendChild(paragraph);
    return;
  }

  const list = document.createElement('ul');
  for (const line of lines) {
    const item = document.createElement('li');
    item.textContent = line.replace(/^[-*]\s+/, '');
    if (isImportantReleaseNoteLine(item.textContent)) {
      item.className = 'release-entry__highlight';
    }
    list.appendChild(item);
  }
  container.appendChild(list);
}

function isImportantReleaseNoteLine(line) {
  const normalized = line.toLowerCase();
  return (
    (line.includes('重新保存一次') && line.includes('旧 key 不会自动读取')) ||
    (normalized.includes('save them again') && normalized.includes('no longer read automatically'))
  );
}

function renderReleaseNotes() {
  const text = copy[activeLanguage];
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
  if (entries.length === 0) {
    releaseList.replaceChildren();
    return;
  }

  releaseList.classList.toggle('release-list--expanded', showAllReleases);

  const releaseNodes = entries.map((entry, index) => {
    const article = document.createElement('article');
    article.className = `release-entry${index >= INITIAL_RELEASE_COUNT ? ' release-entry--extra' : ''}`;
    if (index >= INITIAL_RELEASE_COUNT) {
      article.setAttribute('aria-hidden', String(!showAllReleases));
    }

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
  });

  if (entries.length > INITIAL_RELEASE_COUNT) {
    const more = document.createElement('button');
    more.className = 'release-list__more';
    more.type = 'button';
    more.textContent = showAllReleases ? text.showFewerReleases : text.showMoreReleases;
    more.setAttribute('aria-expanded', String(showAllReleases));
    more.addEventListener('click', () => {
      showAllReleases = !showAllReleases;
      releaseList.classList.toggle('release-list--expanded', showAllReleases);
      releaseList.querySelectorAll('.release-entry--extra').forEach((node) => {
        node.setAttribute('aria-hidden', String(!showAllReleases));
      });
      more.textContent = showAllReleases ? text.showFewerReleases : text.showMoreReleases;
      more.setAttribute('aria-expanded', String(showAllReleases));
    });
    releaseNodes.push(more);
  }

  releaseList.replaceChildren(...releaseNodes);
}

function renderDownloadOption(file) {
  const text = copy[activeLanguage];
  const link = document.createElement('a');
  link.className = 'download-option';
  link.href = file.url;
  link.title = file.name;

  const title = document.createElement('span');
  title.className = 'download-option__title';
  title.textContent = labelForFile(file);

  const meta = document.createElement('span');
  meta.className = 'download-option__meta';
  meta.textContent = [formatBytes(file.size), file.name].filter(Boolean).join(' · ');

  link.append(title, meta);

  if (file.sha256) {
    const checksum = document.createElement('span');
    checksum.className = 'download-option__checksum';
    checksum.textContent = `${text.checksum}: ${file.sha256}`;
    link.appendChild(checksum);
  }

  return link;
}

function renderComingSoonOption(kind) {
  const text = copy[activeLanguage];
  const item = document.createElement('div');
  item.className = 'download-option download-option--disabled';

  const title = document.createElement('span');
  title.className = 'download-option__title';
  title.textContent = kind === 'mac-x64' ? text.macIntel : text.otherDownload;

  const meta = document.createElement('span');
  meta.className = 'download-option__meta';
  meta.textContent = text.comingSoon;

  item.append(title, meta);
  return item;
}

function renderDownloadOptions() {
  if (!downloadOptions) return;
  downloadOptions.replaceChildren();
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
    downloadLabel.textContent = text.download(text.downloadRecommended, '');
    renderDownloadOptions();
    renderReleaseNotes();
    return;
  }

  versionLabel.textContent = text.latest(latestManifest.version, formatDate(latestManifest.releasedAt));
  renderReleaseNotes();
  renderDownloadOptions();

  if (primaryFile) {
    primaryDownload.href = primaryFile.url;
    primaryDownload.removeAttribute('aria-disabled');
    downloadLabel.textContent = text.download(labelForFile(primaryFile), formatBytes(primaryFile.size));
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
  visibleFiles = files.filter(isVisibleDownload);
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
