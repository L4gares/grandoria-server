import {
  QUEST_PROGRESS_SCHEMA_VERSION,
  type QuestProcessedOperation,
  type QuestProgressData,
  type QuestProgressRecord,
} from "./QuestTypes.js";

const MAX_PROCESSED_REQUESTS = 128;
const MAX_PROCESSED_EVENTS = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readSafeString(value: unknown, maximumLength = 128): string {
  if (typeof value !== "string") {
    return "";
  }

  const result = value.trim();

  if (
    result.length === 0 ||
    result.length > maximumLength ||
    /[\u0000-\u001F\u007F]/.test(result)
  ) {
    return "";
  }

  return result;
}

function readNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function readProgressRecord(value: unknown): QuestProgressRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const state = value.state;

  if (state !== "active" && state !== "ready" && state !== "completed") {
    return null;
  }

  const objectiveSource = isRecord(value.objectives) ? value.objectives : {};
  const objectives: Record<string, number> = {};

  for (const [objectiveId, rawAmount] of Object.entries(objectiveSource)) {
    if (!/^[A-Za-z0-9_-]+$/.test(objectiveId)) {
      continue;
    }

    objectives[objectiveId] = readNonNegativeInteger(rawAmount);
  }

  return {
    state,
    objectives,
    acceptedAt: readNonNegativeInteger(value.acceptedAt),
    completedAt: readNonNegativeInteger(value.completedAt),
    completionCount: readNonNegativeInteger(value.completionCount),
    lastCompletedAt: readNonNegativeInteger(value.lastCompletedAt),
  };
}

function trimRecord<T>(
  source: Record<string, T>,
  maximumEntries: number,
  readTimestamp: (value: T) => number,
): Record<string, T> {
  const entries = Object.entries(source)
    .sort((left, right) => readTimestamp(right[1]) - readTimestamp(left[1]))
    .slice(0, maximumEntries);

  return Object.fromEntries(entries);
}

export function createEmptyQuestProgress(): QuestProgressData {
  return {
    schemaVersion: QUEST_PROGRESS_SCHEMA_VERSION,
    quests: {},
    processedRequests: {},
    processedEvents: {},
    trackedQuestId: "",
  };
}

export function normalizeQuestProgress(value: unknown): QuestProgressData {
  if (!isRecord(value)) {
    return createEmptyQuestProgress();
  }

  const questSource = isRecord(value.quests) ? value.quests : {};
  const quests: Record<string, QuestProgressRecord> = {};

  for (const [questId, rawRecord] of Object.entries(questSource)) {
    if (!/^[A-Za-z0-9_-]+$/.test(questId)) {
      continue;
    }

    const record = readProgressRecord(rawRecord);

    if (record) {
      quests[questId] = record;
    }
  }

  const requestSource = isRecord(value.processedRequests)
    ? value.processedRequests
    : {};
  const processedRequests: Record<string, QuestProcessedOperation> = {};

  for (const [requestId, rawOperation] of Object.entries(requestSource)) {
    if (!isRecord(rawOperation)) {
      continue;
    }

    const action = readSafeString(rawOperation.action, 64);
    const at = readNonNegativeInteger(rawOperation.at);

    if (action && at > 0) {
      processedRequests[requestId] = { action, at };
    }
  }

  const eventSource = isRecord(value.processedEvents) ? value.processedEvents : {};
  const processedEvents: Record<string, number> = {};

  for (const [eventId, rawTimestamp] of Object.entries(eventSource)) {
    const at = readNonNegativeInteger(rawTimestamp);

    if (eventId && at > 0) {
      processedEvents[eventId] = at;
    }
  }

  const trackedQuestId = readSafeString(value.trackedQuestId, 128);

  return {
    schemaVersion: QUEST_PROGRESS_SCHEMA_VERSION,
    quests,
    processedRequests: trimRecord(
      processedRequests,
      MAX_PROCESSED_REQUESTS,
      (operation) => operation.at,
    ),
    processedEvents: trimRecord(
      processedEvents,
      MAX_PROCESSED_EVENTS,
      (timestamp) => timestamp,
    ),
    trackedQuestId,
  };
}

export function cloneQuestProgress(progress: QuestProgressData): QuestProgressData {
  return structuredClone(progress);
}

export function replaceQuestProgress(
  target: QuestProgressData,
  source: QuestProgressData,
) {
  target.schemaVersion = source.schemaVersion;
  target.quests = structuredClone(source.quests);
  target.processedRequests = structuredClone(source.processedRequests);
  target.processedEvents = structuredClone(source.processedEvents);
  target.trackedQuestId = source.trackedQuestId;
}

export function markQuestRequestProcessed(
  progress: QuestProgressData,
  requestId: string,
  action: string,
  at: number,
) {
  progress.processedRequests[requestId] = { action, at };
  progress.processedRequests = trimRecord(
    progress.processedRequests,
    MAX_PROCESSED_REQUESTS,
    (operation) => operation.at,
  );
}

export function markQuestEventProcessed(
  progress: QuestProgressData,
  eventId: string,
  at: number,
) {
  progress.processedEvents[eventId] = at;
  progress.processedEvents = trimRecord(
    progress.processedEvents,
    MAX_PROCESSED_EVENTS,
    (timestamp) => timestamp,
  );
}
