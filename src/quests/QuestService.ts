import {
  getQuestDefinition,
  getQuestDefinitions,
} from "./QuestCatalog.js";
import {
  getWorldQuestNpc,
} from "../world/WorldQuestContext.js";
import {
  markQuestEventProcessed,
  markQuestRequestProcessed,
} from "./QuestProgress.js";
import {
  QUEST_PROGRESS_SCHEMA_VERSION,
  type QuestDefinition,
  type QuestObjectiveDefinition,
  type QuestObjectiveType,
  type QuestProgressData,
  type QuestProgressRecord,
  type QuestRuntimeState,
  type QuestSnapshot,
} from "./QuestTypes.js";

export type QuestInventoryReader = (itemId: string) => number;

export type QuestChange = {
  changed: boolean;
  questIds: readonly string[];
  becameReady: readonly string[];
};

export type QuestActionResult = {
  ok: boolean;
  code: string;
  questId: string;
  changed: boolean;
};

function completedAtLeastOnce(
  progress: QuestProgressData,
  questId: string,
): boolean {
  return (progress.quests[questId]?.completionCount ?? 0) > 0;
}

export function getQuestRuntimeState(
  definition: QuestDefinition,
  progress: QuestProgressData,
): QuestRuntimeState {
  const record = progress.quests[definition.questId];

  if (record?.state === "active" || record?.state === "ready") {
    return record.state;
  }

  if (record?.state === "completed" && !definition.repeatable) {
    return "completed";
  }

  const prerequisitesSatisfied = definition.prerequisites.every((questId) =>
    completedAtLeastOnce(progress, questId),
  );

  if (!prerequisitesSatisfied) {
    return "locked";
  }

  if (definition.initialState === "locked" && definition.prerequisites.length === 0) {
    return "locked";
  }

  return "available";
}

function createObjectiveProgress(
  definition: QuestDefinition,
  inventoryCount: QuestInventoryReader,
): Record<string, number> {
  const objectives: Record<string, number> = {};

  for (const objective of definition.objectives) {
    objectives[objective.id] =
      objective.type === "deliver"
        ? Math.min(objective.quantity, Math.max(0, inventoryCount(objective.targetId)))
        : 0;
  }

  return objectives;
}

function objectiveCurrent(
  record: QuestProgressRecord,
  objective: QuestObjectiveDefinition,
): number {
  return Math.min(
    objective.quantity,
    Math.max(0, Math.trunc(record.objectives[objective.id] ?? 0)),
  );
}

function allObjectivesComplete(
  definition: QuestDefinition,
  record: QuestProgressRecord,
): boolean {
  return definition.objectives.every(
    (objective) => objectiveCurrent(record, objective) >= objective.quantity,
  );
}

function refreshReadyState(
  definition: QuestDefinition,
  record: QuestProgressRecord,
): boolean {
  if (record.state !== "active" && record.state !== "ready") {
    return false;
  }

  const nextState = allObjectivesComplete(definition, record)
    ? "ready"
    : "active";

  if (record.state === nextState) {
    return false;
  }

  record.state = nextState;
  return true;
}

export class QuestService {
  constructor(private readonly now: () => number = Date.now) {}

  isRequestProcessed(progress: QuestProgressData, requestId: string): boolean {
    return Object.prototype.hasOwnProperty.call(progress.processedRequests, requestId);
  }

  isEventProcessed(progress: QuestProgressData, eventId: string): boolean {
    return Object.prototype.hasOwnProperty.call(progress.processedEvents, eventId);
  }

  acceptQuest(
    progress: QuestProgressData,
    questId: string,
    requestId: string,
    inventoryCount: QuestInventoryReader,
  ): QuestActionResult {
    if (this.isRequestProcessed(progress, requestId)) {
      return { ok: true, code: "DUPLICATE_REQUEST", questId, changed: false };
    }

    const definition = getQuestDefinition(questId);

    if (!definition) {
      return { ok: false, code: "QUEST_NOT_FOUND", questId, changed: false };
    }

    if (getQuestRuntimeState(definition, progress) !== "available") {
      return { ok: false, code: "QUEST_NOT_AVAILABLE", questId, changed: false };
    }

    const previous = progress.quests[questId];
    const at = this.now();
    const record: QuestProgressRecord = {
      state: "active",
      objectives: createObjectiveProgress(definition, inventoryCount),
      acceptedAt: at,
      completedAt: previous?.completedAt ?? 0,
      completionCount: previous?.completionCount ?? 0,
      lastCompletedAt: previous?.lastCompletedAt ?? 0,
    };

    refreshReadyState(definition, record);
    progress.quests[questId] = record;
    markQuestRequestProcessed(progress, requestId, "accept", at);

    if (!progress.trackedQuestId && definition.trackingAllowed) {
      progress.trackedQuestId = questId;
    }

    return { ok: true, code: "QUEST_ACCEPTED", questId, changed: true };
  }

