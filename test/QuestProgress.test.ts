import assert from "node:assert/strict";

import {
  cloneQuestProgress,
  createEmptyQuestProgress,
  markQuestRequestProcessed,
  normalizeQuestProgress,
  replaceQuestProgress,
} from "../src/quests/QuestProgress.js";
import { QUEST_PROGRESS_SCHEMA_VERSION } from "../src/quests/QuestTypes.js";

describe("QuestProgress persistence model", () => {
  it("migrates legacy characters without quest data to an empty per-character structure", () => {
    const first = normalizeQuestProgress(undefined);
    const second = normalizeQuestProgress({});

    assert.deepStrictEqual(first, {
      schemaVersion: QUEST_PROGRESS_SCHEMA_VERSION,
      quests: {},
      processedRequests: {},
      processedEvents: {},
      trackedQuestId: "",
    });
    assert.deepStrictEqual(second, first);
    assert.notStrictEqual(first, second);
  });

  it("restores an in-memory quest snapshot for persistence rollback", () => {
    const progress = createEmptyQuestProgress();
    progress.quests.quest_test = {
      state: "active",
      objectives: { kill: 1 },
      acceptedAt: 100,
      completedAt: 0,
      completionCount: 0,
      lastCompletedAt: 0,
    };

    const before = cloneQuestProgress(progress);
    progress.quests.quest_test.objectives.kill = 2;
    progress.quests.quest_test.state = "ready";
    progress.trackedQuestId = "quest_test";

    replaceQuestProgress(progress, before);

    assert.deepStrictEqual(progress, before);
    assert.notStrictEqual(progress.quests, before.quests);
  });

  it("keeps processed request IDs after normalization so reconnects remain idempotent", () => {
    const progress = createEmptyQuestProgress();
    markQuestRequestProcessed(progress, "turn-in-1", "turn_in", 1234);

    const restored = normalizeQuestProgress(structuredClone(progress));

    assert.deepStrictEqual(restored.processedRequests["turn-in-1"], {
      action: "turn_in",
      at: 1234,
    });
  });
});
