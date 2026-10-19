import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  ReportBehavior,
  ReportIssue,
} from '@localmind/office/report-deck';
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Frame,
  type Page,
} from 'playwright';

import {
  ReportDesignError,
  reportHash,
} from '../../../models/report-deck-design';
import {
  REPORT_WEB_PROBE_V4,
  REPORT_WEB_STATIC_PREP,
  reportMotionSeek,
} from './browser-probe-v4';

export type WebCapture = {
  id: string;
  chapterId: string;
  viewport: string;
  kind: 'detail' | 'sheet' | 'film';
  bytes: Buffer;
  mime: 'image/jpeg';
};
export type BehaviorResult = {
  id: string;
  chapterId: string;
  kind: ReportBehavior['kind'];
  mode: 'mouse' | 'keyboard' | 'touch' | 'scroll' | 'present' | 'motion';
  ok: boolean;
  detail: string;
};
export type ChapterMotion = {
  chapterId: string;
  animations: number;
  maxEnd: number;
  concurrentAt300: number;
  infinite: number;
  hiddenAfter: number;
};
export type ProbeResult = {
  issues: ReportIssue[];
  chapters: Array<{
    id: string;
    top: number;
    height: number;
    background: string;
  }>;
  typography: Array<Record<string, unknown>>;
  contrast: Array<Record<string, unknown>>;
  longLines: Array<Record<string, unknown>>;
  hero: { text: string; fontSize: number; visible: boolean } | null;
  fonts: string;
  fontFamily: string;
  navigationCount: number;
};
export type WebBrowserReport = {
  artifactHash: string;
  issues: ReportIssue[];
  captures: WebCapture[];
  totalCaptures: number;
  browserVersion: string;
  fonts: string[];
  metrics: Record<string, Omit<ProbeResult, 'issues' | 'navigationCount'>>;
  behaviors: BehaviorResult[];
  motion: ChapterMotion[];
  fallback: {
    nojsHidden: number;
    printHidden: number;
    reducedHidden: number;
    scriptErrors: number;
  };
};

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
  { name: 'narrow', width: 320, height: 720, mobile: true },
  { name: 'present', width: 1920, height: 1080, mobile: false },
] as const;
const FRAMES = [0, 300, 700, 1300] as const;
/** Browser-side function from source; the server has no DOM typings. */
const inPage = (param: string, body: string) =>
  new Function(param, `return (${body});`) as (arg: unknown) => unknown;
const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

/**
 * Runs the full v4 inspection in one isolated browser. Network, downloads and
 * service workers are blocked; only the trusted shell/runtime scripts execute.
 */
