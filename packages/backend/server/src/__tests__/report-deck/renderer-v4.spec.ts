import {
  REPORT_RUNTIME_CSS,
  wrapDeckHtml,
} from '@localmind/office/report-deck';
import test from 'ava';

import { inspectWebReport } from '../../plugins/copilot/report-web-design/renderer-v4';

test.serial(
  'compact reports retain their genuine reveal state; genuinely hidden content is rejected',
  async t => {
    t.timeout(180000);
    for (const hidden of [false, true]) {
      const html = wrapDeckHtml({
        title: 'Compact fixture',
        lang: 'en',
        contentVersion: 'custom-v4',
        css: `${REPORT_RUNTIME_CSS}\n[data-content-root] section{padding:24px} ${hidden ? '[data-content-root] h2{opacity:0}' : ''}`,
        slidesHtml: ['one', 'two']
          .map(
            id =>
              `<section class="slide" data-slide data-chapter-id="rd-c-${id}"><h2 data-rd-reveal="rise">Fixture ${id}</h2><p data-rd-reveal="fade">Compact content.</p></section>`
          )
          .join(''),
      });
      const report = await inspectWebReport(
        '/usr/bin/chromium',
        html,
        { chapterIds: ['rd-c-one', 'rd-c-two'], behaviors: [], language: 'en' },
        new AbortController().signal
      );
      const failed = report.motion.some(ch => ch.hiddenAfter > 0);
      t.is(failed, hidden, JSON.stringify(report.motion));
    }
  }
);
