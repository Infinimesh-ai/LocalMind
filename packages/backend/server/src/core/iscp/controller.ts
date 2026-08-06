import { Body, Controller, Get, Header, Param, Post } from '@nestjs/common';

import { Public } from '../auth';
import { sparkClawInstallScript } from './install-script';
import { IscpService } from './service';

@Controller('/api/iscp')
export class IscpController {
  constructor(private readonly service: IscpService) {}

  @Public()
  @Get('/install.sh')
  @Header('Content-Type', 'text/x-shellscript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  installScript() {
    return sparkClawInstallScript;
  }

  @Public()
  @Get('/pairings/:token/bootstrap')
  @Header('Cache-Control', 'no-store')
  async bootstrap(@Param('token') token: string) {
    const pairing = await this.service.getPairing(token);
    return {
      domain_id: this.service.domainId,
      device_id: pairing.deviceId,
      expires_at: pairing.expiresAt,
    };
  }

  @Public()
  @Post('/pairings/:token/enroll')
  @Header('Cache-Control', 'no-store')
  async enroll(
    @Param('token') token: string,
    @Body() body: { request?: unknown }
  ) {
    return await this.service.enroll(token, body?.request);
  }
}
