import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import './RouteErrorBoundary.css';

interface BoundaryProps {
  /** Route name for the console log. */
  route: string;
  children: ReactNode;
}

interface BoundaryState {
  failed: boolean;
  attempt: number;
}

/**
 * Contains a render error to one route view. Without it, an error on the
 * settings, chat, or plugins page unmounted the whole app and left a blank
 * window. The rail and other routes stay usable; Try again remounts the
 * route, and Reload window restarts the renderer.
 *
 * Same shape as the canvas's `CanvasErrorBoundary`, which stays in its module.
 */
export class RouteErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[app] render failed in route ${this.props.route}`, error, info.componentStack);
  }

  private readonly retry = () => {
    this.setState((state) => ({ failed: false, attempt: state.attempt + 1 }));
  };

  render() {
    if (this.state.failed) return <RouteErrorFallback onRetry={this.retry} />;
    return <RouteAttempt key={this.state.attempt}>{this.props.children}</RouteAttempt>;
  }
}

const RouteAttempt = ({ children }: { children: ReactNode }) => <>{children}</>;

const RouteErrorFallback = ({ onRetry }: { onRetry: () => void }) => {
  const { t } = useI18n();
  return (
    <div className="route-error-fallback" role="alert">
      <h2 className="route-error-fallback__title">{t('shell.routeError.title')}</h2>
      <p className="route-error-fallback__message">{t('shell.routeError.message')}</p>
      <div className="route-error-fallback__actions">
        <Button variant="primary" size="sm" onClick={onRetry}>
          {t('shell.routeError.retry')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
          {t('shell.routeError.reload')}
        </Button>
      </div>
    </div>
  );
};
