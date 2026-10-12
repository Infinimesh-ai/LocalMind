import { useI18n } from '@affine/i18n';

import { link } from './blocks.css';

export const BlogLink = () => {
  const t = useI18n();
  return (
    <a className={link} href={`${BUILD_CONFIG.githubUrl}/tree/main/docs`}>
      {t['com.affine.onboarding.more-articles']()}
    </a>
  );
};
