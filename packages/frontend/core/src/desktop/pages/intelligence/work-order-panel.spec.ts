// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest';

import {
  persistWorkOrderTextDraft,
  readWorkOrderTextDraft,
  updateWorkOrderTextValues,
} from './work-order-panel';

describe('work-order delivery text state', () => {
  test('stores the synchronously captured input value without mutating prior state', () => {
    const prior = { existing: 'kept' };

    expect(updateWorkOrderTextValues(prior, 'summary', 'verified')).toEqual({
      existing: 'kept',
      summary: 'verified',
    });
    expect(prior).toEqual({ existing: 'kept' });
  });

  test('restores a failed delivery draft by work-order id and clears it after success', () => {
    persistWorkOrderTextDraft('order-a', {
      summary: 'preserved across reload',
    });

    expect(readWorkOrderTextDraft('order-a')).toEqual({
      summary: 'preserved across reload',
    });
    expect(readWorkOrderTextDraft('order-b')).toEqual({});

    persistWorkOrderTextDraft('order-a', {});
    expect(readWorkOrderTextDraft('order-a')).toEqual({});
  });

  test('ignores malformed or non-string local draft entries', () => {
    localStorage.setItem(
      'localmind:work-order-delivery-draft:malformed',
      JSON.stringify({ valid: 'kept', invalid: 42 })
    );

    expect(readWorkOrderTextDraft('malformed')).toEqual({ valid: 'kept' });

    localStorage.setItem(
      'localmind:work-order-delivery-draft:invalid-json',
      '{broken'
    );
    expect(readWorkOrderTextDraft('invalid-json')).toEqual({});
  });
});
