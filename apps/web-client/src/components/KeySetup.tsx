import { useState } from 'react';
import './KeySetup.css';

interface Props {
  onKeySet: (key: string) => void;
}

export function KeySetup({ onKeySet }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const key = value.trim();
    if (!key) {
      setError('请输入 API Key');
      return;
    }
    try { localStorage.setItem('web_api_key', key); } catch { /* ignore */ }
    onKeySet(key);
  }

  return (
    <div className="key-setup">
      <div className="key-setup__card">
        <div className="key-setup__icon">⚡</div>
        <h1 className="key-setup__title">Pulse Coder</h1>
        <p className="key-setup__desc">输入 API Key 开始对话</p>

        <form className="key-setup__form" onSubmit={handleSubmit}>
          <input
            className="key-setup__input"
            type="password"
            placeholder="sk-..."
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError('');
            }}
            autoFocus
            autoComplete="off"
          />
          {error && <p className="key-setup__error">{error}</p>}
          <button className="key-setup__btn" type="submit">
            连接
          </button>
        </form>
      </div>
    </div>
  );
}
