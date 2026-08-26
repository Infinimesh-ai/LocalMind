import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';

const DELETE_FLAG = '$$DELETED';
const LINK_TYPES = new Set(['doc', 'tag', 'collection']);
const LINK_FIELDS = ['parentId', 'data', 'type', 'index'];

function usage() {
  console.log(`Usage:
  node scripts/repair-folder-links.mjs --workspace-id <id> [--apply]

Options:
  --workspace-id <id>  Workspace whose folders table should be checked
  --apply              Append a repair update; without this flag, dry-run only
  --help               Show this help`);
}

function parseArgs(argv) {
  const args = { apply: false, workspaceId: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--workspace-id') {
      args.workspaceId = argv[++i] ?? '';
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.workspaceId) {
    throw new Error('--workspace-id is required');
  }
  return args;
}

function mapValue(type, field) {
  return Y.Map.prototype.get.call(type, field);
}

function activeFolderLinks(doc) {
  const links = [];
  for (const type of doc.share.values()) {
    if (mapValue(type, DELETE_FLAG) === true) continue;
    const id = mapValue(type, 'id');
    const parentId = mapValue(type, 'parentId');
    const linkType = mapValue(type, 'type');
    const data = mapValue(type, 'data');
    const index = mapValue(type, 'index');
    if (
      typeof id !== 'string' ||
      typeof parentId !== 'string' ||
      typeof linkType !== 'string' ||
      typeof data !== 'string' ||
      !LINK_TYPES.has(linkType)
    ) {
      continue;
    }
    links.push({
      id,
      parentId,
      type: linkType,
      data,
      index: typeof index === 'string' ? index : '',
      ymap: type,
    });
  }
  return links;
}

function duplicateGroups(doc) {
  const byTarget = new Map();
  for (const link of activeFolderLinks(doc)) {
    const key = JSON.stringify([link.parentId, link.type, link.data]);
    const group = byTarget.get(key);
    if (group) group.push(link);
    else byTarget.set(key, [link]);
  }

  return [...byTarget.values()]
    .filter(group => group.length > 1)
    .map(group =>
      group.sort(
        (left, right) =>
          left.index.length - right.index.length ||
          left.id.localeCompare(right.id)
      )
    )
    .sort((left, right) => left[0].id.localeCompare(right[0].id));
}

async function loadFoldersDoc(prisma, workspaceId, docId) {
  const [snapshot, updates] = await Promise.all([
    prisma.snapshot.findFirst({
      where: { workspaceId, id: docId },
      select: { blob: true },
    }),
    prisma.update.findMany({
      where: { workspaceId, id: docId },
      orderBy: { createdAt: 'asc' },
      select: { blob: true },
    }),
  ]);
  if (!snapshot && updates.length === 0) {
    throw new Error(`Folders document not found: ${docId}`);
  }

  const doc = new Y.Doc({ guid: docId });
  if (snapshot) Y.applyUpdate(doc, snapshot.blob);
  for (const update of updates) Y.applyUpdate(doc, update.blob);
  return doc;
}

function report(groups, mode) {
  const duplicateCount = groups.reduce(
    (count, group) => count + group.length - 1,
    0
  );
  console.log(
    JSON.stringify({
      mode,
      duplicateGroups: groups.length,
      duplicateRelations: duplicateCount,
    })
  );
  for (const group of groups) {
    const [keep, ...remove] = group;
    console.log(
      JSON.stringify({
        parentId: keep.parentId,
        type: keep.type,
        data: keep.data,
        keep: { id: keep.id, index: keep.index },
        remove: remove.map(link => ({ id: link.id, index: link.index })),
      })
    );
  }
  return duplicateCount;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const docId = `db$${args.workspaceId}$folders`;
  try {
    const doc = await loadFoldersDoc(prisma, args.workspaceId, docId);
    const groups = duplicateGroups(doc);
    const duplicateCount = report(groups, args.apply ? 'apply' : 'dry-run');
    if (!args.apply || duplicateCount === 0) return;

    const stateVector = Y.encodeStateVector(doc);
    doc.transact(() => {
      for (const [, ...remove] of groups) {
        for (const link of remove) {
          for (const field of LINK_FIELDS) {
            Y.Map.prototype.delete.call(link.ymap, field);
          }
          Y.Map.prototype.set.call(link.ymap, DELETE_FLAG, true);
        }
      }
    }, 'repair-folder-links');
    const blob = Buffer.from(Y.encodeStateAsUpdate(doc, stateVector));

    await prisma.update.create({
      data: {
        workspaceId: args.workspaceId,
        id: docId,
        blob,
        createdAt: new Date(),
      },
    });

    const remaining = duplicateGroups(doc);
    if (remaining.length > 0) {
      throw new Error(
        'Repair update left duplicate folder relations in memory'
      );
    }
    console.log(
      JSON.stringify({
        applied: true,
        removedRelations: duplicateCount,
        updateBytes: blob.byteLength,
      })
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(
    `[repair-folder-links] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
