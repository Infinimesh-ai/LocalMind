import { createHash } from 'node:crypto';

import { parseFragment } from 'parse5';
import { describe, expect, it } from 'vitest';

import {
  DECK_CSP,
  DECK_SHELL_SCRIPT,
  DECK_SHELL_SCRIPT_HASH,
  DECK_STAGE,
  DECK_TEMPLATE_MOTION,
  DECK_TEMPLATES,
  deckMotionCss,
  type DeckSpec,
  DeckSpecSchema,
  getDeckTemplate,
  renderCustomDeckHtml,
  renderDeckCover,
  renderDeckHtml,
  sanitizeDeckCss,
  sanitizeDeckFragment,
  sha256Base64,
  wrapDeckHtml,
} from './index';

const nodeSha = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('base64');

/** Matches anything that could make the browser fetch an external resource. */
const EXTERNAL =
  /https?:|["'(=]\s*\/\/|\s(?:src|href|action|poster|srcset)\s*=\s*["']|url\((?!\s*#|\s*["']?data:)/i;

const inlineScripts = (html: string) =>
  Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), m => m[1]);

const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&';
/** Fits 16-character fields. */
const short = '<b>"\'&</b>';

function hostileSpec(): DeckSpec {
  return DeckSpecSchema.parse({
    title: `T ${hostile}`,
    subtitle: `S ${hostile}`,
    period: `P ${hostile}`,
    slides: [
      {
        layout: 'cover',
        title: `C ${hostile}`,
        kicker: `K ${hostile}`,
        notes: 'SECRET-NOTES',
        blocks: [{ type: 'paragraph', text: `Para ${hostile}` }],
        citations: [`Cite ${hostile}`],
      },
      {
        layout: 'metrics',
        title: hostile,
        blocks: [
          {
            type: 'metric',
            label: hostile,
            value: `1,234${short}`,
            unit: short,
            delta: short,
            trend: 'up',
          },
          { type: 'callout', tone: 'risk', text: hostile },
        ],
        citations: ['Source A'],
      },
      {
        layout: 'chart',
        title: 'chart',
        blocks: [
          {
            type: 'chart',
            chartType: 'bar',
            title: hostile,
            labels: [short, 'b'],
            series: [
              { label: hostile, values: [1, -2] },
              { label: 's2', values: [3, 4] },
            ],
            unit: short,
          },
          {
            type: 'chart',
            chartType: 'donut',
            labels: [short, 'b'],
            series: [{ label: 'x', values: [1, 3] }],
            unit: short,
          },
        ],
      },
      {
        layout: 'comparison',
        title: 'cmp',
        blocks: [
          { type: 'paragraph', text: hostile },
          { type: 'list', items: [hostile] },
          { type: 'table', columns: [hostile], rows: [[hostile]] },
        ],
      },
      {
        layout: 'timeline',
        title: 'tl',
        blocks: [
          {
            type: 'timeline',
            entries: [
              { date: short, title: hostile, detail: hostile, status: 'risk' },
            ],
          },
          { type: 'quote', text: hostile, by: hostile },
        ],
      },
      {
        layout: 'closing',
        title: hostile,
        blocks: [{ type: 'list', items: [hostile], ordered: true }],
      },
    ],
  });
}

describe('deck sha256', () => {
  it('matches node:crypto for assorted inputs', () => {
    for (const input of [
      '',
      'abc',
      'a'.repeat(55),
      'a'.repeat(56),
      'a'.repeat(64),
      'a'.repeat(1000),
      '中文汇报 🎉 émoji',
      DECK_SHELL_SCRIPT,
    ])
      expect(sha256Base64(input)).toBe(nodeSha(input));
  });
  it('CSP hashes exactly the inline shell script', () => {
    expect(DECK_SHELL_SCRIPT_HASH).toBe(nodeSha(DECK_SHELL_SCRIPT));
    const html = wrapDeckHtml({
      title: 't',
      lang: 'zh-CN',
      css: '',
      slidesHtml: '<section class="slide" data-slide></section>',
    });
    const scripts = inlineScripts(html);
    expect(scripts).toHaveLength(1);
    expect(html).toContain(`script-src 'sha256-${nodeSha(scripts[0])}'`);
    expect(html).toContain(DECK_CSP);
    for (const directive of [
      "default-src 'none'",
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      'img-src data:',
    ])
      expect(DECK_CSP).toContain(directive);
  });
  it('shell neutralizes style breakouts and invalid lang', () => {
    const html = wrapDeckHtml({
      title: '</title><script>x</script>',
      lang: '"><script>',
      css: 'a{}</style><script>alert(1)</script>',
      slidesHtml: '',
    });
    expect(inlineScripts(html)).toEqual([DECK_SHELL_SCRIPT]);
    expect(html).toContain('lang="zh-CN"');
    expect(DECK_STAGE).toEqual({ width: 1280, height: 720 });
  });
});

