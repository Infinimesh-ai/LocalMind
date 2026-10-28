import { createHash } from 'node:crypto';

import {
  type AiContextMemory,
  type AiContextMemoryEvent,
  Prisma,
  type PrismaClient,
} from '@prisma/client';

import { deriveContextMemoryFactKey } from './context-memory-fact-key';

const VERSION = 'legacy-fact-key-repair/v1';
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity = (row: AiContextMemory) =>
  JSON.stringify([
    row.scope,
    row.scope === 'project' ? null : row.ownerUserId,
    row.workspaceId,
    row.projectId,
    row.docId,
    row.sharingStatus,
    row.contractVersion,
  ]);

function reliableKey(row: AiContextMemory) {
  // Only declarative, single-fact statements can be repaired automatically.
  if (
    /[?？\n;；]/u.test(row.content) ||
    /(?:吗|什么|多少|是否|如何|不要|忘记|删除|忽略)/u.test(row.content)
  )
    return null;
  const key = deriveContextMemoryFactKey(row.content);
  return key?.startsWith('fact:') && /(?:代号|codename)$/iu.test(key)
    ? key
    : null;
}

export function planLegacyMemoryRepair(
  rows: AiContextMemory[],
  events: AiContextMemoryEvent[],
  now = new Date()
) {
  const decisions = rows
    .filter(row => row.factKey === 'project:codename')
    .map(row => {
      const newKey = reliableKey(row);
      let reason = newKey ? 'key_only' : 'ambiguous_or_project_codename';
      let restore = false;
      if (newKey && row.status === 'superseded') {
        const peers = rows.filter(other => identity(other) === identity(row));
        const children = peers.filter(other => other.supersedesId === row.id);
        const laterFact = peers.some(
          other =>
            other.id !== row.id &&
            (other.factKey === newKey || reliableKey(other) === newKey) &&
            (other.status === 'active' || other.createdAt >= row.createdAt)
        );
        const explicitRemoval = events.some(
          event =>
            event.memoryId === row.id &&
            ['DELETE', 'WITHDRAW', 'UNDO'].includes(event.operation)
        );
        const overwrite =
          children.length === 1 &&
          events.some(
            event =>
              event.operation === 'UPDATE' &&
              event.previousMemoryId === row.id &&
              event.memoryId === children[0].id &&
              !event.undoneAt
          );
        const otherKey =
          children.length === 1
            ? deriveContextMemoryFactKey(children[0].content)
            : null;
        if (row.scope === 'project') reason = 'project_source_review_required';
        else if (row.quarantinedAt || (row.expiresAt && row.expiresAt <= now))
          reason = 'ineligible_lifecycle';
        else if (laterFact || explicitRemoval)
          reason = 'newer_fact_or_user_removal';
        else if (!overwrite || !otherKey || otherKey === newKey)
          reason = 'overwrite_not_proven';
        else {
          restore = true;
          reason = 'independent_fact_overwritten';
        }
      } else if (newKey && row.status !== 'active')
        reason = 'preserve_terminal_or_disabled';
      return {
        id: row.id,
        revision: row.revision,
        oldKey: row.factKey,
        newKey,
        status: row.status,
        restore,
        reason,
      };
    });
  const keys = new Map(
    rows.map(row => [
      row.id,
      decisions.find(d => d.id === row.id)?.newKey ?? row.factKey,
    ])
  );
  const edges = rows
    .filter(
      row =>
        row.supersedesId &&
        (keys.get(row.id) !== row.factKey ||
          keys.get(row.supersedesId) !==
            rows.find(parent => parent.id === row.supersedesId)?.factKey)
    )
    .map(row => ({
      id: row.id,
      previousId: row.supersedesId ?? '',
      retain: keys.get(row.id) === keys.get(row.supersedesId ?? ''),
    }));
  return {
    version: VERSION,
    fingerprint: digest({
      rows: rows
        .map(row => ({ ...row, content: digest(row.content) }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      events: events
        .map(event => ({ ...event }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      decisions,
      edges,
    }),
    decisions,
    edges,
  };
}

export async function repairLegacyMemoryKeys(
  db: PrismaClient,
  options: { expectedFingerprint?: string; actorId?: string } = {}
) {
  return db.$transaction(
    async tx => {
      const candidates = await tx.aiContextMemory.findMany({
        where: { kind: 'auto_memory', factKey: 'project:codename' },
        orderBy: { id: 'asc' },
        take: 501,
      });
      if (candidates.length > 500)
        throw new Error(
          'Repair scope exceeds 500 candidates; partition before applying'
        );
      const rows = candidates.length
        ? await tx.aiContextMemory.findMany({
            where: {
              kind: 'auto_memory',
              OR: candidates.map(row => ({
                scope: row.scope,
                ownerUserId: row.ownerUserId,
                workspaceId: row.workspaceId,
                projectId: row.projectId,
                docId: row.docId,
              })),
            },
            orderBy: { id: 'asc' },
            take: 10_001,
          })
        : [];
      if (rows.length > 10_000)
        throw new Error('Repair scope exceeds safe history limit');
      const events = await tx.aiContextMemoryEvent.findMany({
        where: {
          OR: [
            { memoryId: { in: rows.map(row => row.id) } },
            { previousMemoryId: { in: rows.map(row => row.id) } },
          ],
        },
        orderBy: { id: 'asc' },
        take: 20_001,
      });
      if (events.length > 20_000)
        throw new Error('Repair scope exceeds safe audit limit');
      const plan = planLegacyMemoryRepair(rows, events);
      if (!options.expectedFingerprint)
        return { ...plan, applied: 0, restored: 0 };
      if (plan.fingerprint !== options.expectedFingerprint)
        throw new Error(
          'Memory history changed; inspect a fresh plan before applying'
        );
      if (!options.actorId) throw new Error('Repair actor is required');
      // Detach affected edges only inside this transaction. Retain original UPDATE
      // events as immutable provenance, then reconnect only same-fact chains.
      for (const edge of plan.edges) {
        const row = rows.find(row => row.id === edge.id);
        if (!row) throw new Error('Repair edge source is missing');
        await tx.aiContextMemory.update({
          where: { id: edge.id },
          data: { supersedesId: null, updatedAt: row.updatedAt },
        });
      }
      let applied = 0,
        restored = 0;
      for (const decision of plan.decisions) {
        const detached = plan.edges.some(
          edge => edge.id === decision.id && !edge.retain
        );
        if (!decision.newKey && !detached) continue;
        const row = rows.find(row => row.id === decision.id);
        if (!row) throw new Error('Repair source is missing');
        // A deleted source conversation is never a basis for restoring a fact.
        if (
          decision.restore &&
          row.sourceSessionId &&
          !(await tx.aiSession.findFirst({
            where: { id: row.sourceSessionId, deletedAt: null },
          }))
        ) {
          decision.restore = false;
          decision.reason = 'source_conversation_deleted';
        }
        const result = await tx.aiContextMemory.updateMany({
          where: {
            id: row.id,
            revision: row.revision,
            updatedAt: row.updatedAt,
            status: row.status,
            factKey: row.factKey,
          },
          data: {
            factKey: decision.newKey ?? row.factKey,
            revision: { increment: 1 },
            ...(decision.restore ? { status: 'active', validUntil: null } : {}),
          },
        });
        if (result.count !== 1)
          throw new Error('Memory changed while applying repair');
        await tx.aiContextMemoryEvent.create({
          data: {
            ownerUserId: row.ownerUserId,
            workspaceId: row.workspaceId,
            projectId: row.projectId,
            sourceSessionId: row.sourceSessionId,
            operation: 'UPDATE',
            memoryId: row.id,
            previousMemoryId: row.id,
            factKey: decision.newKey ?? row.factKey,
            explicit: false,
            reasonCode: `legacy_key_repair_${detached && !decision.newKey ? 'detach_independent_fact' : decision.reason}`,
            writerVersion: VERSION,
            decisionFingerprint: digest([VERSION, plan.fingerprint, row.id]),
            actorIdSnapshot: options.actorId,
            memoryRevision: row.revision + 1,
          },
        });
        applied++;
        if (decision.restore) restored++;
      }
      for (const edge of plan.edges.filter(edge => edge.retain)) {
        await tx.aiContextMemory.update({
          where: { id: edge.id },
          data: { supersedesId: edge.previousId },
        });
      }
      return { ...plan, applied, restored };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30_000,
    }
  );
}
