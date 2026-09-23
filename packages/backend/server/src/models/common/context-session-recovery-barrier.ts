import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

import { Prisma, type PrismaClient } from '@prisma/client';

export const CONTEXT_SESSION_RECOVERY_BARRIER_SCHEMA =
  'context-session-recovery-barrier/v1';

export type RecoveryBarrierKeyring = {
  activeKeyVersion: string;
  keys: Record<string, string>;
};

export type ContextSessionRecoveryBarrierManifest = {
  schemaVersion: typeof CONTEXT_SESSION_RECOVERY_BARRIER_SCHEMA;
  barrierId: string;
  sourceInstanceId: string;
  generatedAt: string;
  sessions: Array<{
    sessionId: string;
    ownerUserIdSnapshot: string;
    workspaceIdSnapshot: string | null;
    projectIdSnapshot: string | null;
    contextEpoch: number;
    deletedAt: string;
    requestedAt: string;
  }>;
  memories: Array<{
    id: string;
    status: string;
    sharingStatus: string;
    quarantineReason: string | null;
    revision: number;
    updatedAt: string;
  }>;
  grants: Array<{
    id: string;
    status: string;
    revokedAt: string;
    updatedAt: string;
  }>;
};

export type ContextSessionRecoveryBarrierEnvelope = {
  keyVersion: string;
  fingerprint: string;
  signature: string;
  manifest: ContextSessionRecoveryBarrierManifest;
};

export function readContextSessionRecoveryBarrierKeyring(
  source: NodeJS.ProcessEnv = process.env
): RecoveryBarrierKeyring {
  const activeKeyVersion = source.LOCALMIND_RECOVERY_BARRIER_ACTIVE_KEY_VERSION;
  const serialized = source.LOCALMIND_RECOVERY_BARRIER_KEYS;
  if (!activeKeyVersion || !serialized) {
    throw new Error('CONTEXT_SESSION_RECOVERY_BARRIER_KEYRING_MISSING');
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    throw new Error('CONTEXT_SESSION_RECOVERY_BARRIER_KEYRING_INVALID');
  }
  const keys = Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].length >= 32
    )
  );
  if (!keys[activeKeyVersion]) {
    throw new Error('CONTEXT_SESSION_RECOVERY_BARRIER_ACTIVE_KEY_MISSING');
  }
  return { activeKeyVersion, keys };
}

export function signContextSessionRecoveryBarrier(
  manifest: ContextSessionRecoveryBarrierManifest,
  keyring: RecoveryBarrierKeyring
): ContextSessionRecoveryBarrierEnvelope {
  const serialized = JSON.stringify(manifest);
  return {
    keyVersion: keyring.activeKeyVersion,
    fingerprint: createHash('sha256').update(serialized).digest('hex'),
    signature: createHmac('sha256', keyring.keys[keyring.activeKeyVersion])
      .update(serialized)
      .digest('base64url'),
    manifest,
  };
}

export function verifyContextSessionRecoveryBarrier(
  envelope: ContextSessionRecoveryBarrierEnvelope,
  keyring: RecoveryBarrierKeyring
) {
  if (
    envelope.manifest.schemaVersion !== CONTEXT_SESSION_RECOVERY_BARRIER_SCHEMA
  ) {
    throw new Error('CONTEXT_SESSION_RECOVERY_BARRIER_SCHEMA_INVALID');
  }
  const key = keyring.keys[envelope.keyVersion];
  if (!key) throw new Error('CONTEXT_SESSION_RECOVERY_BARRIER_KEY_UNKNOWN');
  const serialized = JSON.stringify(envelope.manifest);
  const fingerprint = createHash('sha256').update(serialized).digest('hex');
  if (fingerprint !== envelope.fingerprint) {
    throw new Error('CONTEXT_SESSION_RECOVERY_BARRIER_FINGERPRINT_MISMATCH');
  }
  const expected = Buffer.from(
    createHmac('sha256', key).update(serialized).digest('base64url')
  );
  const actual = Buffer.from(envelope.signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error('CONTEXT_SESSION_RECOVERY_BARRIER_SIGNATURE_MISMATCH');
  }
  return {
    barrierId: envelope.manifest.barrierId,
    fingerprint,
    keyVersion: envelope.keyVersion,
    sessionCount: envelope.manifest.sessions.length,
    memoryCount: envelope.manifest.memories.length,
    grantCount: envelope.manifest.grants.length,
  };
}

