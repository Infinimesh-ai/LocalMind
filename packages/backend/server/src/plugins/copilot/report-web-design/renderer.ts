import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type ReportIssue,
  ReportIssueSchema,
} from '@localmind/office/report-deck';
import { Injectable } from '@nestjs/common';
import { chromium } from 'playwright';
import { z } from 'zod';

import { Config } from '../../../base';
import {
  ReportDesignError,
  reportHash,
} from '../../../models/report-deck-design';
import { awaitReportCall } from './bounds';
import { REPORT_BROWSER_PROBE } from './browser-probe';
import { inspectWebReport, type WebBrowserReport } from './renderer-v4';

export type ReportCapture = {
  id: string;
  chapterId: string;
  viewport: string;
  offset: number;
  bytes: Buffer;
  mime: 'image/jpeg';
};
export type BrowserReport = {
  artifactHash: string;
  issues: ReportIssue[];
  captures: ReportCapture[];
  totalCaptures: number;
  fonts: string[];
  browserVersion: string;
  chapterMetrics: Array<{ id: string; viewport: string; height: number }>;
  typography?: Array<
    z.infer<typeof TypographySampleSchema> & { viewport: string }
  >;
};
const TypographySampleSchema = z.object({
  chapterId: z.string(),
  elementId: z.string(),
  tag: z.string(),
  text: z.string().max(80),
  fontSize: z.number(),
  fontWeight: z.string(),
  lineHeight: z.string(),
  fontFamily: z.string(),
});
const ProbeSchema = z.object({
  issues: z.array(ReportIssueSchema),
  chapters: z.array(
    z.object({ id: z.string(), top: z.number(), height: z.number() })
  ),
  fonts: z.string(),
  fontFamily: z.string(),
  navigationCount: z.number(),
  typography: z.array(TypographySampleSchema).max(112),
});
const escapeAttribute = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

