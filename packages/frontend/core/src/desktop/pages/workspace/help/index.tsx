import { Button, IconButton } from '@affine/component';
import { NavigateContext } from '@affine/core/components/hooks/use-navigate-helper';
import { Header } from '@affine/core/components/pure/header';
import { WorkspaceDialogService } from '@affine/core/modules/dialogs';
import {
  ViewBody,
  ViewHeader,
  ViewIcon,
  ViewTitle,
} from '@affine/core/modules/workbench';
import { useI18n, useTranslation } from '@affine/i18n';
import {
  AiOutlineIcon,
  CloseIcon,
  HelpIcon,
  SearchIcon,
  SettingsIcon,
} from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { useCallback, useContext, useId, useMemo, useState } from 'react';

import { createGuideSections, filterGuideSections } from './content';
import * as styles from './index.css';

export { filterGuideSections } from './content';

export const HelpCenterPage = () => {
  const i18n = useI18n();
  const { t } = useTranslation();
  const navigate = useContext(NavigateContext);
  const dialogs = useService(WorkspaceDialogService);
  const viewId = useId().replace(/:/g, '');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(['start-first'])
  );
  const allSections = useMemo(() => createGuideSections(t), [t]);
  const sections = useMemo(
    () => filterGuideSections(allSections, query),
    [allSections, query]
  );
  const searching = Boolean(query.trim());
  const resultCount = sections.reduce(
    (count, section) => count + section.articles.length,
    0
  );
  const text = (key: string, params?: Record<string, string | number>) =>
    t(`com.affine.localmind.help.guide.${key}`, params);
  const openProjects = useCallback(() => {
    if (navigate) void navigate('/project');
    else window.location.assign('/project');
  }, [navigate]);

  return (
    <>
      <ViewTitle title={i18n['com.affine.localmind.help.pageTitle']()} />
      <ViewIcon icon="ai" />
      <ViewHeader>
        <Header
          left={
            <div className={styles.headerTitle}>
              <HelpIcon />
              <span>{i18n['com.affine.localmind.help.title']()}</span>
            </div>
          }
        />
      </ViewHeader>
      <ViewBody>
        <div className={styles.root}>
          <main className={styles.page}>
            <div className={styles.intro}>
              <h1>{i18n['com.affine.localmind.help.pageTitle']()}</h1>
              <p>{text('intro')}</p>
              <div className={styles.toolbar}>
                <div className={styles.search}>
                  <SearchIcon />
                  <label
                    className={styles.visuallyHidden}
                    htmlFor={`${viewId}-search`}
                  >
                    {text('search')}
                  </label>
                  <input
                    id={`${viewId}-search`}
                    type="search"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder={text('search')}
                    aria-controls={`${viewId}-content`}
                  />
                  {query ? (
                    <IconButton
                      size="20"
                      title={i18n['com.affine.localmind.help.search.clear']()}
                      icon={<CloseIcon />}
                      onClick={() => setQuery('')}
                    />
                  ) : null}
                </div>
                <Button prefix={<AiOutlineIcon />} onClick={openProjects}>
                  {i18n['com.affine.localmind.workbench.systemRail.projects']()}
                </Button>
                <Button
                  prefix={<SettingsIcon />}
                  onClick={() =>
                    dialogs.open('setting', {
                      activeTab: 'workspace:ai-context',
                    })
                  }
                >
                  {i18n['com.affine.localmind.help.manageContext']()}
                </Button>
              </div>
              <p className={styles.availability}>{text('availability')}</p>
            </div>
            <div className={styles.layout}>
              <nav
                className={styles.toc}
                aria-label={i18n['com.affine.localmind.help.toc.label']()}
              >
                <div className={styles.tocLabel}>
                  {i18n['com.affine.localmind.help.toc.title']()}
                </div>
                {sections.map(section => (
                  <a href={`#${viewId}-${section.id}`} key={section.id}>
                    {section.title}
                  </a>
                ))}
              </nav>
              <div className={styles.content} id={`${viewId}-content`}>
                <div role="status" className={styles.resultStatus}>
                  {searching ? text('results', { count: resultCount }) : ''}
                </div>
                {sections.map(section => (
                  <section
                    id={`${viewId}-${section.id}`}
                    className={styles.section}
                    data-testid={`guide-section-${section.id}`}
                    key={section.id}
                    aria-labelledby={`${viewId}-${section.id}-title`}
                  >
                    <h2 id={`${viewId}-${section.id}-title`}>
                      {section.title}
                    </h2>
                    <p className={styles.sectionDescription}>
                      {section.description}
                    </p>
                    {section.articles.map(article => (
                      <details
                        key={`${article.id}-${searching}`}
                        className={styles.article}
                        open={searching || expanded.has(article.id)}
                        data-testid={`guide-article-${article.id}`}
                        onToggle={event => {
                          if (searching) return;
                          const open = event.currentTarget.open;
                          setExpanded(previous => {
                            if (previous.has(article.id) === open)
                              return previous;
                            const next = new Set(previous);
                            if (open) next.add(article.id);
                            else next.delete(article.id);
                            return next;
                          });
                        }}
                      >
                        <summary>{article.title}</summary>
                        <div className={styles.articleBody}>
                          <p>{article.description}</p>
                          <ol>
                            {article.steps.map((step, index) => (
                              <li key={index}>{step}</li>
                            ))}
                          </ol>
                          <p>
                            <strong>{text('result')}</strong> {article.result}
                          </p>
                          <p className={styles.note}>{article.note}</p>
                        </div>
                      </details>
                    ))}
                  </section>
                ))}
                {!sections.length ? (
                  <div className={styles.empty}>
                    <SearchIcon />
                    <h2>{i18n['com.affine.localmind.help.empty.title']()}</h2>
                    <p>{text('empty')}</p>
                    <Button onClick={() => setQuery('')}>
                      {i18n['com.affine.localmind.help.search.clear']()}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </main>
        </div>
      </ViewBody>
    </>
  );
};

export const Component = HelpCenterPage;