export async function inspectWebReport(
  executablePath: string | undefined,
  html: string,
  input: {
    chapterIds: string[];
    behaviors: ReportBehavior[];
    language: string;
    /** Fast path: no screenshots for model review, same deterministic checks. */
    light?: boolean;
  },
  signal: AbortSignal
): Promise<WebBrowserReport> {
  const directory = await mkdtemp(join(tmpdir(), 'localmind-report-v4-'));
  const browser = await chromium
    .launch({
      executablePath: executablePath || undefined,
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
        '--js-flags=--max-old-space-size=384',
      ],
    })
    .catch(async () => {
      await rm(directory, { recursive: true, force: true });
      throw new ReportDesignError('render_failed');
    });
  const abort = () => void browser.close().catch(() => {});
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 240000);
  const report: WebBrowserReport = {
    artifactHash: reportHash(html),
    issues: [],
    captures: [],
    totalCaptures: 0,
    browserVersion: browser.version(),
    fonts: [],
    metrics: {},
    behaviors: [],
    motion: [],
    fallback: {
      nojsHidden: 0,
      printHidden: 0,
      reducedHidden: 0,
      scriptErrors: 0,
    },
  };
  const ids = input.chapterIds;
  try {
    // 1. Static, reduced-motion pass in the real sandboxed iframe.
    for (const viewport of VIEWPORTS) {
      signal.throwIfAborted();
      const { context, page, frame } = await open(
        browser,
        html,
        viewport,
        'reduce',
        ids.length
      );
      if (viewport.name === 'present')
        await frame.locator('#deck-mode').click();
      await frame.evaluate(REPORT_WEB_STATIC_PREP);
      await frame.evaluate(
        'document.documentElement.setAttribute("data-chrome","off")'
      );
      const probe = (await frame.evaluate(REPORT_WEB_PROBE_V4)) as ProbeResult;
      if (probe.chapters.map(ch => ch.id).join('|') !== ids.join('|'))
        throw new ReportDesignError('quality_failed');
      const { issues, navigationCount: _n, ...metrics } = probe;
      report.metrics[viewport.name] = metrics;
      report.fonts.push(
        `${viewport.name}: ${probe.fontFamily}; ${probe.fonts}`
      );
      report.issues.push(
        ...issues.map((issue, i) => ({
          ...issue,
          id: `${viewport.name}-${i}`,
          viewport: viewport.name,
        }))
      );
      for (const c of probe.contrast.slice(0, 6))
        report.issues.push({
          id: `${viewport.name}-contrast-${report.issues.length}`,
          category: 'typography',
          severity: 'warning',
          chapterId: String(c.chapterId),
          viewport: viewport.name,
          elementId: '',
          evidence: `Text "${String(c.text)}" has contrast ${String(c.ratio)}:1; needs ${String(c.need)}:1.`,
          suggestedFix:
            'Raise the text/background contrast through the palette tokens.',
        });
      if (viewport.name === 'desktop' && probe.hero && !probe.hero.visible)
        report.issues.push({
          id: 'desktop-hero',
          category: 'composition',
          severity: 'warning',
          chapterId: ids[0],
          viewport: 'desktop',
          elementId: '',
          evidence: `The largest opening element "${probe.hero.text}" is not fully inside the first screen.`,
          suggestedFix:
            'Make the opening focal element fit the first viewport.',
        });
      if (viewport.name !== 'narrow' && !input.light) {
        const pick = viewport.name === 'present' ? [0] : ids.map((_id, i) => i);
        for (const index of pick.slice(0, 10)) {
          const chapter = probe.chapters[index];
          await frame.evaluate(
            `scrollTo({top:${chapter.top},behavior:'instant'})`
          );
          await settle(frame);
          report.captures.push(
            shot(
              `${viewport.name}-${chapter.id}`,
              chapter.id,
              viewport.name,
              'detail',
              await page.screenshot({ type: 'jpeg', quality: 78 })
            )
          );
        }
      }
      await context.close();
    }
    // 2. Contact sheets: every chapter at a glance, per viewport.
    for (const viewport of VIEWPORTS.filter(
      v => !input.light && (v.name === 'desktop' || v.name === 'mobile')
    )) {
      signal.throwIfAborted();
      const context = await isolated(browser, viewport, 'reduce');
      const page = await context.newPage();
      await page.setContent(html);
      await page.waitForFunction(
        'document.documentElement.hasAttribute("data-rd-ready")||document.documentElement.hasAttribute("data-rd-failed")',
        null,
        { timeout: 8000 }
      );
      await page.evaluate(REPORT_WEB_STATIC_PREP);
      await page.evaluate(
        'document.documentElement.setAttribute("data-chrome","off")'
      );
      const boxes = (await page.evaluate(
        `[...document.querySelectorAll('#deck-stage > section[data-slide]')].map(s=>{const r=s.getBoundingClientRect();return {id:s.dataset.chapterId,top:r.top+scrollY,height:r.height}})`
      )) as Array<{ id: string; top: number; height: number }>;
      const thumbs: Array<{ id: string; data: string }> = [];
      for (const box of boxes) {
        const height = Math.max(1, Math.min(box.height, viewport.height * 2.2));
        const bytes = await page.screenshot({
          type: 'jpeg',
          quality: 70,
          fullPage: true,
          clip: { x: 0, y: box.top, width: viewport.width, height },
        });
        thumbs.push({ id: box.id, data: bytes.toString('base64') });
      }
      await context.close();
      const sheet = await compose(
        browser,
        thumbs,
        viewport.name === 'desktop' ? 3 : 5,
        viewport.name === 'desktop' ? 440 : 210
      );
      report.captures.push(
        shot(`sheet-${viewport.name}`, '', viewport.name, 'sheet', sheet)
      );
    }
    // 3. Behaviour scripts with motion enabled.
    {
      const { context, frame, page } = await open(
        browser,
        html,
        VIEWPORTS[0],
        'no-preference',
        ids.length
      );
      page.on('pageerror', () => report.fallback.scriptErrors++);
      await frame.evaluate(
        'document.documentElement.setAttribute("data-chrome","off")'
      );
      report.behaviors.push(
        ...(await desktopBehaviors(frame, page, input.behaviors))
      );
      await frame.evaluate(
        'document.documentElement.removeAttribute("data-chrome")'
      );
      report.behaviors.push(
        ...(await presentSteps(frame, page, input.behaviors, ids))
      );
      await context.close();
    }
    {
      const { context, frame } = await open(
        browser,
        html,
        VIEWPORTS[1],
        'no-preference',
        ids.length
      );
      await frame.evaluate(
        'document.documentElement.setAttribute("data-chrome","off")'
      );
      report.behaviors.push(...(await touchBehaviors(frame, input.behaviors)));
      await context.close();
    }
    // 4. Motion filmstrips: seek every animation of a chapter to fixed times.
    {
      const { context, frame, page } = await open(
        browser,
        html,
        VIEWPORTS[0],
        'no-preference',
        ids.length,
        false
      );
      await frame.evaluate(
        'document.documentElement.setAttribute("data-chrome","off")'
      );
      const boxes = (await frame.evaluate(
        `[...document.querySelectorAll('#deck-stage > section[data-slide]')].map(s=>({id:s.dataset.chapterId,top:s.getBoundingClientRect().top+scrollY}))`
      )) as Array<{ id: string; top: number }>;
      for (const [index, box] of boxes.slice(0, 14).entries()) {
        signal.throwIfAborted();
        // Move the chapter out of view and clear its revealed state so the
        // runtime replays its entrance exactly as a reader would see it.
        await frame.evaluate(
          `scrollTo({top:${index === boxes.length - 1 ? 0 : 'document.documentElement.scrollHeight'},behavior:'instant'})`
        );
        await settle(frame);
        await frame.evaluate(
          `document.querySelectorAll('[data-chapter-id="${box.id}"] [data-rd-in]').forEach(el=>{el.style.transition='none';el.removeAttribute('data-rd-in');el.removeAttribute('data-rd-counted');el.style.removeProperty('--rd-delay');el.getBoundingClientRect();el.style.removeProperty('transition')})`
        );
        await settle(frame);
        await frame.evaluate(`scrollTo({top:${box.top},behavior:'instant'})`);
        await frame.evaluate(
          'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,60))))'
        );
        const frames: string[] = [];
        type Stats = {
          animations: number;
          maxEnd: number;
          concurrentAt300: number;
          infinite: number;
        };
        let stats: Stats | null = null;
        for (const t of input.light ? [0] : FRAMES) {
          const s = (await frame.evaluate(
            reportMotionSeek(box.id, t)
          )) as Stats | null;
          stats ??= s;
          if (input.light) continue;
          await frame.evaluate(
            'new Promise(r=>requestAnimationFrame(()=>r(0)))'
          );
          frames.push(
            (await page.screenshot({ type: 'jpeg', quality: 60 })).toString(
              'base64'
            )
          );
        }
        await frame.evaluate(reportMotionSeek(box.id, 'end'));
        await frame.evaluate('new Promise(r=>requestAnimationFrame(()=>r(0)))');
        if (!input.light)
          frames.push(
            (await page.screenshot({ type: 'jpeg', quality: 60 })).toString(
              'base64'
            )
          );
        const hidden = (await frame.evaluate(
          `(() => { const ch=document.querySelector('[data-chapter-id="${box.id}"]'); let n=0; for (const el of ch.querySelectorAll('h1,h2,h3,p,li,figcaption,[data-rd-fact]')) { if (el.closest('details:not([open])')||el.closest('[data-rd-view]:not([data-rd-current])')&&el.closest('.rd-ready')) continue; const st=getComputedStyle(el); const r=el.getBoundingClientRect(); if (r.bottom<0||r.top>innerHeight) continue; if (Number(st.opacity)<.1&&el.textContent.trim()) n++; } return n; })()`
        )) as number;
        report.motion.push({
          chapterId: box.id,
          ...(stats ?? {
            animations: 0,
            maxEnd: 0,
            concurrentAt300: 0,
            infinite: 0,
          }),
          hiddenAfter: hidden,
        });
        if (hidden)
          report.issues.push({
            id: `motion-${box.id}`,
            category: 'visibility',
            severity: 'error',
            chapterId: box.id,
            viewport: 'desktop-motion',
            elementId: '',
            evidence: `${hidden} text elements remain invisible after all animations finish.`,
            suggestedFix:
              'Animate from a hidden state to a visible end state; never end hidden.',
          });
        if (!input.light)
          report.captures.push(
            shot(
              `film-${box.id}`,
              box.id,
              'desktop-motion',
              'film',
              await compose(
                browser,
                frames.map((data, i) => ({
                  id: i < FRAMES.length ? `${FRAMES[i]}ms` : 'end',
                  data,
                })),
                frames.length,
                300
              )
            )
          );
      }
      await context.close();
    }
    // 5. No-script fallback: everything must be readable without the runtime.
    {
      const context = await isolated(
        browser,
        VIEWPORTS[0],
        'no-preference',
        false
      );
      const page = await context.newPage();
      await page.setContent(html);
      const probe = (await page.evaluate(REPORT_WEB_PROBE_V4)) as ProbeResult;
      const hidden = probe.issues.filter(i => i.category === 'visibility');
      report.fallback.nojsHidden = hidden.length;
      report.issues.push(
        ...hidden.slice(0, 6).map((issue, i) => ({
          ...issue,
          id: `nojs-${i}`,
          viewport: 'no-script',
          evidence: `Without script: ${issue.evidence}`,
        }))
      );
      await context.close();
    }
    // 6. Print: every chapter, step and view must print fully.
    {
      const context = await isolated(browser, VIEWPORTS[0], 'no-preference');
      const page = await context.newPage();
      await page.emulateMedia({ media: 'print' });
      await page.setContent(html);
      await page.waitForFunction(
        'document.documentElement.hasAttribute("data-rd-ready")||document.documentElement.hasAttribute("data-rd-failed")',
        null,
        { timeout: 8000 }
      );
      const probe = (await page.evaluate(REPORT_WEB_PROBE_V4)) as ProbeResult;
      const hidden = probe.issues.filter(i => i.category === 'visibility');
      report.fallback.printHidden = hidden.length;
      report.issues.push(
        ...hidden.slice(0, 4).map((issue, i) => ({
          ...issue,
          id: `print-${i}`,
          severity: 'warning' as const,
          viewport: 'print',
          evidence: `In print: ${issue.evidence}`,
        }))
      );
      await context.close();
    }
    report.fallback.reducedHidden = report.issues.filter(
      i =>
        i.category === 'visibility' &&
        ['desktop', 'mobile', 'narrow', 'present'].includes(i.viewport)
    ).length;
    if (report.fallback.scriptErrors)
      report.issues.push({
        id: 'runtime-error',
        category: 'structure',
        severity: 'error',
        chapterId: '',
        viewport: 'desktop',
        elementId: '',
        evidence: 'The trusted runtime reported a script error.',
        suggestedFix: 'Check behaviour attributes against the vocabulary.',
      });
    report.totalCaptures = report.captures.length;
    report.issues = report.issues.slice(0, 160);
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

const shot = (
  id: string,
  chapterId: string,
  viewport: string,
  kind: WebCapture['kind'],
  bytes: Buffer
): WebCapture => {
  if (bytes.length > 3 * 1024 * 1024)
    throw new ReportDesignError('budget_exceeded');
  return { id, chapterId, viewport, kind, bytes, mime: 'image/jpeg' };
};

async function isolated(
  browser: Browser,
  viewport: (typeof VIEWPORTS)[number],
  reducedMotion: 'reduce' | 'no-preference',
  javaScriptEnabled = true
) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    reducedMotion,
    javaScriptEnabled,
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  await context.route('**/*', route => route.abort('blockedbyclient'));
  await context.routeWebSocket('**/*', socket => socket.close());
  return context;
}

