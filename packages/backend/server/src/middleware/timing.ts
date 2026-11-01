import { NextFunction, Request, Response } from 'express';
import onHeaders from 'on-headers';

import { LocalMindLogService, SLOW_REQUEST_THRESHOLD_MS } from '../base/logger';

// GraphQL completions are recorded by the GraphQL logger plugin, log uploads
// would otherwise log themselves and /info is the container health probe; only
// their failures and slow responses stay.
const SUCCESS_LOGGED_ELSEWHERE = new Set([
  '/graphql',
  '/api/logs/batch',
  '/info',
]);

export function shouldPersistHttpCompletion(
  path: string,
  statusCode: number,
  durationMs: number
) {
  return (
    statusCode >= 400 ||
    durationMs >= SLOW_REQUEST_THRESHOLD_MS ||
    !SUCCESS_LOGGED_ELSEWHERE.has(path)
  );
}

export const serverTimingAndCache = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  req.res = res;
  const startedAt = Date.now();
  // Mounted routers rewrite req.path (GraphQL appears as "/"); keep the
  // original path without its query string.
  const path = req.originalUrl.split('?', 1)[0] || '/';
  res.once('finish', () => {
    const durationMs = Date.now() - startedAt;
    if (!shouldPersistHttpCompletion(path, res.statusCode, durationMs)) return;
    LocalMindLogService.emit({
      eventName: 'http.request.completed',
      severity: res.statusCode >= 500 ? 'error' : 'info',
      status: res.statusCode >= 400 ? 'failed' : 'success',
      durationMs,
      metadata: {
        method: req.method,
        path,
        statusCode: res.statusCode,
      },
    });
  });
  const now = process.hrtime();

  onHeaders(res, () => {
    const delta = process.hrtime(now);
    const costInMilliseconds = (delta[0] + delta[1] / 1e9) * 1000;

    const serverTiming = res.getHeader('Server-Timing') as string | undefined;
    const serverTimingValue = `${
      serverTiming ? `${serverTiming}, ` : ''
    }affine-server;dur=${costInMilliseconds}`;

    res.setHeader('Server-Timing', serverTimingValue);
  });

  next();
};