describe('deck templates', () => {
  it('has 10 templates with motion styles per plan', () => {
    expect(DECK_TEMPLATES.map(t => t.key)).toEqual([
      'periodic',
      'management',
      'customer',
      'milestone',
      'closure',
      'retrospective',
      'launch',
      'minimal',
      'dashboard',
      'vivid',
    ]);
    for (const template of DECK_TEMPLATES)
      expect(template.motion).toBe(DECK_TEMPLATE_MOTION[template.key]);
    expect(getDeckTemplate('closure')?.theme.fontStyle).toBe('serif');
    expect(getDeckTemplate('nope')).toBeUndefined();
  });

  for (const template of DECK_TEMPLATES)
    it(`sample of ${template.key} validates and renders`, () => {
      const spec = DeckSpecSchema.parse(template.sample);
      expect(spec.slides.length).toBeGreaterThanOrEqual(5);
      expect(spec.slides.length).toBeLessThanOrEqual(7);
      const layouts = new Set(spec.slides.map(slide => slide.layout));
      for (const layout of [
        'cover',
        'metrics',
        'chart',
        'timeline',
        'bullets',
        'closing',
      ])
        expect(layouts, `${template.key} lacks ${layout}`).toContain(layout);

      const { html, slideCount } = renderDeckHtml({
        spec,
        template,
        language: 'zh-CN',
        citations: true,
      });
      expect(slideCount).toBe(spec.slides.length);
      expect(
        html.match(/<section class="slide[^"]*" data-slide/g)
      ).toHaveLength(slideCount);
      expect(html).not.toMatch(EXTERNAL);
      expect(html).toContain(
        `script-src 'sha256-${nodeSha(DECK_SHELL_SCRIPT)}'`
      );
      expect(inlineScripts(html)).toEqual([DECK_SHELL_SCRIPT]);
      for (const intent of ['hero', 'number', 'grow', 'progress', 'sequence'])
        expect(html).toContain(`data-intent="${intent}"`);
      expect(html).toContain('prefers-reduced-motion: reduce');
      expect(html).toContain('data-count=');
      expect(html).toContain('class="deck-');
      expect(html).toMatch(/style="--b:\d+;--i:\d+"/);
      expect(html.match(/is-active/g)?.length).toBeGreaterThan(0);
      if (template.theme.decor) expect(html).toContain('class="decor"');

      const cover = renderDeckCover(spec, template);
      expect(cover.match(/<section[^>]*data-slide/g)).toHaveLength(1);
      expect(cover).toContain('data-chrome="off"');
      expect(cover).toContain('data-static');
      expect(cover).not.toMatch(EXTERNAL);
    });

  it('decor SVGs carry no external references or ids', () => {
    for (const template of DECK_TEMPLATES) {
      expect(template.theme.decor ?? '').not.toMatch(EXTERNAL);
      expect(template.theme.decor ?? '').not.toMatch(/\bid=|<script|\bon\w+=/i);
    }
  });

  it('applies accent override and English labels', () => {
    const template = getDeckTemplate('periodic')!;
    const { html } = renderDeckHtml({
      spec: template.sample,
      template,
      accentColor: '#123456',
      language: 'en',
    });
    expect(html).toContain('--accent:#123456');
    expect(html).toContain('lang="en"');
    expect(html).toContain('Chapter 1');
  });
});