async function open(
  browser: Browser,
  html: string,
  viewport: (typeof VIEWPORTS)[number],
  reducedMotion: 'reduce' | 'no-preference',
  chapters: number,
  waitFonts = true
): Promise<{ context: BrowserContext; page: Page; frame: Frame }> {
  const context = await isolated(browser, viewport, reducedMotion);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.setContent(
    `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;overflow:hidden"><iframe title="Report" sandbox="allow-scripts" allowfullscreen style="display:block;width:100vw;height:100vh;border:0" srcdoc="${esc(html)}"></iframe></body></html>`
  );
  const frame = await (
    await page.locator('iframe').elementHandle()
  )?.contentFrame();
  if (!frame) throw new ReportDesignError('render_failed');
  await frame.waitForFunction(
    `document.querySelectorAll('#deck-chapters option').length === ${chapters}`
  );
  await frame.waitForFunction(
    'document.documentElement.hasAttribute("data-rd-ready")||document.documentElement.hasAttribute("data-rd-failed")'
  );
  if (waitFonts) await frame.evaluate('document.fonts.ready.then(() => true)');
  return { context, page, frame };
}

const settle = (frame: Frame) =>
  frame.evaluate(
    'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(0))))'
  );

/** Lays out base64 JPEG tiles in a grid and screenshots the sheet. */
async function compose(
  browser: Browser,
  tiles: Array<{ id: string; data: string }>,
  columns: number,
  width: number
) {
  const context = await browser.newContext({
    viewport: { width: columns * (width + 16) + 16, height: 400 },
    deviceScaleFactor: 1,
    javaScriptEnabled: false,
  });
  await context.route('**/*', route => route.abort('blockedbyclient'));
  const page = await context.newPage();
  const cells = tiles
    .map(
      (t, i) =>
        `<figure><img src="data:image/jpeg;base64,${t.data}"><figcaption>${i + 1} · ${esc(t.id)}</figcaption></figure>`
    )
    .join('');
  await page.setContent(
    `<html><body style="margin:0;background:#2b2b2b;font:13px sans-serif;color:#eee"><div style="display:grid;grid-template-columns:repeat(${columns},${width}px);gap:16px;padding:16px;align-items:start">${cells.replaceAll('<figure>', '<figure style="margin:0">').replaceAll('<img ', `<img style="display:block;width:${width}px;height:auto;border:1px solid #555" `)}</div></body></html>`
  );
  const bytes = await page.screenshot({
    type: 'jpeg',
    quality: 72,
    fullPage: true,
  });
  await context.close();
  return bytes;
}