@Injectable()
export class ReportWebRenderer {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly config: Config) {}

  async available() {
    try {
      await access(
        this.config.reportDecks.rendererExecutablePath ||
          chromium.executablePath()
      );
    } catch {
      throw new ReportDesignError('render_failed');
    }
  }

  /** One browser at a time per worker; all waits share the caller's deadline. */
  async inspect(
    html: string,
    expectedChapterIds: string[],
    signal: AbortSignal
  ): Promise<BrowserReport> {
    const before = this.tail;
    let release!: () => void;
    this.tail = new Promise(resolve => {
      release = resolve;
    });
    let entered = false;
    try {
      await awaitReportCall(before, signal);
      entered = true;
      signal.throwIfAborted();
      return await this.render(html, expectedChapterIds, signal);
    } finally {
      if (entered) release();
      else void before.then(release, release);
    }
  }

  /** v4: static, behaviour, motion and no-script inspection in one browser. */
  async inspectWeb(
    html: string,
    input: Parameters<typeof inspectWebReport>[2],
    signal: AbortSignal
  ): Promise<WebBrowserReport> {
    const before = this.tail;
    let release!: () => void;
    this.tail = new Promise(resolve => {
      release = resolve;
    });
    let entered = false;
    try {
      await awaitReportCall(before, signal);
      entered = true;
      signal.throwIfAborted();
      await this.available();
      return await inspectWebReport(
        this.config.reportDecks.rendererExecutablePath || undefined,
        html,
        input,
        signal
      );
    } finally {
      if (entered) release();
      else void before.then(release, release);
    }
  }

  private async render(
    html: string,
    expectedChapterIds: string[],
    signal: AbortSignal
  ): Promise<BrowserReport> {
    await this.available();
    const directory = await mkdtemp(join(tmpdir(), 'localmind-report-'));
    const browser = await chromium
      .launch({
        executablePath:
          this.config.reportDecks.rendererExecutablePath || undefined,
        headless: true,
        timeout: 30000,
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: directory,
          TMPDIR: directory,
          LANG: 'C.UTF-8',
        },
        args: [
          '--disable-dev-shm-usage',
          '--disable-background-networking',
          '--js-flags=--max-old-space-size=256',
        ],
      })
      .catch(async () => {
        await rm(directory, { recursive: true, force: true });
        throw new ReportDesignError('render_failed');
      });
    const abort = () => {
      void browser.close().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 120000);
    const report: BrowserReport = {
      artifactHash: reportHash(html),
      issues: [],
      captures: [],
      totalCaptures: 0,
      fonts: [],
      browserVersion: browser.version(),
      chapterMetrics: [],
      typography: [],
    };
    let pixels = 0;
    try {
      for (const viewport of [
        { name: 'desktop', width: 1440, height: 900, mode: 'read' },
        { name: 'mobile', width: 390, height: 844, mode: 'read' },
        { name: 'narrow', width: 320, height: 844, mode: 'read' },
        { name: 'present', width: 1920, height: 1080, mode: 'present' },
      ] as const) {
        signal.throwIfAborted();
        const context = await browser.newContext({
          viewport,
          deviceScaleFactor: 1,
          reducedMotion: 'reduce',
          serviceWorkers: 'block',
          acceptDownloads: false,
        });
        await context.route('**/*', route => route.abort('blockedbyclient'));
        await context.routeWebSocket('**/*', socket => socket.close());
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        let runtimeErrors = 0;
        page.on('pageerror', () => runtimeErrors++);
        await page.setContent(
          `<html><body style="margin:0;overflow:hidden"><iframe title="Report" sandbox="allow-scripts" allowfullscreen style="display:block;width:100vw;height:100vh;border:0" srcdoc="${escapeAttribute(html)}"></iframe></body></html>`
        );
        const handle = await page.locator('iframe').elementHandle();
        const frame = await handle?.contentFrame();
        if (!frame) throw new ReportDesignError('render_failed');
        await frame.waitForFunction(
          `document.querySelectorAll('#deck-chapters option').length === ${expectedChapterIds.length}`
        );
        await frame.evaluate('document.fonts.ready.then(() => true)');
        if (viewport.mode === 'present')
          await frame.locator('#deck-mode').click();
        const probe = ProbeSchema.parse(
          await frame.evaluate(REPORT_BROWSER_PROBE)
        );
        if (
          probe.navigationCount !== expectedChapterIds.length ||
          probe.chapters.map(ch => ch.id).join('|') !==
            expectedChapterIds.join('|')
        )
          throw new ReportDesignError('quality_failed');
        report.chapterMetrics.push(
          ...probe.chapters.map(ch => ({
            id: ch.id,
            viewport: viewport.name,
            height: ch.height,
          }))
        );
        report.typography?.push(
          ...probe.typography.map(sample => ({
            ...sample,
            viewport: viewport.name,
          }))
        );
        report.fonts.push(
          `${viewport.name}: ${probe.fontFamily}; ${probe.fonts}`
        );
        report.issues.push(
          ...probe.issues.map((issue, i) => ({
            ...issue,
            id: `${viewport.name}-${i}`,
            viewport: viewport.name,
          }))
        );
        if (runtimeErrors)
          report.issues.push({
            id: `${viewport.name}-script`,
            category: 'structure',
            severity: 'error',
            chapterId: '',
            viewport: viewport.name,
            elementId: '',
            evidence: 'Trusted shell reported a runtime error.',
            suggestedFix: 'Check the chapter structure and reserved names.',
          });
        for (const [index, chapter] of probe.chapters.entries()) {
          const take =
            viewport.name !== 'narrow' &&
            (viewport.name !== 'present' ||
              index === 0 ||
              chapter.height > viewport.height ||
              index === probe.chapters.length - 1);
          if (!take) continue;
          const count = Math.max(
            1,
            1 +
              Math.ceil(
                Math.max(0, chapter.height - viewport.height) /
                  (viewport.height * 0.85)
              )
          );
          report.totalCaptures += count;
          for (let part = 0; part < count; part++) {
            signal.throwIfAborted();
            if (
              report.captures.length >= 60 ||
              pixels + viewport.width * viewport.height > 60_000_000
            )
              break;
            const offset = Math.min(
              part * viewport.height * 0.85,
              Math.max(0, chapter.height - viewport.height)
            );
            await frame.evaluate(
              `scrollTo({top:${chapter.top + offset},behavior:'instant'})`
            );
            await frame.evaluate(
              'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
            );
            const bytes = await page.screenshot({ type: 'jpeg', quality: 80 });
            if (bytes.length > 2 * 1024 * 1024)
              throw new ReportDesignError('budget_exceeded');
            pixels += viewport.width * viewport.height;
            report.captures.push({
              id: `${viewport.name}-${chapter.id}-${part}`,
              chapterId: chapter.id,
              viewport: viewport.name,
              offset,
              bytes,
              mime: 'image/jpeg',
            });
          }
        }
        // Check that the authored animation leaves the initial evidence visible.
        if (viewport.name === 'desktop') {
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          await frame.evaluate('scrollTo({top:0,behavior:"instant"})');
          await frame.waitForTimeout(1300);
          const animated = ProbeSchema.parse(
            await frame.evaluate(REPORT_BROWSER_PROBE)
          );
          report.issues.push(
            ...animated.issues
              .filter(i => i.category === 'visibility')
              .map((i, n) => ({
                ...i,
                id: `motion-${n}`,
                viewport: 'desktop-motion',
              }))
          );
        }
        await context.close();
      }
      report.issues = report.issues.slice(0, 100);
      return report;
    } catch (error) {
      if (signal.aborted) throw new ReportDesignError('cancelled');
      if (error instanceof ReportDesignError) throw error;
      throw new ReportDesignError('render_failed');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      await browser.close().catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  }
}