  setTrackedQuest(
    progress: QuestProgressData,
    questId: string,
    requestId: string,
  ): QuestActionResult {
    if (this.isRequestProcessed(progress, requestId)) {
      return { ok: true, code: "DUPLICATE_REQUEST", questId, changed: false };
    }

    const definition = getQuestDefinition(questId);

    if (!definition || !definition.trackingAllowed) {
      return { ok: false, code: "QUEST_NOT_TRACKABLE", questId, changed: false };
    }

    const state = getQuestRuntimeState(definition, progress);

    if (state !== "active" && state !== "ready") {
      return { ok: false, code: "QUEST_NOT_ACTIVE", questId, changed: false };
    }

    progress.trackedQuestId = questId;
    markQuestRequestProcessed(progress, requestId, "track", this.now());
    return { ok: true, code: "QUEST_TRACKED", questId, changed: true };
  }

  recordObjectiveEvent(
    progress: QuestProgressData,
    type: Exclude<QuestObjectiveType, "deliver">,
    targetId: string,
    amount: number,
    eventId: string,
  ): QuestChange {
    if (this.isEventProcessed(progress, eventId)) {
      return { changed: false, questIds: [], becameReady: [] };
    }

    const safeAmount = Math.max(0, Math.trunc(amount));

    if (safeAmount <= 0) {
      return { changed: false, questIds: [], becameReady: [] };
    }

    const changedQuestIds = new Set<string>();
    const becameReady = new Set<string>();

    for (const definition of getQuestDefinitions()) {
      const record = progress.quests[definition.questId];

      if (!record || (record.state !== "active" && record.state !== "ready")) {
        continue;
      }

      let questChanged = false;

      for (const objective of definition.objectives) {
        if (objective.type !== type || objective.targetId !== targetId) {
          continue;
        }

        const current = objectiveCurrent(record, objective);
        const next = Math.min(objective.quantity, current + safeAmount);

        if (next !== current) {
          record.objectives[objective.id] = next;
          questChanged = true;
        }
      }

      if (!questChanged) {
        continue;
      }

      const wasReady = record.state === "ready";
      refreshReadyState(definition, record);
      changedQuestIds.add(definition.questId);

      if (!wasReady && record.state === "ready") {
        becameReady.add(definition.questId);
      }
    }

    if (changedQuestIds.size > 0) {
      markQuestEventProcessed(progress, eventId, this.now());
    }

    return {
      changed: changedQuestIds.size > 0,
      questIds: [...changedQuestIds],
      becameReady: [...becameReady],
    };
  }

  synchronizeDeliverObjectives(
    progress: QuestProgressData,
    inventoryCount: QuestInventoryReader,
  ): QuestChange {
    const changedQuestIds = new Set<string>();
    const becameReady = new Set<string>();

    for (const definition of getQuestDefinitions()) {
      const record = progress.quests[definition.questId];

      if (!record || (record.state !== "active" && record.state !== "ready")) {
        continue;
      }

      let questChanged = false;

      for (const objective of definition.objectives) {
        if (objective.type !== "deliver") {
          continue;
        }

        const next = Math.min(
          objective.quantity,
          Math.max(0, Math.trunc(inventoryCount(objective.targetId))),
        );
        const current = objectiveCurrent(record, objective);

        if (next !== current) {
          record.objectives[objective.id] = next;
          questChanged = true;
        }
      }

      const wasReady = record.state === "ready";
      const readyChanged = refreshReadyState(definition, record);

      if (questChanged || readyChanged) {
        changedQuestIds.add(definition.questId);
      }

      if (!wasReady && record.state === "ready") {
        becameReady.add(definition.questId);
      }
    }

    return {
      changed: changedQuestIds.size > 0,
      questIds: [...changedQuestIds],
      becameReady: [...becameReady],
    };
  }

