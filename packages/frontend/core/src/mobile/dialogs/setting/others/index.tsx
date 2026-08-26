import { useI18n } from '@affine/i18n';

import { SettingGroup } from '../group';
import { RowLayout } from '../row.layout';
import { DeleteAccount } from './delete-account';

export const OthersGroup = () => {
  const t = useI18n();

  return (
    <SettingGroup title={t['com.affine.mobile.setting.others.title']()}>
      <RowLayout
        label={t['com.affine.mobile.setting.others.github']()}
        href={BUILD_CONFIG.githubUrl}
      />

      <RowLayout
        label={t['com.affine.mobile.setting.others.website']()}
        href={BUILD_CONFIG.githubUrl}
      />

      {BUILD_CONFIG.privacyUrl ? (
        <RowLayout
          label={t['com.affine.mobile.setting.others.privacy']()}
          href={BUILD_CONFIG.privacyUrl}
        />
      ) : null}

      {BUILD_CONFIG.termsUrl ? (
        <RowLayout
          label={t['com.affine.mobile.setting.others.terms']()}
          href={BUILD_CONFIG.termsUrl}
        />
      ) : null}
      <DeleteAccount />
    </SettingGroup>
  );
};
