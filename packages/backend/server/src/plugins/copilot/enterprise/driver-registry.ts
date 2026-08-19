import { Injectable } from '@nestjs/common';
import { EnterpriseProvider } from '@prisma/client';

import { DingTalkCliDriver } from './providers/dingtalk';
import { LarkCliDriver } from './providers/lark';
import { WeComCliDriver } from './providers/wecom';
import type { EnterpriseCliDriver } from './types';

@Injectable()
export class EnterpriseCliDriverRegistry {
  private readonly drivers: Map<EnterpriseProvider, EnterpriseCliDriver>;

  constructor(
    wecom: WeComCliDriver,
    lark: LarkCliDriver,
    dingtalk: DingTalkCliDriver
  ) {
    this.drivers = new Map<EnterpriseProvider, EnterpriseCliDriver>();
    this.drivers.set(EnterpriseProvider.WECOM, wecom);
    this.drivers.set(EnterpriseProvider.LARK, lark);
    this.drivers.set(EnterpriseProvider.DINGTALK, dingtalk);
  }

  get(provider: EnterpriseProvider) {
    const driver = this.drivers.get(provider);
    if (!driver) {
      throw new Error(`Enterprise CLI driver is not registered: ${provider}`);
    }
    return driver;
  }
}