type Check = Omit<BehaviorResult, 'id' | 'chapterId' | 'kind'>;
async function attempt(fn: () => Promise<Check>): Promise<Check> {
  try {
    return await fn();
  } catch (error) {
    return {
      mode: 'mouse',
      ok: false,
      detail: `Interaction failed: ${error instanceof Error ? error.message.split('\n')[0].slice(0, 160) : 'unknown'}`,
    };
  }
}

async function desktopBehaviors(
  frame: Frame,
  page: Page,
  declared: ReportBehavior[]
) {
  const out: BehaviorResult[] = [];
  for (const b of declared) {
    const section = frame.locator(`section[data-chapter-id="${b.chapterId}"]`);
    if (b.kind === 'switch') {
      const boxes = section.locator('[data-rd-switch].rd-ready');
      const n = await boxes.count();
      if (!n)
        out.push({
          ...b,
          mode: 'mouse',
          ok: false,
          detail: 'Switch was not initialised by the runtime.',
        });
      for (let i = 0; i < n; i++) {
        const box = boxes.nth(i);
        const tabs = box
          .locator(
            'xpath=preceding-sibling::div[contains(@class,"rd-tabs")][1]'
          )
          .locator('.rd-tab');
        const count = await tabs.count();
        out.push({
          ...b,
          ...(await attempt(async () => {
            for (let k = count - 1; k >= 0; k--) {
              await tabs.nth(k).click({ timeout: 3000 });
              const state = (await box.evaluate(
                inPage(
                  'el',
                  `[el.getAttribute('data-rd-active'), [...el.children].filter(c => c.hasAttribute('data-rd-view')).map(c => getComputedStyle(c).display !== 'none')]`
                )
              )) as [string, boolean[]];
              if (
                state[0] !== String(k) ||
                state[1].filter(Boolean).length !== 1 ||
                !state[1][k]
              )
                return {
                  mode: 'mouse' as const,
                  ok: false,
                  detail: `Tab ${k + 1} did not show exactly its own view.`,
                };
            }
            return {
              mode: 'mouse' as const,
              ok: true,
              detail: `${count} tabs each show their own view.`,
            };
          })),
        });
        out.push({
          ...b,
          ...(await attempt(async () => {
            await tabs.nth(0).focus();
            await page.keyboard.press('ArrowRight');
            const active = await box.getAttribute('data-rd-active');
            const focused = (await tabs
              .nth(1)
              .evaluate(
                inPage('el', 'el === document.activeElement')
              )) as boolean;
            await page.keyboard.press('Home');
            return {
              mode: 'keyboard' as const,
              ok: active === '1' && focused,
              detail:
                active === '1' && focused
                  ? 'Arrow keys move selection and focus.'
                  : 'Arrow keys did not move the selection.',
            };
          })),
        });
      }
    }
    if (b.kind === 'linked') {
      const boxes = section.locator('[data-rd-linked].rd-ready');
      const n = await boxes.count();
      for (let i = 0; i < n; i++) {
        const box = boxes.nth(i);
        const controls = box.locator('[data-rd-control]');
        const target = (await controls.count())
          ? controls.first()
          : box.locator('[data-rd-key]').first();
        out.push({
          ...b,
          ...(await attempt(async () => {
            await target.scrollIntoViewIfNeeded();
            await target.hover({ timeout: 3000, force: true });
            const hovered = await box.getAttribute('data-rd-focus');
            await target.click({ timeout: 3000, force: true });
            const pinned = await box.getAttribute('data-rd-focus');
            const matches = await box.locator('[data-rd-match]').count();
            await target.click({ timeout: 3000, force: true });
            return {
              mode: 'mouse' as const,
              ok: !!hovered && !!pinned && matches >= 2,
              detail: `hover focus=${hovered ?? 'none'}, pinned=${pinned ?? 'none'}, matches=${matches}`,
            };
          })),
        });
        if (await controls.count())
          out.push({
            ...b,
            ...(await attempt(async () => {
              await page.mouse.move(0, 0);
              await controls.first().focus();
              await page.keyboard.press('Enter');
              const pinned = await controls
                .first()
                .getAttribute('aria-pressed');
              await page.keyboard.press('Escape');
              const cleared = await box.getAttribute('data-rd-focus');
              const ok = pinned === 'true' && !cleared;
              return {
                mode: 'keyboard' as const,
                ok,
                detail: ok
                  ? 'Enter pins and Escape clears the highlight.'
                  : `Keyboard toggle failed (pressed=${pinned}, after Escape=${cleared}).`,
              };
            })),
          });
      }
    }
    if (b.kind === 'scrolly') {
      out.push({
        ...b,
        ...(await attempt(async () => {
          const box = section.locator('[data-rd-scrolly].rd-ready').first();
          const stages = box.locator(':scope > [data-rd-stage]');
          const seen = new Set<string>();
          for (let k = 0; k < (await stages.count()); k++) {
            await stages
              .nth(k)
              .evaluate(
                inPage(
                  'el',
                  `el.scrollIntoView({ block: 'center', behavior: 'instant' })`
                )
              );
            await page.waitForTimeout(250);
            const at = await box.getAttribute('data-rd-at');
            if (at) seen.add(at);
          }
          return {
            mode: 'scroll' as const,
            ok: seen.size >= 2,
            detail: `Reading position set ${seen.size} figure states.`,
          };
        })),
      });
    }
    if (b.kind === 'count') {
      out.push({
        ...b,
        ...(await attempt(async () => {
          await section.evaluate(
            inPage(
              'el',
              `el.scrollIntoView({ block: 'start', behavior: 'instant' })`
            )
          );
          await page.waitForTimeout(2200);
          const results = (await section
            .locator('[data-rd-count]')
            .evaluateAll(
              inPage(
                'els',
                `els.map(el => ({ text: (el.textContent || '').trim(), label: el.getAttribute('aria-label') }))`
              )
            )) as Array<{ text: string; label: string | null }>;
          const bad = results.filter(
            r => r.label !== null && r.text !== r.label
          );
          return {
            mode: 'motion' as const,
            ok: !bad.length,
            detail: bad.length
              ? `Count-up stopped at "${bad[0].text}" instead of "${bad[0].label}".`
              : `${results.length} count-up(s) end on the exact source text.`,
          };
        })),
      });
    }
    if (b.kind === 'disclosure') {
      out.push({
        ...b,
        ...(await attempt(async () => {
          const summary = section
            .locator('details > summary')
            .filter({ visible: true })
            .first();
          const before = (await summary.evaluate(
            inPage('el', 'el.parentElement.open')
          )) as boolean;
          await summary.click({ timeout: 3000 });
          const after = (await summary.evaluate(
            inPage('el', 'el.parentElement.open')
          )) as boolean;
          await summary.click({ timeout: 3000 });
          return {
            mode: 'mouse' as const,
            ok: before !== after,
            detail:
              before !== after
                ? 'Click toggles the details.'
                : 'Click did not toggle the details.',
          };
        })),
      });
      out.push({
        ...b,
        ...(await attempt(async () => {
          const summary = section
            .locator('details > summary')
            .filter({ visible: true })
            .first();
          const before = (await summary.evaluate(
            inPage('el', 'el.parentElement.open')
          )) as boolean;
          await summary.focus();
          await page.keyboard.press('Enter');
          const after = (await summary.evaluate(
            inPage('el', 'el.parentElement.open')
          )) as boolean;
          await page.keyboard.press('Enter');
          return {
            mode: 'keyboard' as const,
            ok: before !== after,
            detail:
              before !== after
                ? 'Enter on the focused summary toggles the details.'
                : 'Keyboard did not toggle the details.',
          };
        })),
      });
    }
  }
  return out;
}

