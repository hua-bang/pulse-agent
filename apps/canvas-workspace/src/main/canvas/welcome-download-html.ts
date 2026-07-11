import downloadSiteStyles from '../../../download-site/styles.css?raw';

interface WelcomeDownloadCopy {
  title: string;
  body: string;
  action: string;
  note: string;
}

/**
 * Build the network-free Welcome snapshot from the download site's real CSS.
 * The live page remains the source for releases; this snapshot only provides
 * immediate branded content and links into the app's shared preview policy.
 */
export const makeWelcomeDownloadHtml = (
  language: 'zh' | 'en',
  downloadUrl: string,
  copy: WelcomeDownloadCopy,
): string => `<!doctype html>
<html lang="${language === 'zh' ? 'zh-Hans' : 'en'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pulse Canvas Download</title>
  <style>${downloadSiteStyles}</style>
  <style>
    .hero { grid-template-columns: minmax(0, 720px); min-height: 540px; justify-content: center; }
    .hero-copy { max-width: 720px; }
    .local-note { margin-top: 14px; color: var(--text-muted); font-size: 13px; }
  </style>
</head>
<body>
  <main class="page-shell">
    <header class="site-header">
      <div class="brand"><span>Pulse Canvas</span></div>
      <span class="section-kicker">Local welcome</span>
    </header>
    <section class="hero">
      <div class="hero-copy">
        <h1><span>Pulse Canvas</span></h1>
        <p class="slogan">${copy.title}</p>
        <p>${copy.body}</p>
        <div class="download-actions">
          <a class="primary-action" href="${downloadUrl}" target="_blank" rel="noopener noreferrer">
            <span class="primary-action__label">${copy.action}</span>
            <span class="primary-action__meta"><span class="status-dot" aria-hidden="true"></span>pulse-canvas-download.pages.dev</span>
          </a>
        </div>
        <p class="local-note">${copy.note}</p>
      </div>
    </section>
  </main>
</body>
</html>`;
