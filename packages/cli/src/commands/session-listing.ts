import { extractMessageText, type Session, type SessionSummary } from '../session/session.js';

type Log = (message?: string) => void;

/** Shows the last few text-bearing turns as context (tool traffic skipped). */
export function printRecentConversation(log: Log, session: Session): void {
  const recentMessages = session.messages
    .filter(msg => (msg.role === 'user' || msg.role === 'assistant') && extractMessageText(msg.content).trim())
    .slice(-5);
  if (recentMessages.length === 0) {
    return;
  }

  log('\n💬 Recent conversation:');
  recentMessages.forEach((msg, index) => {
    const role = msg.role === 'user' ? '👤 You' : '🤖 Assistant';
    const contentStr = extractMessageText(msg.content).replace(/\s+/g, ' ').trim();
    const preview = contentStr.substring(0, 100) + (contentStr.length > 100 ? '…' : '');
    log(`${index + 1}. ${role}: ${preview}`);
  });
}

export interface SessionListView {
  sessions: SessionSummary[];
  totalCount: number;
  scope: string;
  allDirectories: boolean;
  currentSessionId: string | null;
}

export function printSessionList(log: Log, view: SessionListView): void {
  const { sessions, totalCount, scope, allDirectories, currentSessionId } = view;

  if (sessions.length === 0) {
    log('\n📭 No saved sessions found.');
    return;
  }

  log(`\n📋 Saved sessions (showing ${sessions.length} of ${totalCount} · ${scope}):`);
  log('='.repeat(80));

  sessions.forEach((session, index) => {
    const isActive = session.id === currentSessionId ? '✅' : '  ';
    const date = new Date(session.updatedAt).toLocaleString();
    log(`${index + 1}. ${isActive} ${session.title}`);
    log(`   ID: ${session.id}`);
    log(`   Messages: ${session.messageCount} | Updated: ${date}`);
    if (session.taskListId) {
      log(`   Task List: ${session.taskListId}`);
    }
    log(`   Preview: ${session.preview}`);
    log();
  });
  if (totalCount > sessions.length) {
    log(`… ${totalCount - sessions.length} older sessions hidden · /sessions <n> shows more`);
  }
  if (!allDirectories) {
    log('Scoped to this directory · /sessions --all lists every directory.');
  }
  log('Resume with /resume <index>, a unique id prefix, or the full id.');
}

export function printSearchResults(log: Log, query: string, sessions: SessionSummary[]): void {
  if (sessions.length === 0) {
    log(`\n🔍 No sessions found matching "${query}"`);
    return;
  }

  log(`\n🔍 Search results for "${query}":`);
  sessions.forEach((session, index) => {
    log(`${index + 1}. ${session.title} (${session.id}) - ${session.messageCount} messages`);
    log(`   Updated: ${new Date(session.updatedAt).toLocaleString()}`);
    log(`   Preview: ${session.preview}`);
  });
}
