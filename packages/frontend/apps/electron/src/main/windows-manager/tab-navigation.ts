import {
  joinAppRoutePathname,
  parseAppRouteLocation,
} from '../../shared/deep-link';

type RoutePath = {
  pathname?: string;
  search?: string;
  hash?: string;
};

type RouteViewMeta = {
  path?: RoutePath;
};

type ActiveWorkbench<TView extends RouteViewMeta> = {
  activeViewIndex: number;
  views: TView[];
};

type LoadedView = {
  webContents: {
    loadURL: (url: string) => Promise<unknown>;
  };
};

export async function navigateUrlInActiveTab<
  TView extends RouteViewMeta,
>(input: {
  url: string;
  mainWindowOrigin: string;
  activeWorkbenchId?: string;
  activeWorkbench?: ActiveWorkbench<TView>;
  getActiveWorkbenchView: () => LoadedView | undefined;
  updateWorkbench: (
    id: string,
    patch: {
      basename: string;
      activeViewIndex: number;
      views: TView[];
    }
  ) => void;
  showTab: (id: string) => Promise<unknown>;
  addTabWithUrl: (url: string) => Promise<unknown>;
}) {
  const location = parseAppRouteLocation(input.url);
  const activeViewMeta =
    input.activeWorkbench?.views[input.activeWorkbench.activeViewIndex];

  if (!input.activeWorkbenchId || !input.activeWorkbench || !activeViewMeta) {
    await input.addTabWithUrl(input.url);
    return;
  }

  input.updateWorkbench(input.activeWorkbenchId, {
    basename: location.basename,
    activeViewIndex: 0,
    views: [
      {
        ...activeViewMeta,
        path: {
          pathname: location.pathname,
          search: location.search,
          hash: location.hash,
        },
      },
    ],
  });

  const activeView = input.getActiveWorkbenchView();
  if (!activeView) {
    await input.showTab(input.activeWorkbenchId);
    return;
  }

  const internalUrl = new URL(
    joinAppRoutePathname(location.basename, location.pathname),
    input.mainWindowOrigin
  );
  internalUrl.search = location.search;
  internalUrl.hash = location.hash;
  await activeView.webContents.loadURL(internalUrl.href);
}
