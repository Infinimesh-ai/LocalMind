import type {
  LegacyTranscriptionSegment,
  MeetingSummaryV2,
  NormalizedTranscriptSegment,
  TranscriptionLegacyProjection,
  TranscriptionPayloadV2,
} from './types';

export type RawTranscriptSegment = {
  sliceIndex: number;
  speaker: string;
  startSec: number;
  endSec: number;
  text: string;
};

function formatSection(title: string, items: string[]) {
  if (!items.length) {
    return [];
  }

  return [`## ${title}`, ...items.map(item => `- ${item}`)];
}

export function formatTranscriptTime(time: number) {
  const safeTime = Math.max(0, time);
  const totalSeconds = Math.floor(safeTime);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map(part => String(part).padStart(2, '0'))
    .join(':');
}

export function normalizeTranscriptSegments(
  rawSegments: RawTranscriptSegment[]
): NormalizedTranscriptSegment[] {
  const normalized: NormalizedTranscriptSegment[] = [];
  const dedupe = new Set<string>();
  const sorted = [...rawSegments].sort((left, right) => {
    return (
      left.startSec - right.startSec ||
      left.endSec - right.endSec ||
      left.sliceIndex - right.sliceIndex
    );
  });

  for (const segment of sorted) {
    const text = segment.text.trim();
    if (!text) continue;

    const startSec = Math.max(
      normalized.at(-1)?.endSec ?? 0,
      segment.startSec,
      0
    );
    const endSec = Math.max(segment.endSec, startSec);
    if (endSec <= startSec) continue;

    const speaker = segment.speaker.trim() || 'Speaker';
    const key = `${speaker}|${startSec}|${endSec}|${text}`;
    if (dedupe.has(key)) continue;

    dedupe.add(key);
    normalized.push({
      speaker,
      startSec,
      endSec,
      start: formatTranscriptTime(startSec),
      end: formatTranscriptTime(endSec),
      text,
    });
  }

  return normalized;
}

export function buildNormalizedTranscript(
  segments: NormalizedTranscriptSegment[]
) {
  return segments
    .map(segment => `${segment.start} ${segment.speaker}: ${segment.text}`)
    .join('\n')
    .trim();
}

export function normalizeTranscriptResultTimestamps(
  payload: TranscriptionPayloadV2
): TranscriptionPayloadV2 {
  const segments = payload.normalizedSegments;
  if (!segments) return payload;

  const sourceDuration = payload.sourceAudio?.durationMs
    ? payload.sourceAudio.durationMs / 1000
    : 0;
  const manifestDuration = Math.max(
    0,
    ...(payload.sliceManifest ?? []).map(
      item => item.startSec + item.durationSec
    )
  );
  const durationSec = Math.max(sourceDuration, manifestDuration) || undefined;
  const timestamps = segments.flatMap(segment => [
    Math.max(0, segment.startSec),
    Math.max(0, segment.endSec),
  ]);
  const maxTimestamp = Math.max(0, ...timestamps);
  const maxAllowed = durationSec === undefined ? Infinity : durationSec + 5;
  let scale = 1;
  let convertMmss = false;

  if (durationSec !== undefined && maxTimestamp > maxAllowed) {
    const mmssTimestamps = timestamps.map(timestamp => {
      const minutes = Math.floor(timestamp / 100);
      const seconds = timestamp - minutes * 100;
      return seconds < 60 ? minutes * 60 + seconds : null;
    });
    if (mmssTimestamps.every(value => value !== null && value <= maxAllowed)) {
      convertMmss = true;
    } else if (
      maxTimestamp >= durationSec * 100 &&
      maxTimestamp / 1000 <= maxAllowed
    ) {
      scale = 0.001;
    } else if (maxTimestamp <= durationSec * 1.25) {
      scale = durationSec / maxTimestamp;
    }
  }

  const normalizeTimestamp = (timestamp: number) => {
    const minutes = Math.floor(timestamp / 100);
    const seconds = timestamp - minutes * 100;
    const converted = convertMmss ? minutes * 60 + seconds : timestamp * scale;
    return durationSec === undefined
      ? Math.max(0, converted)
      : Math.min(Math.max(0, converted), durationSec);
  };
  const normalizedSegments = normalizeTranscriptSegments(
    segments.map((segment, sliceIndex) => ({
      sliceIndex,
      speaker: segment.speaker,
      startSec: normalizeTimestamp(segment.startSec),
      endSec: normalizeTimestamp(segment.endSec),
      text: segment.text,
    }))
  );

  return {
    ...payload,
    normalizedSegments,
    normalizedTranscript: buildNormalizedTranscript(normalizedSegments),
  };
}

export function toLegacyTranscriptionSegments(
  segments: NormalizedTranscriptSegment[]
): LegacyTranscriptionSegment[] {
  return segments.map(segment => ({
    speaker: segment.speaker,
    start: segment.start,
    end: segment.end,
    transcription: segment.text,
  }));
}

export function summaryToMarkdown(summaryJson?: MeetingSummaryV2 | null) {
  if (!summaryJson) {
    return null;
  }

  const lines = [
    ...formatSection('Key Points', summaryJson.keyPoints),
    ...formatSection('Decisions', summaryJson.decisions),
    ...formatSection('Open Questions', summaryJson.openQuestions),
    ...formatSection('Blockers', summaryJson.blockers),
  ].filter(Boolean);

  const markdown = lines.join('\n').trim();
  return markdown.length ? markdown : null;
}

export function actionItemsToMarkdown(summaryJson?: MeetingSummaryV2 | null) {
  if (!summaryJson?.actionItems.length) {
    return null;
  }

  const markdown = summaryJson.actionItems
    .map(item => {
      const suffix = [item.owner, item.deadline].filter(Boolean).join(' · ');
      return `- [ ] ${item.description}${suffix ? ` (${suffix})` : ''}`;
    })
    .join('\n')
    .trim();

  return markdown.length ? markdown : null;
}

export function buildLegacyProjection(
  payload: Pick<TranscriptionPayloadV2, 'normalizedSegments' | 'summaryJson'>
): TranscriptionLegacyProjection {
  const normalizedSegments = payload.normalizedSegments ?? [];

  return {
    title: payload.summaryJson?.title ?? null,
    summary: summaryToMarkdown(payload.summaryJson),
    actions: actionItemsToMarkdown(payload.summaryJson),
    transcription: normalizedSegments.length
      ? toLegacyTranscriptionSegments(normalizedSegments)
      : null,
  };
}
