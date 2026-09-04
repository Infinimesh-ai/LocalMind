import { describe, expect, test } from 'vitest';

import { docxRunContentText, isDocxSemanticState } from './types';

describe('Office DOCX client state', () => {
  test('renders logical run content with stable offsets', () => {
    expect(
      docxRunContentText([
        { type: 'text', text: 'A' },
        { type: 'tab' },
        { type: 'noBreakHyphen' },
        { type: 'softHyphen' },
        { type: 'break' },
        { type: 'object', objectType: 'drawing' },
      ])
    ).toBe('A\t\u2011\u00ad\n');
  });

  test('accepts only the supported semantic schema', () => {
    const state = {
      schemaVersion: 'localmind-office-docx-state/v1',
      modelVersion: 'localmind-office-docx-model/v1',
      body: [],
      styles: [],
      sections: [],
      package: {},
      compatibility: {},
      stats: {},
    };
    expect(isDocxSemanticState(state)).toBe(true);
    expect(isDocxSemanticState({ ...state, schemaVersion: 'future' })).toBe(
      false
    );
  });
});
