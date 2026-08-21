import assert from "node:assert/strict";

import { QUEST_DEFINITIONS, parseQuestCatalog } from "../src/quests/QuestCatalog.js";
import { createEmptyQuestProgress } from "../src/quests/QuestProgress.js";
import { QuestService, getQuestRuntimeState } from "../src/quests/QuestService.js";
import type { QuestDefinition } from "../src/quests/QuestTypes.js";

const validationContext = {
  itemIds: new Set(["rabbit_skin", "rabbit_foot"]),
  monsterIds: new Set(["mob_hare"]),
  npcIds: new Set(["npc_trader_merchant", "npc_trader_mystic"]),
  regionIds: new Set(["grassland_hare_01"]),
};

function makeQuest(questId = "quest_test", repeatable = false, prerequisites: string[] = []): Record<string, unknown> {
  return {
    questId,
    title: questId,
    description: "Fixture",
    offerNpcId: "npc_trader_merchant",
    turnIn: { type: "npc", targetId: "npc_trader_merchant" },
    prerequisites,
    objectives: [
      { id: "talk", type: "talk", targetId: "npc_trader_mystic", quantity: 1, order: 0 },
      { id: "kill", type: "kill", targetId: "mob_hare", quantity: 2, order: 1 },
      { id: "collect", type: "collect", targetId: "rabbit_skin", quantity: 2, order: 2 },
      { id: "explore", type: "explore", targetId: "grassland_hare_01", quantity: 1, order: 3 },
      { id: "deliver", type: "deliver", targetId: "rabbit_skin", quantity: 2, order: 4 },
    ],
    rewards: { xp: 10, gold: 5, gem: 1, items: [{ itemId: "rabbit_foot", quantity: 1 }] },
    nextQuestId: "",
    repeatable,
    initialState: "available",
    dialogue: { offer: "Offer", active: "Active", ready: "Ready", completed: "Done" },
    trackingAllowed: true,
    credit: { mode: "solo" },
  };
}

function installDefinitions(definitions: Record<string, unknown>) {
  const parsed = parseQuestCatalog({ catalogSchemaVersion: 1, definitions }, validationContext);
  const mutable = QUEST_DEFINITIONS as Map<string, QuestDefinition>;
  const previous = new Map(mutable);
  mutable.clear();
  for (const [id, definition] of parsed) mutable.set(id, definition);
  return () => {
    mutable.clear();
    for (const [id, definition] of previous) mutable.set(id, definition);
  };
}

describe("QuestService", () => {
  it("runs authoritative talk, kill, collect, explore and deliver progression", () => {
    const restore = installDefinitions({ quest_test: makeQuest() });
    try {
      let now = 1000;
      const service = new QuestService(() => ++now);
      const progress = createEmptyQuestProgress();
      let rabbitSkins = 0;
      const inventory = (itemId: string) => itemId === "rabbit_skin" ? rabbitSkins : 0;

      assert.strictEqual(service.acceptQuest(progress, "quest_test", "accept-1", inventory).ok, true);
      assert.strictEqual(progress.quests.quest_test?.state, "active");

      service.recordObjectiveEvent(progress, "talk", "npc_trader_mystic", 1, "talk-1");
      service.recordObjectiveEvent(progress, "kill", "mob_hare", 1, "kill-1");
      service.recordObjectiveEvent(progress, "kill", "mob_hare", 1, "kill-2");
      service.recordObjectiveEvent(progress, "collect", "rabbit_skin", 2, "collect-1");
      service.recordObjectiveEvent(progress, "explore", "grassland_hare_01", 1, "explore-1");
      assert.strictEqual(progress.quests.quest_test?.state, "active");

      rabbitSkins = 2;
      const sync = service.synchronizeDeliverObjectives(progress, inventory);
      assert.strictEqual(sync.becameReady.includes("quest_test"), true);
      assert.strictEqual(progress.quests.quest_test?.state, "ready");
      assert.strictEqual(service.validateTurnIn(progress, "quest_test", "turn-1", inventory).ok, true);
      assert.strictEqual(service.completeTurnIn(progress, "quest_test", "turn-1").ok, true);
      assert.strictEqual(progress.quests.quest_test?.completionCount, 1);
      assert.strictEqual(getQuestRuntimeState(QUEST_DEFINITIONS.get("quest_test")!, progress), "completed");
    } finally {
      restore();
    }
  });

  it("ignores duplicate authoritative events and request IDs", () => {
    const restore = installDefinitions({ quest_test: makeQuest() });
    try {
      const service = new QuestService(() => 2000);
      const progress = createEmptyQuestProgress();
      const inventory = () => 0;
      service.acceptQuest(progress, "quest_test", "accept-1", inventory);
      const first = service.recordObjectiveEvent(progress, "kill", "mob_hare", 1, "kill-event");
      const duplicate = service.recordObjectiveEvent(progress, "kill", "mob_hare", 1, "kill-event");
      assert.strictEqual(first.changed, true);
      assert.strictEqual(duplicate.changed, false);
      assert.strictEqual(progress.quests.quest_test?.objectives.kill, 1);
      assert.strictEqual(service.acceptQuest(progress, "quest_test", "accept-1", inventory).code, "DUPLICATE_REQUEST");
    } finally {
      restore();
    }
  });

  it("supports prerequisites and repeatability without erasing completion history", () => {
    const restore = installDefinitions({
      quest_repeat: makeQuest("quest_repeat", true),
      quest_followup: makeQuest("quest_followup", false, ["quest_repeat"]),
    });
    try {
      const service = new QuestService(() => 3000);
      const progress = createEmptyQuestProgress();
      const repeat = QUEST_DEFINITIONS.get("quest_repeat")!;
      const followup = QUEST_DEFINITIONS.get("quest_followup")!;
      assert.strictEqual(getQuestRuntimeState(followup, progress), "locked");

      progress.quests.quest_repeat = {
        state: "completed",
        objectives: {},
        acceptedAt: 1,
        completedAt: 2,
        completionCount: 1,
        lastCompletedAt: 2,
      };
      assert.strictEqual(getQuestRuntimeState(repeat, progress), "available");
      assert.strictEqual(getQuestRuntimeState(followup, progress), "available");
    } finally {
      restore();
    }
  });
});
