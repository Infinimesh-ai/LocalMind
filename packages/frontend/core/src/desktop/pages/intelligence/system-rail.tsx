import {
  GlobalRail,
  type GlobalRailProps,
} from '@affine/core/components/global-rail';

export { lastWorkspaceId } from '@affine/core/components/global-rail';

/**
 * v10 system rail, kept for existing callers. The rail itself now lives in
 * `components/global-rail` and is shared with the workspace and report pages.
 */
export function SystemRail({
  documentsView,
  ...props
}: Omit<GlobalRailProps, 'active'> & {
  /** Legacy override; the rail otherwise derives the active item from the URL. */
  documentsView?: boolean;
}) {
  return (
    <GlobalRail
      {...props}
      active={
        documentsView === undefined
          ? undefined
          : documentsView
            ? 'docs'
            : 'projects'
      }
    />
  );
}
