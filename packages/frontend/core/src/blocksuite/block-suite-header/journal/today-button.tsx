import { Button } from '@affine/component';
import { useCatchEventCallback } from '@affine/core/components/hooks/use-catch-event-hook';
import { useJournalRouteHelper } from '@affine/core/components/hooks/use-journal';
import { useI18n } from '@affine/i18n';

export const JournalTodayButton = () => {
  const t = useI18n();
  const journalHelper = useJournalRouteHelper();

  const onToday = useCatchEventCallback(async () => {
    await journalHelper.openToday({ replaceHistory: true });
  }, [journalHelper]);

  return (
    <Button
      size="default"
      onClick={onToday}
      style={{ height: 32, padding: '0px 8px' }}
    >
      {t['com.affine.today']()}
    </Button>
  );
};
