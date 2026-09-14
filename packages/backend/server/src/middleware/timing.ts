import { NextFunction, Request, Response } from 'express';
import onHeaders from 'on-headers';

import { LocalMindLogService } from '../base/logger';

export const serverTimingAndCache = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  req.res = res;
  const startedAt = Date.now();
  res.once('finish', () => {
    LocalMindLogService.emit({
      eventName: 'http.request.completed',
      severity: res.statusCode >= 500 ? 'error' : 'info',
      status: res.statusCode >= 400 ? 'failed' : 'success',
      durationMs: Date.now() - startedAt,
      metadata: {
        method: req.method,
        path: req.path,
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
