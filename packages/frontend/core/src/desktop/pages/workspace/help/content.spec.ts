import { SUPPORTED_LANGUAGES } from '@affine/i18n';
import { describe, expect, test } from 'vitest';

import { createGuideSections, filterGuideSections } from './content';

describe('unified guide content', () => {
  test.each(['en', 'zh-Hans', 'zh-Hant'] as const)(
    '%s has complete, searchable user and admin articles',
    async language => {
      const resource = SUPPORTED_LANGUAGES[language].resource;
      const messages =
        typeof resource === 'function' ? (await resource()).default : resource;
      const sections = createGuideSections(key => {
        const value = messages[key as keyof typeof messages];
        expect(value, key).toBeTruthy();
        return value ?? key;
      });
      expect(
        new Set(sections.flatMap(s => s.articles.map(a => a.id))).size
      ).toBe(sections.reduce((count, s) => count + s.articles.length, 0));
      // Search matches instructions inside a collapsed article, not just titles.
      const results = filterGuideSections(
        sections,
        'LOCALMIND_MCP_RESOURCES_ENABLED'
      );
      expect(results.flatMap(s => s.articles.map(a => a.id))).toEqual([
        'admin-integrations',
      ]);
      expect(filterGuideSections(sections, '   ')).toBe(sections);
      expect(filterGuideSections(sections, 'unmatched-query-78231')).toEqual(
        []
      );
    }
  );

  test('matches all words across a translated article, case-insensitively', () => {
    const messages = SUPPORTED_LANGUAGES.en.resource;
    if (typeof messages === 'function')
      throw new Error('English must be bundled');
    const sections = createGuideSections(
      key => messages[key as keyof typeof messages]
    );
    const result = filterGuideSections(sections, '  GLOBAL   byok  ');
    expect(result.flatMap(s => s.articles.map(a => a.id))).toContain(
      'admin-project-ai'
    );
    expect(filterGuideSections(sections, 'SMTP unmatched-query-78231')).toEqual(
      []
    );
  });
});
