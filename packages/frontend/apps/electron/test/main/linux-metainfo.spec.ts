import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { renderLinuxMetainfo } from '../../scripts/linux-metainfo';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const source = readFileSync(
  path.join(__dirname, '../../resources/localmind.metainfo.xml'),
  'utf8'
);

describe('LocalMind Linux metadata', () => {
  it('keeps stable application identifiers', () => {
    const output = renderLinuxMetainfo(
      source,
      'ai.infinimesh.localmind',
      'localmind'
    );

    expect(output).toContain('<id>ai.infinimesh.localmind</id>');
    expect(output).toContain(
      '<launchable type="desktop-id">ai.infinimesh.localmind.desktop</launchable>'
    );
    expect(output).toContain(
      '<mediatype>x-scheme-handler/localmind</mediatype>'
    );
  });

  it('isolates canary application and protocol identifiers', () => {
    const output = renderLinuxMetainfo(
      source,
      'ai.infinimesh.localmind.canary',
      'localmind-canary'
    );

    expect(output).toContain('<id>ai.infinimesh.localmind.canary</id>');
    expect(output).toContain(
      '<launchable type="desktop-id">ai.infinimesh.localmind.canary.desktop</launchable>'
    );
    expect(output).toContain(
      '<mediatype>x-scheme-handler/localmind-canary</mediatype>'
    );
    expect(output).not.toContain('<id>ai.infinimesh.localmind</id>');
    expect(output).not.toContain('x-scheme-handler/affine');
  });
});
