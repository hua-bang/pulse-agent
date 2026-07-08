/**
 * Content contract for the seeded first-run (onboarding) workspace.
 *
 * The onboarding canvas is a five-frame, left-to-right product course: it
 * explains Pulse Canvas itself, shallow to deep — what it is → canvas
 * essentials → organizing → working with AI → power moves. Visual weight
 * lives in styled HTML iframe cards (hero, feature grid, concept diagram,
 * kanban, chat mock, workflow); notes carry the copy users should edit.
 * Locale copy lives in `welcome-content-zh.ts` / `welcome-content-en.ts`;
 * geometry and node assembly live in `welcome-nodes.ts`. Keys here are
 * layout-stable: adding a node means touching the type, both locales, and
 * the builder together.
 */

export interface WelcomeNoteContent {
  title: string;
  /** Markdown file name written under the workspace notes/ directory. */
  filename: string;
  content: string;
}

export interface WelcomeTextContent {
  title: string;
  /** Markdown body of the text label. */
  content: string;
}

export interface WelcomeHtmlCard {
  title: string;
  /** Self-contained HTML document rendered by an `html`-mode iframe node. */
  html: string;
}

export interface WelcomeMindmapTopicContent {
  text: string;
  children?: WelcomeMindmapTopicContent[];
}

export interface WelcomeContent {
  /** Frame titles, numbered to guide reading order (e.g. "01 · Welcome"). */
  frames: {
    welcome: string;
    basics: string;
    organize: string;
    ai: string;
    advanced: string;
  };
  /** File nodes; contents are persisted as real markdown files. */
  notes: {
    welcome: WelcomeNoteContent;
    practice: WelcomeNoteContent;
    answer: WelcomeNoteContent;
    reference: WelcomeNoteContent;
    prompts: WelcomeNoteContent;
    context: WelcomeNoteContent;
    ideas: WelcomeNoteContent;
    project: WelcomeNoteContent;
  };
  /** Free-form text labels. */
  texts: {
    guide: WelcomeTextContent;
    practice: WelcomeTextContent;
    problem: WelcomeTextContent;
    edgeTeach: WelcomeTextContent;
    frameIntro: WelcomeTextContent;
    aiOpen: WelcomeTextContent;
    feedback: WelcomeTextContent;
    multiWorkspace: WelcomeTextContent;
  };
  shape: { title: string; text: string };
  /** URL-mode iframe (external page). */
  download: { title: string; url: string };
  /** HTML-mode iframe cards — the visual backbone of the course. */
  cards: {
    hero: WelcomeHtmlCard;
    featureGrid: WelcomeHtmlCard;
    concept: WelcomeHtmlCard;
    basics: WelcomeHtmlCard;
    kanban: WelcomeHtmlCard;
    chatMock: WelcomeHtmlCard;
    workflow: WelcomeHtmlCard;
    shortcuts: WelcomeHtmlCard;
  };
  mindmap: { title: string; root: WelcomeMindmapTopicContent };
  /** Edge labels. */
  edges: {
    problemToAnswer: string;
    contextToIdeas: string;
  };
}
