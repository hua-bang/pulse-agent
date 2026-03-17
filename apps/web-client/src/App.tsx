import { useState } from 'react';
import { KeySetup } from './components/KeySetup';
import { ChatView } from './components/ChatView';

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode / quota — ignore */ }
}

function storageRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (plain HTTP)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Persist a random userId for this browser */
function getUserId(): string {
  let id = storageGet('web_user_id');
  if (!id) {
    id = generateId();
    storageSet('web_user_id', id);
  }
  return id;
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => storageGet('web_api_key') ?? '');
  const userId = getUserId();

  function handleKeySet(key: string) {
    setApiKey(key);
  }

  function handleKeyInvalid() {
    storageRemove('web_api_key');
    setApiKey('');
  }

  if (!apiKey) {
    return <KeySetup onKeySet={handleKeySet} />;
  }

  return (
    <ChatView
      apiKey={apiKey}
      userId={userId}
      onKeyInvalid={handleKeyInvalid}
    />
  );
}

