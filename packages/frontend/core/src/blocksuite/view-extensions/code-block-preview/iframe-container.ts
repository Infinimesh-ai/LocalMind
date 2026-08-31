export function linkIframe(iframe: HTMLIFrameElement, html: string) {
  iframe.removeAttribute('src');
  iframe.referrerPolicy = 'no-referrer';
  iframe.sandbox.add(
    'allow-pointer-lock',
    'allow-popups',
    'allow-forms',
    'allow-popups-to-escape-sandbox',
    'allow-downloads',
    'allow-scripts'
  );
  iframe.srcdoc = html;
}
