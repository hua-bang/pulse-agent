import { useState } from 'react';
import { KeySetup } from './components/KeySetup';
import { ChatView } from './components/ChatView';

/** Persist a random userId for this browser */
function getUserId(): string {
  let id = localStorage.getItem('web_user_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('web_user_id', id);
  }
  return id;
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('web_api_key') ?? '');
  const userId = getUserId();

  function handleKeySet(key: string) {
    setApiKey(key);
  }

  function handleKeyInvalid() {
    localStorage.removeItem('web_api_key');
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