  validateTurnIn(
    progress: QuestProgressData,
    questId: string,
    requestId: string,
    inventoryCount: QuestInventoryReader,
  ): QuestActionResult {
    if (this.isRequestProcessed(progress, requestId)) {
      return { ok: true, code: "DUPLICATE_REQUEST", questId, changed: false };
    }

    const definition = getQuestDefinition(questId);

    if (!definition) {
      return { ok: false, code: "QUEST_NOT_FOUND", questId, changed: false };
    }

    this.synchronizeDeliverObjectives(progress, inventoryCount);

    if (getQuestRuntimeState(definition, progress) !== "ready") {
      return { ok: false, code: "QUEST_NOT_READY", questId, changed: false };
    }

    for (const objective of definition.objectives) {
      if (
        objective.type === "deliver" &&
        inventoryCount(objective.targetId) < objective.quantity
      ) {
        return { ok: false, code: "QUEST_ITEMS_MISSING", questId, changed: false };
      }
    }

    return { ok: true, code: "QUEST_READY", questId, changed: false };
  }

  completeTurnIn(
    progress: QuestProgressData,
    questId: string,
    requestId: string,
  ): QuestActionResult {
    const definition = getQuestDefinition(questId);
    const record = progress.quests[questId];

    if (!definition || !record || record.state !== "ready") {
      return { ok: false, code: "QUEST_NOT_READY", questId, changed: false };
    }

    const at = this.now();
    record.state = "completed";
    record.completedAt = at;
    record.lastCompletedAt = at;
    record.completionCount = Math.max(0, record.completionCount) + 1;
    markQuestRequestProcessed(progress, requestId, "turn_in", at);

    if (progress.trackedQuestId === questId) {
      progress.trackedQuestId = "";
    }

    return { ok: true, code: "QUEST_COMPLETED", questId, changed: true };
  }

  buildSnapshot(progress: QuestProgressData): QuestSnapshot {
    const markerByNpc = new Map<string, "available" | "ready">();
    const interactableNpcIds = new Set<string>();

    const quests = getQuestDefinitions().map((definition) => {
      const state = getQuestRuntimeState(definition, progress);
      const record = progress.quests[definition.questId];

      if (state === "available" || state === "active" || state === "ready") {
        interactableNpcIds.add(definition.offerNpcId);
      }

      if ((state === "active" || state === "ready") && definition.turnIn.type === "npc") {
        interactableNpcIds.add(definition.turnIn.targetId);
      }

      if (state === "active" || state === "ready") {
        for (const objective of definition.objectives) {
          if (objective.type === "talk") {
            interactableNpcIds.add(objective.targetId);
          }
        }
      }

      if (state === "available") {
        markerByNpc.set(definition.offerNpcId, "available");
      }

      if (state === "ready" && definition.turnIn.type === "npc") {
        markerByNpc.set(definition.turnIn.targetId, "ready");
      }

      return {
        questId: definition.questId,
        title: definition.title,
        description: definition.description,
        state,
        objectives: definition.objectives.map((objective) => {
          const current = record ? objectiveCurrent(record, objective) : 0;

          return {
            ...objective,
            current,
            complete: current >= objective.quantity,
          };
        }),
        rewards: definition.rewards,
        trackingAllowed: definition.trackingAllowed,
        tracked: progress.trackedQuestId === definition.questId,
        offerNpcId: definition.offerNpcId,
        turnIn: definition.turnIn,
        dialogue: definition.dialogue,
        repeatable: definition.repeatable,
        completionCount: record?.completionCount ?? 0,
      };
    });

    const npcMarkers = [...markerByNpc.entries()]
      .map(([npcId, state]) => {
        const npc = getWorldQuestNpc(npcId);

        return npc
          ? {
              npcId,
              displayName: npc.displayName,
              objectName: npc.objectName,
              state,
            }
          : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((left, right) => left.npcId.localeCompare(right.npcId));

    const interactableNpcs = [...interactableNpcIds]
      .map((npcId) => {
        const npc = getWorldQuestNpc(npcId);
        return npc
          ? { npcId, displayName: npc.displayName, objectName: npc.objectName }
          : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((left, right) => left.npcId.localeCompare(right.npcId));

    return {
      schemaVersion: QUEST_PROGRESS_SCHEMA_VERSION,
      quests,
      trackedQuestId: progress.trackedQuestId,
      npcMarkers,
      interactableNpcs,
    };
  }
}
