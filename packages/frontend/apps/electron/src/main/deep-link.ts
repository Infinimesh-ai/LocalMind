import path from 'node:path';

import type { App } from 'electron';

import {
  getDeepLinkNavigationMode,
  getDeepLinkSchemes,
  isSupportedDeepLink,
} from '../shared/deep-link';
import { buildType, isDev } from './config';
import { logger } from './logger';
import { uiSubjects } from './ui';
import {
  addTabWithUrl,
  loadUrlInActiveTab,
  openUrlInHiddenWindow,
  showMainWindow,
} from './windows-manager';

const { supported: protocols } = getDeepLinkSchemes(buildType, isDev);

const authMethods = new Set(['magic-link', 'oauth', 'open-app-signin']);

function summarizeDeepLink(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const method = url.searchParams.get('method');
    const server = url.searchParams.get('server');
    let serverOrigin: string | undefined;
    try {
      serverOrigin = server ? new URL(server).origin : undefined;
    } catch {
      serverOrigin = undefined;
    }
    return {
      protocol: url.protocol,
      action: url.hostname,
      method: method && authMethods.has(method) ? method : undefined,
      serverOrigin,
    };
  } catch {
    return { valid: false };
  }
}

function logDeepLinkFailure(rawUrl: string, error: unknown) {
  logger.error('failed to handle LocalMind URL', summarizeDeepLink(rawUrl), {
    error: error instanceof Error ? error.name : typeof error,
  });
}

export function setupDeepLink(app: App) {
  for (const protocol of protocols) {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(protocol, process.execPath, [
          path.resolve(process.argv[1]),
        ]);
      }
    } else {
      app.setAsDefaultProtocolClient(protocol);
    }
  }

  app.on('open-url', (event, url) => {
    logger.log('open-url', summarizeDeepLink(url));
    if (isSupportedDeepLink(url, protocols)) {
      event.preventDefault();
      app
        .whenReady()
        .then(() => handleDeepLink(url))
        .catch(e => {
          logDeepLinkFailure(url, e);
        });
    }
  });

  // on windows & linux, we need to listen for the second-instance event
  app.on('second-instance', (event, commandLine) => {
    showMainWindow()
      .then(() => {
        const url = commandLine.pop();
        if (url && isSupportedDeepLink(url, protocols)) {
          event.preventDefault();
          handleDeepLink(url).catch(e => {
            logDeepLinkFailure(url, e);
          });
        }
      })
      .catch(e => console.error('Failed to restore or create window:', e));
  });

  app.on('ready', () => {
    // app may be brought up without having a running instance
    // need to read the url from the command line
    const url = process.argv.at(-1);
    logger.log(
      'url from argv',
      url && isSupportedDeepLink(url, protocols)
        ? summarizeDeepLink(url)
        : { deepLink: false, argumentCount: process.argv.length }
    );
    if (url && isSupportedDeepLink(url, protocols)) {
      handleDeepLink(url).catch(e => {
        logDeepLinkFailure(url, e);
      });
    }
  });
}

async function handleDeepLink(url: string) {
  await showMainWindow();

  logger.info('open LocalMind URL', summarizeDeepLink(url));
  const urlObj = new URL(url);
  const navigationMode = getDeepLinkNavigationMode(url);

  if (navigationMode === 'authentication') {
    const method = urlObj.searchParams.get('method');
    const payload = JSON.parse(urlObj.searchParams.get('payload') ?? 'false');
    const server = urlObj.searchParams.get('server') || undefined;

    if (
      !method ||
      (method !== 'magic-link' &&
        method !== 'oauth' &&
        method !== 'open-app-signin') ||
      !payload
    ) {
      logger.error('Invalid authentication url', summarizeDeepLink(url));
      return;
    }

    uiSubjects.authenticationRequest$.next({
      method,
      payload,
      server,
    });
  } else if (navigationMode === 'new-tab') {
    await addTabWithUrl(url);
  } else if (navigationMode === 'hidden-window') {
    const hiddenWindow = await openUrlInHiddenWindow(urlObj);
    if (hiddenWindow) {
      // when hidden window closed, the main window will be hidden somehow
      hiddenWindow.on('close', () => {
        void showMainWindow().catch(e => {
          logger.error('Failed to restore main window:', e);
        });
      });
    }
  } else if (navigationMode === 'active-tab') {
    await loadUrlInActiveTab(url);
  }
}
