import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { ResourceConflict } from '../base';
import { BaseModel } from './base';
@Injectable()
export class WorkspaceLifecycleModel extends BaseModel {
  async receipt(
    input: { workspaceId: string; actorId: string; requestKey: string },
    hash: string
  ) {
    const receipt = await this.db.workspaceLifecycleOperation.findUnique({
      where: { workspaceId_actorId_requestKey: input },
    });
    if (receipt && receipt.requestHash !== hash)
      throw new ResourceConflict(
        'Request key was used for another lifecycle operation'
      );
    return receipt;
  }
  async record(input: {
    workspaceId: string;
    actorId: string;
    resourceId: string;
    kind: string;
    action: string;
    requestKey: string;
    requestHash: string;
    result: Prisma.InputJsonValue;
  }) {
    await this.db.workspaceLifecycleOperation.create({ data: input });
    await this.db.workspaceNativeOutbox.create({
      data: { workspaceId: input.workspaceId },
    });
  }
}