describe('deck rendering safety', () => {
  it('escapes all text, never renders notes, renders citations only on request', () => {
    const spec = hostileSpec();
    for (const template of DECK_TEMPLATES) {
      const { html, slideCount } = renderDeckHtml({
        spec,
        template,
        language: 'zh-CN',
        citations: true,
      });
      expect(slideCount).toBe(6);
      expect(inlineScripts(html)).toEqual([DECK_SHELL_SCRIPT]);
      const body = html.slice(html.indexOf('<main'), html.indexOf('<script>'));
      expect(body).not.toMatch(/<(img|script|iframe|b)[\s>]/i);
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).not.toContain('SECRET-NOTES');
      expect(html).toContain('Source A');
      expect(html).not.toMatch(EXTERNAL);
      // Parsed back, the only executable element is the shell script.
      const tags: string[] = [];
      const walk = (node: any) => {
        if (node.tagName) tags.push(node.tagName);
        for (const attr of node.attrs ?? [])
          expect(attr.name).not.toMatch(/^on|href|src$/i);
        (node.childNodes ?? []).forEach(walk);
      };
      walk(parseFragment(html.slice(html.indexOf('<main'))));
      expect(tags.filter(tag => tag === 'script')).toHaveLength(1);
      expect(tags).not.toContain('img');
      expect(tags).not.toContain('b');
    }
    const { html } = renderDeckHtml({
      spec,
      template: DECK_TEMPLATES[0],
      language: 'zh-CN',
    });
    expect(html).not.toContain('Source A');
  });

  it('marks chart shapes for motion', () => {
    const { html } = renderDeckHtml({
      spec: hostileSpec(),
      template: DECK_TEMPLATES[0],
      language: 'zh-CN',
    });
    expect(html).toMatch(
      /class="deck-bar is-neg" data-series="0" data-index="1"/
    );
    expect(html).toContain('class="deck-bar is-max"');
    expect(html).toContain('class="deck-slice"');
    expect(html).toContain('pathLength="100"');
    const line = renderDeckHtml({
      spec: getDeckTemplate('periodic')!.sample,
      template: DECK_TEMPLATES[0],
      language: 'zh-CN',
    }).html;
    expect(line).toMatch(/class="deck-line"[^>]*pathLength="1"/);
  });

  it('motion css is gated on .is-active and reduced motion', () => {
    for (const style of ['steady', 'launch', 'minimal', 'data'] as const) {
      const css = deckMotionCss(style);
      expect(css).toContain('@media (prefers-reduced-motion: reduce)');
      for (const intent of ['hero', 'sequence', 'number', 'grow', 'progress'])
        expect(css).toContain(`.slide.is-active [data-intent="${intent}"]`);
      const animated = css
        .split('}')
        .filter(
          rule =>
            /animation:(?!none)/.test(rule) && !rule.includes('@keyframes')
        );
      for (const rule of animated) expect(rule).toContain('.slide.is-active');
    }
  });
});

