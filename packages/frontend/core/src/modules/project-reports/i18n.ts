import { useTranslation } from '@affine/i18n';
import { useCallback } from 'react';

export function useReportText() {
  const { t } = useTranslation();
  return useCallback(
    (key: string) => t(`com.affine.localmind.reports.${key}`),
    [t]
  );
}
