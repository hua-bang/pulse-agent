import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', padding: '24px',
          background: '#0f0f0f', color: '#e8e8e8', textAlign: 'center', gap: '12px',
        }}>
          <div style={{ fontSize: '36px' }}>⚡</div>
          <p style={{ fontSize: '16px', fontWeight: 600 }}>页面加载出错</p>
          <p style={{ fontSize: '13px', color: '#666', maxWidth: '280px' }}>
            {this.state.error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '8px', background: '#7c6aff', color: '#fff',
              border: 'none', borderRadius: '8px', padding: '10px 20px',
              fontSize: '14px', cursor: 'pointer',
            }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
