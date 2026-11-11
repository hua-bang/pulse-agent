import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../../../../../components/ui';
import { useI18n } from '../../../../../i18n';
import './index.css';

interface BoundaryProps {
  /** Short label for the console log, such as `node:abc` or `canvas`. */
  scope: string;
  /** Renders the fallback. `retry` remounts the children. */
  fallback: (retry: () => void) => ReactNode;
  children: ReactNode;
}

interface BoundaryState {
  failed: boolean;
  attempt: number;
}

/**
 * Contains a render error to the subtree it wraps. A node that throws must
 * not unmount the whole canvas, and a canvas that throws must not unmount
 * the app shell. Retry remounts the children with a new key.
 */
export class CanvasErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[canvas] render failed in ${this.props.scope}`, error, info.componentStack);
  }

  private readonly retry = () => {
    this.setState(state => ({ failed: false, attempt: state.attempt + 1 }));
  };

  render() {
    if (this.state.failed) return this.props.fallback(this.retry);
    return <ErrorBoundaryAttempt key={this.state.attempt}>{this.props.children}</ErrorBoundaryAttempt>;
  }
}

const ErrorBoundaryAttempt = ({ children }: { children: ReactNode }) => <>{children}</>;

interface FallbackProps {
  message: string;
  onRetry: () => void;
  onRemove?: () => void;
}

const FallbackContent = ({ message, onRetry, onRemove }: FallbackProps) => {
  const { t } = useI18n();
  return (
    <div className="canvas-error-fallback__content" role="alert">
      <span className="canvas-error-fallback__message">{message}</span>
      <span className="canvas-error-fallback__actions">
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('canvas.renderError.retry')}
        </Button>
        {onRemove && (
          <Button variant="danger" size="sm" onClick={onRemove}>
            {t('canvas.renderError.remove')}
          </Button>
        )}
      </span>
    </div>
  );
};

/** Fills a node body whose content failed; the node frame stays usable. */
export const NodeBodyErrorFallback = ({ onRetry }: { onRetry: () => void }) => {
  const { t } = useI18n();
  return (
    <div className="canvas-error-fallback canvas-error-fallback--body">
      <FallbackContent message={t('canvas.renderError.node')} onRetry={onRetry} />
    </div>
  );
};

/** Stands in for a whole node at its stored position and size. */
export const NodeErrorFallback = ({
  title,
  style,
  onRetry,
  onRemove,
}: {
  title: string;
  style: CSSProperties;
  onRetry: () => void;
  onRemove?: () => void;
}) => {
  const { t } = useI18n();
  return (
    <div
      className="canvas-node canvas-error-fallback canvas-error-fallback--node"
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <span className="canvas-error-fallback__title">{title}</span>
      <FallbackContent
        message={t('canvas.renderError.node')}
        onRetry={onRetry}
        onRemove={onRemove}
      />
    </div>
  );
};

/** Replaces the canvas surface when the canvas itself failed to render. */
export const CanvasRootErrorFallback = ({ onRetry }: { onRetry: () => void }) => {
  const { t } = useI18n();
  return (
    <div className="canvas-error-fallback canvas-error-fallback--root">
      <FallbackContent message={t('canvas.renderError.canvas')} onRetry={onRetry} />
    </div>
  );
};
