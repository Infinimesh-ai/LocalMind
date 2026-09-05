import type { DocumentScopeAccess } from '@affine/core/modules/workspace-engine';

export const resolveDocumentScopeAccess = (
  searchParams: URLSearchParams,
  routeDocId: string
): DocumentScopeAccess | null => {
  if (searchParams.get('docScope') !== routeDocId) {
    return null;
  }

  const access = searchParams.get('access');
  return access === 'read' || access === 'write' ? access : null;
};
