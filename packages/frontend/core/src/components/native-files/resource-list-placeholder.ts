export type ResourceListPlaceholder = 'loading' | 'error' | 'empty';

/**
 * What an empty resource list shows. Candidates still waiting for their ACL
 * check are not "no resources": the list is loading, or failed and retryable.
 */
export function resourceListPlaceholder(state: {
  catalogLoading: boolean;
  catalogReady: boolean;
  catalogError: boolean;
  queryLoading: boolean;
  queryError: boolean;
  folderError: boolean;
  docsPending: boolean;
  checkingReadable: boolean;
  readableCheckFailed: boolean;
}): ResourceListPlaceholder {
  if (
    state.catalogLoading ||
    state.queryLoading ||
    state.checkingReadable ||
    (!state.catalogReady && !state.catalogError) ||
    state.docsPending
  ) {
    return 'loading';
  }
  if (
    state.catalogError ||
    state.queryError ||
    state.folderError ||
    state.readableCheckFailed
  ) {
    return 'error';
  }
  return 'empty';
}
