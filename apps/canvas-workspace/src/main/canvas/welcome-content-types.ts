/**
 * Content contract for the seeded first-run (onboarding) workspace.
 *
 * The onboarding canvas is a five-frame, left-to-right "course" narrated by
 * a guide character (a front-end engineer planning a website-revamp
 * project). Copy lives in `welcome-content-zh.ts` / `welcome-content-en.ts`;
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
    solution: WelcomeNoteContent;
    kanban: WelcomeNoteContent;
    reference: WelcomeNoteContent;
    prompts: WelcomeNoteContent;
    context: WelcomeNoteContent;
    meeting: WelcomeNoteContent;
    project: WelcomeNoteContent;
    loop: WelcomeNoteContent;
  };
  /** Free-form text labels. */
  texts: {
    guide: WelcomeTextContent;
    practice: WelcomeTextContent;
    idea: WelcomeTextContent;
    edgeTeach: WelcomeTextContent;
    frameIntro: WelcomeTextContent;
    aiOpen: WelcomeTextContent;
    feedback: WelcomeTextContent;
    multiWorkspace: WelcomeTextContent;
  };
  shape: { title: string; text: string };
  iframes: {
    slogan: { title: string; html: string };
    download: { title: string; url: string };
    referencePage: { title: string; url: string };
    basicsCard: { title: string; html: string };
    shortcuts: { title: string; html: string };
  };
  mindmap: { title: string; root: WelcomeMindmapTopicContent };
  /** Edge labels. */
  edges: {
    ideaToSolution: string;
    contextToMeeting: string;
  };
}