async function presentSteps(
  frame: Frame,
  page: Page,
  declared: ReportBehavior[],
  ids: string[]
) {
  const out: BehaviorResult[] = [];
  const steps = declared.filter(b => b.kind === 'steps');
  if (!steps.length) return out;
  await frame.locator('#deck-mode').click();
  for (const b of steps) {
    out.push({
      ...b,
      ...(await attempt(async () => {
        await frame
          .locator('#deck-chapters')
          .selectOption(String(ids.indexOf(b.chapterId)));
        await page.waitForTimeout(900);
        const section = frame.locator(
          `section[data-chapter-id="${b.chapterId}"]`
        );
        await section.evaluate(
          inPage('el', 'el.focus({ preventScroll: true })')
        );
        const before = await section.getAttribute('data-rd-step-at');
        const num = await frame.locator('#deck-num').textContent();
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(250);
        const after = await section.getAttribute('data-rd-step-at');
        const numAfter = await frame.locator('#deck-num').textContent();
        const ok = before === '0' && after === '1' && num === numAfter;
        return {
          mode: 'present' as const,
          ok,
          detail: ok
            ? 'Forward key reveals the next step before changing chapter.'
            : `Step did not advance (before=${before}, after=${after}, ${num}→${numAfter}).`,
        };
      })),
    });
  }
  await frame.locator('#deck-mode').click();
  return out;
}

