import { useI18n } from '@affine/i18n';
import { SignOutIcon } from '@blocksuite/icons/rc';
import type { JSX } from 'react';

import { Avatar } from '../../ui/avatar';
import { Button, IconButton } from '../../ui/button';
import { ThemedImg } from '../../ui/themed-img';
import { AffineOtherPageLayout } from '../affine-other-page-layout';
import illustrationDark from '../affine-other-page-layout/assets/other-page.dark.png';
import illustrationLight from '../affine-other-page-layout/assets/other-page.light.png';
import type { User } from '../auth-components';
import {
  illustration,
  info,
  largeButtonEffect,
  notFoundPageContainer,
  wrapper,
} from './styles.css';

export interface NotFoundPageProps {
  user?: User | null;
  signInComponent?: JSX.Element;
  onBack: () => void;
  onSignOut: () => void;
  requestAccess?: {
    pending: boolean;
    requested: boolean;
    onRequest: () => void;
  };
}
export const NoPermissionOrNotFound = ({
  user,
  onBack,
  onSignOut,
  signInComponent,
  requestAccess,
}: NotFoundPageProps) => {
  const t = useI18n();

  return (
    <AffineOtherPageLayout>
      <div className={notFoundPageContainer} data-testid="not-found">
        {user ? (
          <>
            <div className={info}>
              <p className={wrapper}>{t['404.hint']()}</p>
              <div className={wrapper}>
                <Button
                  variant="primary"
                  size="extraLarge"
                  onClick={onBack}
                  className={largeButtonEffect}
                >
                  {t['404.back']()}
                </Button>
                {requestAccess ? (
                  <Button
                    variant="secondary"
                    size="extraLarge"
                    disabled={requestAccess.pending || requestAccess.requested}
                    loading={requestAccess.pending}
                    onClick={requestAccess.onRequest}
                    className={largeButtonEffect}
                  >
                    {requestAccess.requested
                      ? t['com.affine.localmind.accessRequest.requested']()
                      : t['com.affine.localmind.accessRequest.request']()}
                  </Button>
                ) : null}
              </div>
              <div className={wrapper}>
                <Avatar url={user.avatar ?? user.image} name={user.label} />
                <span style={{ margin: '0 12px' }}>{user.email}</span>
                <IconButton
                  onClick={onSignOut}
                  size="20"
                  tooltip={t['404.signOut']()}
                >
                  <SignOutIcon />
                </IconButton>
              </div>
            </div>
            <div className={wrapper}>
              <ThemedImg
                draggable={false}
                className={illustration}
                lightSrc={illustrationLight}
                darkSrc={illustrationDark}
              />
            </div>
          </>
        ) : (
          signInComponent
        )}
      </div>
    </AffineOtherPageLayout>
  );
};

export const NotFoundPage = ({
  user,
  onBack,
  onSignOut,
}: NotFoundPageProps) => {
  const t = useI18n();

  return (
    <AffineOtherPageLayout>
      <div className={notFoundPageContainer} data-testid="not-found">
        <div className={info}>
          <p className={wrapper}>{t['404.hint']()}</p>
          <div className={wrapper}>
            <Button
              variant="primary"
              size="extraLarge"
              onClick={onBack}
              className={largeButtonEffect}
            >
              {t['404.back']()}
            </Button>
          </div>
          {user ? (
            <div className={wrapper}>
              <Avatar url={user.avatar ?? user.image} name={user.label} />
              <span style={{ margin: '0 12px' }}>{user.email}</span>
              <IconButton
                onClick={onSignOut}
                size="20"
                tooltip={t['404.signOut']()}
              >
                <SignOutIcon />
              </IconButton>
            </div>
          ) : null}
        </div>
        <div className={wrapper}>
          <ThemedImg
            draggable={false}
            className={illustration}
            lightSrc={illustrationLight}
            darkSrc={illustrationDark}
          />
        </div>
      </div>
    </AffineOtherPageLayout>
  );
};
