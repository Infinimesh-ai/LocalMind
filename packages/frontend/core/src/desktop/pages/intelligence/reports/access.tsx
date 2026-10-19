import { PageNotFound } from '@affine/core/desktop/pages/404';

/** Same "no access / back to my content / switch account" page as documents. */
export function ReportAccessDenied() {
  return <PageNotFound noPermission />;
}
