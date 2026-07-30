const setScope = (scope: string) =>
  document.body.setAttribute(`data-${scope}`, '');
const rmScope = (scope: string) =>
  document.body.removeAttribute(`data-${scope}`);

type ViewTransitionCallback = () => Promise<void> | void;

export interface SafeViewTransition {
  readonly finished: Promise<void>;
}

const isAbortError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  error.name === 'AbortError';

const createErrorReporter = (name?: string) => {
  const reported = new Set<unknown>();

  return (error: unknown) => {
    if (isAbortError(error) || reported.has(error)) return;
    reported.add(error);
    console.error(`View transition${name ? `[${name}]` : ''} failed:`, error);
  };
};

const runWithoutTransition = (
  cb: ViewTransitionCallback,
  reportError: (error: unknown) => void
) => {
  try {
    Promise.resolve(cb()).catch(reportError);
  } catch (error) {
    reportError(error);
  }
};

/**
 * Starts a view transition while consuming every transition promise.
 *
 * Browsers reject `ready` with an AbortError when a transition is superseded.
 * That is expected control flow and must not reach the development error
 * overlay.
 */
export function startSafeViewTransition(
  cb: ViewTransitionCallback,
  options?: { name?: string }
): SafeViewTransition | undefined {
  if (typeof document === 'undefined') return;

  const reportError = createErrorReporter(options?.name);
  if (typeof document.startViewTransition !== 'function') {
    runWithoutTransition(cb, reportError);
    return;
  }

  try {
    const transition = document.startViewTransition(cb);
    transition.ready.catch(reportError);
    transition.updateCallbackDone.catch(reportError);
    transition.finished.catch(reportError);
    return transition;
  } catch (error) {
    reportError(error);
    runWithoutTransition(cb, reportError);
    return;
  }
}

/**
 * A wrapper around `document.startViewTransition` that adds a scope attribute to the body element.
 */
export function startScopedViewTransition(
  scope: string | string[],
  cb: ViewTransitionCallback,
  options?: { timeout?: number }
) {
  if (typeof document === 'undefined') return;

  const scopes = Array.isArray(scope) ? scope : [scope];
  const timeout = options?.timeout ?? 2000;

  scopes.forEach(setScope);

  const transition = startSafeViewTransition(cb, {
    name: scopes.join(','),
  });
  if (!transition) {
    scopes.forEach(rmScope);
    return;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error('View transition timeout')),
      timeout
    );
  });

  Promise.race([transition.finished.catch(() => undefined), timeoutPromise])
    .catch(error =>
      console.error(`View transition[${scopes.join(',')}] failed:`, error)
    )
    .finally(() => {
      clearTimeout(timeoutId);
      scopes.forEach(rmScope);
    });
}

export function vtScopeSelector(scope: string) {
  return `[data-${scope}]`;
}