async function touchBehaviors(frame: Frame, declared: ReportBehavior[]) {
  const out: BehaviorResult[] = [];
  for (const b of declared) {
    const section = frame.locator(`section[data-chapter-id="${b.chapterId}"]`);
    if (b.kind === 'switch') {
      out.push({
        ...b,
        ...(await attempt(async () => {
          const box = section.locator('[data-rd-switch].rd-ready').first();
          const tab = box
            .locator(
              'xpath=preceding-sibling::div[contains(@class,"rd-tabs")][1]'
            )
            .locator('.rd-tab')
            .nth(1);
          await tab.scrollIntoViewIfNeeded();
          await tab.tap({ timeout: 3000 });
          const ok = (await box.getAttribute('data-rd-active')) === '1';
          const size = (await tab.evaluate(
            inPage('el', 'el.getBoundingClientRect().height')
          )) as number;
          return {
            mode: 'touch' as const,
            ok: ok && size >= 32,
            detail: ok
              ? `Tap switches views (target ${Math.round(size)}px tall).`
              : 'Tap did not switch views.',
          };
        })),
      });
    }
    if (b.kind === 'disclosure') {
      out.push({
        ...b,
        ...(await attempt(async () => {
          const summary = section
            .locator('details > summary')
            .filter({ visible: true })
            .first();
          await summary.scrollIntoViewIfNeeded();
          const before = (await summary.evaluate(
            inPage('el', 'el.parentElement.open')
          )) as boolean;
          await summary.tap({ timeout: 3000 });
          const after = (await summary.evaluate(
            inPage('el', 'el.parentElement.open')
          )) as boolean;
          return {
            mode: 'touch' as const,
            ok: before !== after,
            detail:
              before !== after
                ? 'Tap toggles the details.'
                : 'Tap did not toggle the details.',
          };
        })),
      });
    }
    if (b.kind === 'linked') {
      out.push({
        ...b,
        ...(await attempt(async () => {
          const box = section.locator('[data-rd-linked].rd-ready').first();
          const target = box.locator('[data-rd-control]').first();
          if (!(await target.count()))
            return {
              mode: 'touch' as const,
              ok: true,
              detail: 'No HTML control; chart marks respond to hover only.',
            };
          await target.scrollIntoViewIfNeeded();
          await target.tap({ timeout: 3000 });
          const pinned = await box.getAttribute('data-rd-focus');
          await target.tap({ timeout: 3000 });
          return {
            mode: 'touch' as const,
            ok: !!pinned,
            detail: pinned
              ? 'Tap pins the highlight.'
              : 'Tap did not highlight.',
          };
        })),
      });
    }
  }
  return out;
}
