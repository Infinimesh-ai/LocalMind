import type { ReportDeckApi } from '@affine/core/modules/report-decks/types';
import { vi } from 'vitest';

export const apiState: { api: ReportDeckApi | null } = { api: null };
export const useReportDeckApi = () => {
  if (!apiState.api) throw new Error('api not mocked');
  return apiState.api;
};
export const absoluteShareUrl = (url: string) =>
  new URL(url, 'https://app.local').toString();
export const openDeckShare = vi.fn();
export const fetchSharedDeckHtml = vi.fn();
export const sharedDeckHtmlUrl = (
  baseUrl: string,
  shareId: string,
  download?: boolean
) =>
  `${baseUrl}/api/deck-shares/${shareId}/html${download ? '?download=1' : ''}`;
