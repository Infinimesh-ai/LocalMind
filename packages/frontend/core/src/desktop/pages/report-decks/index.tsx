import { Button } from '@affine/component';
import { GlobalRail } from '@affine/core/components/global-rail';
import { SWRConfigProvider } from '@affine/core/components/providers/swr-config-provider';
import { AppTabsHeader } from '@affine/core/modules/app-tabs-header';
import { DefaultServerService } from '@affine/core/modules/cloud';
import { GlobalDialogService } from '@affine/core/modules/dialogs';
import { useDeckText } from '@affine/core/modules/report-decks/i18n';
import { LockIcon } from '@blocksuite/icons/rc';
import { FrameworkScope, useLiveData, useService } from '@toeverything/infra';
import type { ReactNode } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import { DeckConfigPage } from './config-page';
import { DeckPresent, DeckViewer } from './deck-viewer';
import { ReportDecksHome } from './home';
import * as styles from './report-decks.css';

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <GlobalRail active="reports" />
      <div className={styles.page}>
        {BUILD_CONFIG.isElectron && <AppTabsHeader />}
        {children}
      </div>
    </div>
  );
}

function ReportDecksRoute() {
  const { deckId } = useParams();
  const location = useLocation();
  if (deckId && location.pathname.endsWith('/present'))
    return <DeckPresent deckId={deckId} />;
  return (
    <Shell>
      {deckId ? (
        <DeckViewer key={deckId} deckId={deckId} />
      ) : location.pathname.replace(/\/+$/, '').endsWith('/new') ? (
        <DeckConfigPage key={location.search} />
      ) : (
        <ReportDecksHome />
      )}
    </Shell>
  );
}

function SignInRequired() {
  const t = useDeckText();
  const dialogs = useService(GlobalDialogService);
  return (
    <Shell>
      <div className={styles.viewerCanvas} style={{ flex: 1 }}>
        <div className={styles.gate} role="alert">
          <span className={styles.gateGlyph} aria-hidden="true">
            <LockIcon />
          </span>
          <h1>{t('signIn.title')}</h1>
          <p>{t('signIn.description')}</p>
          <Button variant="primary" onClick={() => dialogs.open('sign-in', {})}>
            {t('signIn.action')}
          </Button>
        </div>
      </div>
    </Shell>
  );
}

export function Component() {
  const server = useService(DefaultServerService).server;
  const account = useLiveData(server?.account$);
  return (
    <FrameworkScope scope={server?.scope}>
      <SWRConfigProvider key={`${server?.id ?? ''}:${account?.id ?? ''}`}>
        {account === null ? <SignInRequired /> : <ReportDecksRoute />}
      </SWRConfigProvider>
    </FrameworkScope>
  );
}
