import assert from "node:assert/strict";

import { parseQuestCatalog } from "../src/quests/QuestCatalog.js";
import type { QuestCatalogValidationContext } from "../src/quests/QuestCatalog.js";

const context: QuestCatalogValidationContext = {
  itemIds: new Set(["rabbit_skin", "rabbit_foot"]),
  monsterIds: new Set(["mob_hare"]),
  npcIds: new Set(["npc_trader_merchant", "npc_trader_mystic"]),
  regionIds: new Set(["grassland_hare_01"]),
};

function definition(overrides: Record<string, unknown> = {}) {
  return {
    questId: "quest_test",
    title: "Quest Test",
    description: "Automated fixture only.",
    offerNpcId: "npc_trader_merchant",
    turnIn: { type: "npc", targetId: "npc_trader_merchant" },
    prerequisites: [] as string[],
    objectives: [
      { id: "talk", type: "talk", targetId: "npc_trader_mystic", quantity: 1, order: 0 },
      { id: "kill", type: "kill", targetId: "mob_hare", quantity: 2, order: 1 },
      { id: "collect", type: "collect", targetId: "rabbit_skin", quantity: 2, order: 2 },
      { id: "explore", type: "explore", targetId: "grassland_hare_01", quantity: 1, order: 3 },
      { id: "deliver", type: "deliver", targetId: "rabbit_skin", quantity: 2, order: 4 },
    ],
    rewards: { xp: 10, gold: 5, gem: 0, items: [{ itemId: "rabbit_foot", quantity: 1 }] },
    nextQuestId: "",
    repeatable: false,
    initialState: "available",
    dialogue: { offer: "Offer", active: "Active", ready: "Ready", completed: "Done" },
    trackingAllowed: true,
    credit: { mode: "solo" },
    ...overrides,
  };
}

function catalog(definitions: Record<string, unknown>) {
  return { catalogSchemaVersion: 1, definitions };
}

describe("QuestCatalog", () => {
  it("accepts an empty production catalog", () => {
    assert.strictEqual(parseQuestCatalog(catalog({}), context).size, 0);
  });

  it("accepts all five generic objective types", () => {
    const parsed = parseQuestCatalog(catalog({ quest_test: definition() }), context);
    assert.deepStrictEqual(
      parsed.get("quest_test")?.objectives.map((objective) => objective.type),
      ["talk", "kill", "collect", "explore", "deliver"],
    );
  });

  it("rejects unknown objective types and broken canonical references", () => {
    const unknownType = definition({
      objectives: [{ id: "bad", type: "client_progress", targetId: "mob_hare", quantity: 1, order: 0 }],
    });
    assert.throws(() => parseQuestCatalog(catalog({ quest_test: unknownType }), context), /type is unknown/);

    const unknownItem = definition({
      objectives: [{ id: "collect", type: "collect", targetId: "missing_item", quantity: 1, order: 0 }],
    });
    assert.throws(() => parseQuestCatalog(catalog({ quest_test: unknownItem }), context), /unknown item/);
  });

  it("rejects zero quantities and negative rewards", () => {
    const zeroQuantity = definition({
      objectives: [{ id: "kill", type: "kill", targetId: "mob_hare", quantity: 0, order: 0 }],
    });
    assert.throws(() => parseQuestCatalog(catalog({ quest_test: zeroQuantity }), context), /integer >= 1/);

    const negativeReward = definition({ rewards: { xp: -1, gold: 0, gem: 0, items: [] } });
    assert.throws(() => parseQuestCatalog(catalog({ quest_test: negativeReward }), context), /integer >= 0/);
  });

  it("rejects broken chains and cycles", () => {
    const broken = definition({ nextQuestId: "quest_missing" });
    assert.throws(() => parseQuestCatalog(catalog({ quest_test: broken }), context), /missing nextQuestId/);

    const first = definition({ questId: "quest_a", nextQuestId: "quest_b" });
    const second = definition({ questId: "quest_b", nextQuestId: "quest_a" });
    assert.throws(
      () => parseQuestCatalog(catalog({ quest_a: first, quest_b: second }), context),
      /chain contains a cycle/,
    );
  });
});
