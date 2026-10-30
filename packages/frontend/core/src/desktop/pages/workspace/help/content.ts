// User and administrator articles share this static table of contents and the
// existing i18n resources. Reading help must never query admin data or secrets.
export const GUIDE_SECTIONS = [
  {
    id: 'start',
    articles: [
      'first',
      'organize',
      'page',
      'docs',
      'sheets',
      'slides',
      'pdf',
      'files',
      'trash',
    ],
  },
  { id: 'ai', articles: ['chat', 'updates', 'memory', 'office'] },
  {
    id: 'projects',
    articles: ['create', 'resources', 'exchange', 'orders', 'notifications'],
  },
  { id: 'reports', articles: ['generate', 'present'] },
  {
    id: 'admin',
    articles: [
      'access',
      'accounts',
      'settings',
      'mail',
      'storage',
      'workspace-ai',
      'project-ai',
      'retrieval',
      'integrations',
      'runtime',
      'logs',
    ],
  },
  { id: 'troubleshooting', articles: ['missing', 'save', 'models', 'tasks'] },
] as const;

export type GuideArticle = {
  id: string;
  title: string;
  description: string;
  steps: string[];
  result: string;
  note: string;
};
export type GuideSection = {
  id: string;
  title: string;
  description: string;
  articles: GuideArticle[];
};

export function createGuideSections(
  t: (key: string) => string
): GuideSection[] {
  return GUIDE_SECTIONS.map(section => {
    const prefix = `com.affine.localmind.help.guide.${section.id}`;
    return {
      id: section.id,
      title: t(`${prefix}.title`),
      description: t(`${prefix}.description`),
      articles: section.articles.map(id => ({
        id: `${section.id}-${id}`,
        title: t(`${prefix}.${id}.title`),
        description: t(`${prefix}.${id}.description`),
        steps: [1, 2, 3].map(step => t(`${prefix}.${id}.step${step}`)),
        result: t(`${prefix}.${id}.result`),
        note: t(`${prefix}.${id}.note`),
      })),
    };
  });
}

/** Search the complete translated article, including collapsed instructions. */
export function filterGuideSections(sections: GuideSection[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return sections;
  return sections.flatMap(section => {
    const articles = section.articles.filter(article => {
      const text = [
        section.title,
        section.description,
        article.title,
        article.description,
        ...article.steps,
        article.result,
        article.note,
      ]
        .join(' ')
        .toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    });
    return articles.length ? [{ ...section, articles }] : [];
  });
}
