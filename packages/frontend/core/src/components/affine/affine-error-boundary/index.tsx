import { DebugLogger } from '@affine/debug';
import type { ErrorInfo, FC, PropsWithChildren, ReactNode } from 'react';
import { Component, useCallback } from 'react';

import { AffineErrorFallback } from './affine-error-fallback';

export { type FallbackProps } from './error-basic/fallback-creator';

export interface AffineErrorBoundaryProps extends PropsWithChildren {
  height?: number | string;
  className?: string;
}

type BoundaryState = { error: unknown | null };
const logger = new DebugLogger('error-boundary');

class LocalErrorBoundary extends Component<
  AffineErrorBoundaryProps & {
    fallbackRender: (props: {
      error: unknown;
      resetError: () => void;
    }) => ReactNode;
    onError: (error: unknown, componentStack?: string) => void;
  },
  BoundaryState
> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    this.props.onError(error, info.componentStack ?? undefined);
  }

  override render() {
    if (this.state.error) {
      return this.props.fallbackRender({
        error: this.state.error,
        resetError: () => this.setState({ error: null }),
      });
    }
    return this.props.children;
  }
}

/**
 * TODO(@eyhn): Unify with SWRErrorBoundary
 */
export const AffineErrorBoundary: FC<AffineErrorBoundaryProps> = props => {
  const fallbackRender = useCallback(
    (fallbackProps: { error: unknown; resetError: () => void }) => {
      return (
        <AffineErrorFallback
          {...fallbackProps}
          height={props.height}
          className={props.className}
        />
      );
    },
    [props.height, props.className]
  );

  const onError = useCallback((error: unknown, componentStack?: string) => {
    logger.error('Uncaught error', { error, componentStack });
  }, []);

  return (
    <LocalErrorBoundary fallbackRender={fallbackRender} onError={onError}>
      {props.children}
    </LocalErrorBoundary>
  );
};