describe('deck sanitizer', () => {
  const clean = (html: string) => sanitizeDeckFragment(html);

  it('keeps safe slide markup and wraps stray content', () => {
    const result = clean(
      '<section class="cover" style="color:red"><h1>标题</h1><p data-intent="hero" aria-label="x">正文 <strong>重点</strong></p></section>stray <em>text</em><section><svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg></section>'
    );
    expect(result.slideCount).toBe(3);
    expect(result.html).toContain(
      '<section class="slide cover" style="color:red" data-slide="">'
    );
    expect(result.html).toContain('<strong>重点</strong>');
    expect(result.html).toContain('data-intent="hero"');
    expect(result.html).toContain('<linearGradient id="g">');
    expect(result.html).toContain('viewBox="0 0 10 10"');
    expect(result.html).toContain('fill="url(#g)"');
    expect(result.html).toContain('stray <em>text</em>');
  });

  it('hoists sections out of wrappers and caps slide count', () => {
    const result = clean(
      `<div class="deck">${'<section><p>x</p></section>'.repeat(45)}</div>`
    );
    expect(result.slideCount).toBe(40);
    expect(result.removed).toBeGreaterThan(0);
  });

  const payloads = [
    '<section><script>alert(1)</script></section>',
    '<section><img src=x onerror=alert(1)></section>',
    '<section><img src="javascript:alert(1)"></section>',
    '<section><svg onload=alert(1)><circle r="1"/></svg></section>',
    '<section><svg><script>alert(1)</script></svg></section>',
    '<section><svg><a href="javascript:alert(1)"><text>x</text></a></svg></section>',
    '<section><svg><use href="data:image/svg+xml,<svg id=x onload=alert(1)>#x"/></svg></section>',
    '<section><svg><animate attributeName="href" to="javascript:alert(1)"/></svg></section>',
    '<section><svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg></section>',
    '<section><iframe srcdoc="<script>alert(1)</script>"></iframe></section>',
    '<section><object data="javascript:alert(1)"></object><embed src="x"></section>',
    '<section><form action="https://evil.example"><input><button>x</button></form></section>',
    '<section><a href="https://evil.example">link</a></section>',
    '<section><link rel=stylesheet href=//evil.example/x.css><meta http-equiv=refresh content="0;url=https://evil.example"><base href="//evil.example/"></section>',
    '<section style="background:url(https://evil.example/x.png)">x</section>',
    '<section style="background:u\\72l(//evil.example)">x</section>',
    '<section style="width:expression(alert(1))">x</section>',
    '<section style="behavior:url(x.htc);-moz-binding:url(x.xml#a)">x</section>',
    '<section><div style="background-image:image-set(\'https://evil.example/a.png\' 1x)">x</div></section>',
    '<section><math><mi xlink:href="javascript:alert(1)">x</mi></math></section>',
    '<section><svg><style>@import "https://evil.example/x.css";</style></svg></section>',
    '<section><noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript></section>',
    '<section><svg></p><style><a id="</style><img src=1 onerror=alert(1)>"></svg></section>',
    '<section><table><caption><svg><mtext><img src=x onerror=alert(1)></mtext></svg></caption></table></section>',
    '<section><div data-x="javascript:alert(1)" title="https://evil.example">x</div></section>',
    '<section><div id="deck-stage">clobber</div><svg><rect id="deck-bar"/></svg></section>',
    '<section><img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></section>',
    '<!--<img src=x onerror=alert(1)>--><section><template><img src=x onerror=alert(1)></template></section>',
  ];

  for (const payload of payloads)
    it(`neutralizes ${payload.slice(0, 70)}`, () => {
      const result = clean(payload);
      expect(result.removed).toBeGreaterThan(0);
      const html = result.html;
      expect(html).not.toMatch(
        /<script|<iframe|<object|<embed|<form|<input|<button|<link|<meta|<base|<style|<foreignObject|<use|<animate|<math|<template|<noscript|<a[\s>]/i
      );
      expect(html).not.toMatch(/\son\w+\s*=/i);
      expect(html).not.toMatch(
        /javascript:|vbscript:|expression\(|-moz-binding|behavior:/i
      );
      expect(html).not.toMatch(EXTERNAL);
      expect(html).not.toMatch(/id="deck-/);
      // Re-sanitizing is a no-op (round-trip stable).
      const again = clean(html);
      expect(again.html).toBe(html);
      expect(again.removed).toBe(0);
      // Parsed result contains no executable element or handler.
      const walk = (node: any) => {
        expect(['script', 'iframe', 'object', 'embed', 'img']).not.toContain(
          node.tagName === 'img' &&
            (node.attrs ?? []).every(
              (a: any) => a.name !== 'src' || a.value.startsWith('data:image/')
            )
            ? 'safe-img'
            : node.tagName
        );
        for (const attr of node.attrs ?? [])
          expect(attr.name).not.toMatch(/^on|href$/i);
        (node.childNodes ?? []).forEach(walk);
      };
      walk(parseFragment(html));
    });

  it('keeps data: images', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    const result = clean(`<section><img src="${src}" alt="a"></section>`);
    expect(result.html).toContain(`src="${src}"`);
    expect(result.removed).toBe(0);
  });

  it('sanitizes stylesheets', () => {
    const css = sanitizeDeckCss(
      [
        '@import url("https://evil.example/a.css");',
        '@import "x.css"',
        '.a{background:url(https://evil.example/x.png)}',
        ".b{background:url('data:image/png;base64,AAAA')}",
        '.c{fill:url(#grad)}',
        '.d{width:expression(alert(1))}',
        '.e{behavior:url(x.htc);-moz-binding:url(x.xml)}',
        '.f{background:\\75\\72\\6c(https://evil.example)}',
        '.g{background:u/**/rl(https://evil.example)}',
        '.h{background-image:image-set("https://evil.example/a.png" 1x)}',
        '.i::after{content:"</style><script>alert(1)</script>"}',
        '.j{background:url(javascript:alert(1))}',
        '@keyframes k{from{opacity:0}}',
        '.slide.is-active .t{animation:k 1s both}',
      ].join('\n')
    );
    expect(css).not.toMatch(
      /@import|expression\(|behavior:|-moz-binding|javascript:|<\/style|<script/i
    );
    expect(css).not.toMatch(/https?:/i);
    expect(css).toContain('url("data:image/png;base64,AAAA")');
    expect(css).toContain('url(#grad)');
    expect(css).toContain('@keyframes k{from{opacity:0}}');
    expect(css).toContain('.slide.is-active .t{animation:k 1s both}');
  });

  it('renders a custom deck through the shell', () => {
    const result = renderCustomDeckHtml({
      title: '自定义',
      html: '<section><h1 data-intent="hero">Hi</h1></section><section onclick="x()"><p>2</p></section>',
      css: '.slide h1{color:var(--accent)} @import "https://x";',
      language: 'zh-CN',
      accentColor: '#ff0000',
    });
    expect(result.slideCount).toBe(2);
    expect(result.removed).toBe(1);
    expect(result.html).toContain(
      '<section class="slide is-active" data-slide="">'
    );
    expect(result.html).toContain('--accent:#ff0000');
    expect(inlineScripts(result.html)).toEqual([DECK_SHELL_SCRIPT]);
    expect(result.html).not.toMatch(EXTERNAL);
  });
});
