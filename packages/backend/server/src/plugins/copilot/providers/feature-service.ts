import { Injectable } from '@nestjs/common';

import { Config, OnEvent } from '../../../base';
import { ServerFeature, ServerService } from '../../../core';

@Injectable()
export class CopilotFeatureService {
  constructor(
    private readonly config: Config,
    private readonly server: ServerService
  ) {}

  @OnEvent('config.init')
  onConfigInit() {
    this.sync();
  }

  @OnEvent('config.changed')
  onConfigChanged(event: Events['config.changed']) {
    if ('copilot' in event.updates) {
      this.sync();
    }
  }

  private sync() {
    if (this.config.copilot.enabled) {
      this.server.enableFeature(ServerFeature.Copilot);
    } else {
      this.server.disableFeature(ServerFeature.Copilot);
    }
  }
}
