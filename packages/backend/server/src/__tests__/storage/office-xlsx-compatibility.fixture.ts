import { randomUUID } from 'node:crypto';

import { createLegacyXlsxCompatibilityFixture } from '@localmind/office/testing';
import {
  openXlsxPackage,
  readXlsxSemanticState,
  XLSX_MIME_TYPE,
} from '@localmind/office/xlsx';

import { officeFingerprint } from '../../core/office/evidence';
import { OfficeImportService } from '../../core/office/import-service';
import { OfficeResourceStorage } from '../../core/office/resource-storage';
import type { OfficeOwner } from '../../models/office-owner';
import { officeOwnerToInput } from '../../models/office-owner';
import type { TestingApp } from '../utils';

export async function legacyXlsxRevisions(
  app: TestingApp,
  owner: OfficeOwner,
  actorId: string,
  title = 'QA122 历史预算.xlsx'
) {
  const storage = app.get(OfficeResourceStorage);
  const bytes = Buffer.from(createLegacyXlsxCompatibilityFixture());
  const key = await storage.putGenerated(
    owner,
    actorId,
    bytes,
    XLSX_MIME_TYPE,
    async () => {}
  );
  const first = await app.get(OfficeImportService).import({
    ...officeOwnerToInput(owner),
    actorId,
    sourceBlobKey: key,
    generatedBytes: bytes,
    title,
    sourceFileName: title,
    importIdempotencyKey: randomUUID(),
  });
  const pkg = openXlsxPackage(bytes);
  const path = 'xl/worksheets/sheet1.xml';
  const xml = Buffer.from(pkg.requirePart(path))
    .toString()
    .replace('<v>12</v>', '<v>20</v>');
  const current = Buffer.from(pkg.write(new Map([[path, Buffer.from(xml)]])));
  const currentKey = await storage.putGenerated(
    owner,
    actorId,
    current,
    XLSX_MIME_TYPE,
    async () => {}
  );
  const state = Buffer.from(
    JSON.stringify(readXlsxSemanticState(openXlsxPackage(current)))
  );
  const stateKey = await storage.putGenerated(
    owner,
    actorId,
    state,
    'application/json',
    async () => {}
  );
  const second = await app.models.officeArtifact.appendRevision({
    ...officeOwnerToInput(owner),
    actorId,
    artifactId: first.artifact.id,
    origin: 'user',
    expectedParentRevisionId: first.revision.id,
    idempotencyKey: randomUUID(),
    idempotencyFingerprint: officeFingerprint(current),
    package: {
      key: currentKey,
      mimeType: XLSX_MIME_TYPE,
      byteSize: current.length,
      fingerprint: officeFingerprint(current),
    },
    state: {
      key: stateKey,
      byteSize: state.length,
      fingerprint: officeFingerprint(state),
    },
    modelVersion: first.revision.modelVersion ?? undefined,
    operationSummary: { type: 'legacy_fixture' },
  });
  return {
    artifact: first.artifact,
    revisions: [first.revision, second.revision],
    packages: [bytes, current],
  };
}
