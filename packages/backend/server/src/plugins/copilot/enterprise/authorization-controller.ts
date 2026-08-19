import { Controller, Get, HttpStatus, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Throttle } from '../../../base';
import { CurrentUser } from '../../../core/auth';
import { EnterpriseAuthorizationWorker } from './authorization-worker';

@Controller('/api/copilot/enterprise/authorization')
export class EnterpriseAuthorizationController {
  constructor(private readonly worker: EnterpriseAuthorizationWorker) {}

  @Get('/:sessionId/qrcode')
  @Throttle('default')
  async qrCode(
    @CurrentUser() user: CurrentUser,
    @Param('sessionId') sessionId: string,
    @Res() response: Response
  ) {
    const qrCode = await this.worker.readQrCode(sessionId, user.id);
    if (!qrCode) {
      response.status(HttpStatus.NOT_FOUND).send();
      return;
    }
    response.set({
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': 'inline; filename="enterprise-authorization.png"',
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
    });
    response.status(HttpStatus.OK).send(qrCode);
  }
}
