import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LocalMindLogSpool,
  SpoolCapacityError,
} from '../src/base/logger/spool';

const directory = await mkdtemp(join(tmpdir(), 'localmind-spool-smoke-'));
const firstProcess = new LocalMindLogSpool(directory);
await firstProcess.append({ eventId: 'restart-event', metadata: { ok: true } });
const [file] = await firstProcess.list();
const restartedProcess = new LocalMindLogSpool(directory);
const recovered = await restartedProcess.read(file);
if (recovered.eventId !== 'restart-event') {
  throw new Error('spool restart recovery failed');
}
const envelope = JSON.parse(await readFile(file, 'utf8')) as {
  checksum: string;
  record: Record<string, unknown>;
};
envelope.record.metadata = { ok: false };
await writeFile(file, JSON.stringify(envelope));
let rejected = false;
try {
  await restartedProcess.read(file);
} catch (error) {
  rejected =
    error instanceof Error && error.message === 'spool checksum mismatch';
}
if (!rejected) throw new Error('corrupted spool batch was accepted');
const bounded = new LocalMindLogSpool(
  await mkdtemp(join(tmpdir(), 'localmind-spool-capacity-')),
  1024 * 1024
);
let capacityRejected = false;
try {
  await bounded.append({
    eventId: 'too-large',
    payload: 'x'.repeat(2_000_000),
  });
} catch (error) {
  capacityRejected = error instanceof SpoolCapacityError;
}
if (!capacityRejected) throw new Error('spool capacity limit was not enforced');
console.log('spool restart and checksum recovery verified');