export async function buildContextSessionRecoveryBarrier(
  db: PrismaClient,
  keyring = readContextSessionRecoveryBarrierKeyring()
) {
  const [deletions, memories, grants] = await Promise.all([
    db.aiSessionDeletion.findMany({
      select: {
        sessionId: true,
        ownerUserIdSnapshot: true,
        workspaceIdSnapshot: true,
        projectIdSnapshot: true,
        contextEpoch: true,
        requestedAt: true,
        session: { select: { deletedAt: true } },
      },
      orderBy: [{ requestedAt: 'asc' }, { sessionId: 'asc' }],
    }),
    db.aiContextMemory.findMany({
      where: {
        OR: [
          { status: { not: 'active' } },
          { sharingStatus: 'quarantined' },
          { quarantinedAt: { not: null } },
        ],
      },
      select: {
        id: true,
        status: true,
        sharingStatus: true,
        quarantineReason: true,
        revision: true,
        updatedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    db.aiContextProjectGrant.findMany({
      where: { status: 'revoked', revokedAt: { not: null } },
      select: { id: true, status: true, revokedAt: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
  ]);
  const generatedAt = new Date();
  return signContextSessionRecoveryBarrier(
    {
      schemaVersion: CONTEXT_SESSION_RECOVERY_BARRIER_SCHEMA,
      barrierId: randomUUID(),
      sourceInstanceId: process.env.LOCALMIND_INSTANCE_ID ?? 'local',
      generatedAt: generatedAt.toISOString(),
      sessions: deletions.flatMap(deletion =>
        deletion.session.deletedAt
          ? [
              {
                sessionId: deletion.sessionId,
                ownerUserIdSnapshot: deletion.ownerUserIdSnapshot,
                workspaceIdSnapshot: deletion.workspaceIdSnapshot,
                projectIdSnapshot: deletion.projectIdSnapshot,
                contextEpoch: deletion.contextEpoch,
                deletedAt: deletion.session.deletedAt.toISOString(),
                requestedAt: deletion.requestedAt.toISOString(),
              },
            ]
          : []
      ),
      memories: memories.map(memory => ({
        ...memory,
        updatedAt: memory.updatedAt.toISOString(),
      })),
      grants: grants.map(grant => {
        if (!grant.revokedAt) {
          throw new Error('LOCALMIND_RECOVERY_BARRIER_GRANT_INVALID');
        }
        return {
          ...grant,
          revokedAt: grant.revokedAt.toISOString(),
          updatedAt: grant.updatedAt.toISOString(),
        };
      }),
    },
    keyring
  );
}

export async function writeContextSessionRecoveryBarrier(
  path: string,
  envelope: ContextSessionRecoveryBarrierEnvelope
) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(envelope), {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

export async function readContextSessionRecoveryBarrier(path: string) {
  return JSON.parse(
    await readFile(path, 'utf8')
  ) as ContextSessionRecoveryBarrierEnvelope;
}

export async function applyContextSessionRecoveryBarrier(
  db: PrismaClient,
  envelope: ContextSessionRecoveryBarrierEnvelope,
  keyring = readContextSessionRecoveryBarrierKeyring()
) {
  const verified = verifyContextSessionRecoveryBarrier(envelope, keyring);
  return await db.$transaction(
    async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('context_session_recovery_barrier'))`;
      const existing = await tx.contextSessionRecoveryBarrierReceipt.findUnique(
        {
          where: { id: verified.barrierId },
        }
      );
      if (existing) {
        if (existing.fingerprint !== verified.fingerprint) {
          throw new Error('CONTEXT_SESSION_RECOVERY_BARRIER_ID_CONFLICT');
        }
        return { ...verified, applied: false };
      }

      for (const barrier of envelope.manifest.sessions) {
        const session = await tx.aiSession.findUnique({
          where: { id: barrier.sessionId },
          select: {
            id: true,
            userId: true,
            workspaceId: true,
            selectedContextProjectId: true,
            contextEpoch: true,
          },
        });
        if (!session) continue;
        const contextEpoch = Math.max(
          session.contextEpoch,
          barrier.contextEpoch
        );
        await tx.aiSession.update({
          where: { id: session.id },
          data: {
            deletedAt: new Date(barrier.deletedAt),
            contextEpoch,
            pinned: false,
            title: null,
            allowMemoryCapture: false,
            memoryCaptureRevision: { increment: 1 },
          },
        });
        const currentDeletion = await tx.aiSessionDeletion.findUnique({
          where: { sessionId: session.id },
        });
        if (!currentDeletion) {
          await tx.aiSessionDeletion.create({
            data: {
              sessionId: session.id,
              ownerUserIdSnapshot: barrier.ownerUserIdSnapshot,
              workspaceIdSnapshot: barrier.workspaceIdSnapshot,
              projectIdSnapshot: barrier.projectIdSnapshot,
              contextEpoch,
              status: 'requested',
              requestFingerprint: createHash('sha256')
                .update(
                  JSON.stringify({
                    operation: 'recovery-barrier-session-delete/v1',
                    barrierId: verified.barrierId,
                    sessionId: session.id,
                    contextEpoch,
                  })
                )
                .digest('hex'),
              progress: {
                onlineContent: 'pending',
                sharedProjectMemory: 'preserved',
                recoveryBarrierId: verified.barrierId,
              },
              requestedAt: new Date(barrier.requestedAt),
            },
          });
        } else {
          await tx.aiSessionDeletion.update({
            where: { id: currentDeletion.id },
            data: {
              contextEpoch,
              status: currentDeletion.status === 'held' ? 'held' : 'requested',
              progress: {
                onlineContent: 'pending',
                sharedProjectMemory: 'preserved',
                recoveryBarrierId: verified.barrierId,
              },
              resultCounts: {},
              receiptFingerprint: null,
              completedAt: null,
              nextAttemptAt: new Date(),
              workerLeaseId: null,
              workerLeaseExpiresAt: null,
              failureCode: null,
              failureMessage: null,
            },
          });
        }
      }

      for (const barrier of envelope.manifest.memories) {
        await tx.aiContextMemory.updateMany({
          where: { id: barrier.id, revision: { lte: barrier.revision } },
          data: {
            status: barrier.status,
            sharingStatus: barrier.sharingStatus,
            quarantineReason: barrier.quarantineReason,
            quarantinedAt:
              barrier.sharingStatus === 'quarantined' ||
              barrier.quarantineReason
                ? new Date(barrier.updatedAt)
                : undefined,
            revision: { increment: 1 },
          },
        });
      }

      for (const barrier of envelope.manifest.grants) {
        await tx.aiContextProjectGrant.updateMany({
          where: { id: barrier.id },
          data: {
            status: 'revoked',
            revokedAt: new Date(barrier.revokedAt),
          },
        });
      }

      await tx.contextSessionRecoveryBarrierReceipt.create({
        data: {
          id: verified.barrierId,
          fingerprint: verified.fingerprint,
          keyVersion: verified.keyVersion,
          signature: envelope.signature,
          sessionCount: verified.sessionCount,
          memoryCount: verified.memoryCount,
          grantCount: verified.grantCount,
          generatedAt: new Date(envelope.manifest.generatedAt),
        },
      });
      return { ...verified, applied: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export type ContextSessionRecoveryBarrierMode = 'export' | 'verify' | 'apply';

export async function executeContextSessionRecoveryBarrier(
  db: PrismaClient,
  mode: ContextSessionRecoveryBarrierMode,
  path: string,
  keyring = readContextSessionRecoveryBarrierKeyring()
) {
  if (!isAbsolute(path)) {
    throw new Error('CONTEXT_SESSION_RECOVERY_BARRIER_PATH_NOT_ABSOLUTE');
  }
  if (mode === 'export') {
    const envelope = await buildContextSessionRecoveryBarrier(db, keyring);
    await writeContextSessionRecoveryBarrier(path, envelope);
    return {
      mode,
      path,
      ...verifyContextSessionRecoveryBarrier(envelope, keyring),
    };
  }

  const envelope = await readContextSessionRecoveryBarrier(path);
  if (mode === 'verify') {
    return {
      mode,
      path,
      ...verifyContextSessionRecoveryBarrier(envelope, keyring),
    };
  }
  return {
    mode,
    path,
    ...(await applyContextSessionRecoveryBarrier(db, envelope, keyring)),
  };
}
