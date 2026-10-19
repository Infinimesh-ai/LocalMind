import { getNewReportDeckPath } from '@affine/core/desktop/route-paths';
import { useDeckText } from '@affine/core/modules/report-decks/i18n';
import { PlusIcon } from '@blocksuite/icons/rc';
import { useNavigate } from 'react-router-dom';

import { HistoryList } from './history-list';
import * as styles from './report-decks.css';
import { TemplateGallery, useGalleryTemplates } from './template-gallery';

export function newDeckWithTemplate(templateKey: string) {
  return `${getNewReportDeckPath()}?${new URLSearchParams({ template: templateKey })}`;
}

export function ReportDecksHome() {
  const t = useDeckText();
  const navigate = useNavigate();
  const { templates } = useGalleryTemplates();
  const create = () => navigate(getNewReportDeckPath());
  return (
    <div className={styles.scroll}>
      <div className={styles.container}>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>
              <span className={styles.brandDot} aria-hidden="true" />
              {t('home.eyebrow')}
            </p>
            <h1 className={styles.pageTitle}>{t('home.title')}</h1>
            <p className={styles.pageLead}>{t('home.subtitle')}</p>
          </div>
          <button
            type="button"
            className={`${styles.primaryButton} ${styles.largeButton}`}
            onClick={create}
          >
            <PlusIcon />
            {t('home.create')}
          </button>
        </header>
        <section className={styles.section} aria-labelledby="deck-history">
          <div className={styles.sectionHead}>
            <h2 id="deck-history" className={styles.sectionTitle}>
              {t('history.title')}
            </h2>
            <span className={styles.sectionCount}>{t('history.hint')}</span>
          </div>
          <HistoryList onCreate={create} />
        </section>
        <section className={styles.section} aria-labelledby="deck-templates">
          <div className={styles.sectionHead}>
            <h2 id="deck-templates" className={styles.sectionTitle}>
              {t('gallery.title')}
            </h2>
            <span className={styles.sectionCount}>
              {t('gallery.count', { count: templates.length })}
            </span>
          </div>
          <TemplateGallery onUse={key => navigate(newDeckWithTemplate(key))} />
        </section>
      </div>
    </div>
  );
}
