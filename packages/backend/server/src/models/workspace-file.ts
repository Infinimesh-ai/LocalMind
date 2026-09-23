import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { ResourceConflict } from '../base';
import { BaseModel } from './base';

@Injectable()
export class WorkspaceFileModel extends BaseModel {
  async create(input: Prisma.WorkspaceFileUncheckedCreateInput) {
    await this.db.workspaceFile.createMany({
      data: [input],
      skipDuplicates: true,
    });
    const saved = await this.db.workspaceFile.findUniqueOrThrow({
      where: {
        workspaceId_requestKey: {
          workspaceId: input.workspaceId,
          requestKey: input.requestKey,
        },
      },
    });
    if (
      saved.requestFingerprint !== input.requestFingerprint ||
      saved.createdBy !== input.createdBy
    )
      throw new ResourceConflict(
        'File creation request was reused with different content'
      );
    return saved;
  }

  list(workspaceId: string, cursor?: string) {
    return this.db.workspaceFile.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 101,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  get(workspaceId: string, id: string) {
    return this.db.workspaceFile.findFirstOrThrow({
      where: { workspaceId, id },
    });
  }
}
