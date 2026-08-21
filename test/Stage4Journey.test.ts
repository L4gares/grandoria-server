import assert from "node:assert/strict";

import { getMonsterDefinition } from "../src/config/MonsterCatalog.js";
import {
  getQuestDefinition,
  getQuestDefinitions,
} from "../src/quests/QuestCatalog.js";
import { createEmptyQuestProgress } from "../src/quests/QuestProgress.js";
import { QuestService, getQuestRuntimeState } from "../src/quests/QuestService.js";
import {
  getWorldQuestNpc,
  getWorldQuestRegion,
  getWorldQuestRegionIds,
  isPointInsideWorldQuestRegion,
} from "../src/world/WorldQuestContext.js";

const QUEST_IDS = [
  "quest_map1_south_path",
  "quest_map1_tracks_in_grass",
  "quest_map1_tusks_on_path",
  "quest_map1_wild_guardian",
] as const;

const CEMETERY_RESPAWN_POINTS = [
  { mapId: "MAP_1", x: 728, y: 1362 },
  { mapId: "MAP_1", x: 796, y: 1394 },
  { mapId: "MAP_1", x: 889, y: 1402 },
] as const;

describe("Grandoria Stage 4 first MAP_1 journey", () => {
  it("exports the approved four-quest chain with no Gem rewards", () => {
    assert.deepStrictEqual(
      getQuestDefinitions().map((quest) => quest.questId),
      [...QUEST_IDS],
    );

    const expectedPrerequisites = [
      [],
      [QUEST_IDS[0]],
      [QUEST_IDS[1]],
      [QUEST_IDS[2]],
    ];
    const expectedRewards = [
      { xp: 25, gold: 5 },
      { xp: 50, gold: 10 },
      { xp: 75, gold: 15 },
      { xp: 100, gold: 25 },
    ];

    QUEST_IDS.forEach((questId, index) => {
      const quest = getQuestDefinition(questId);
      assert.ok(quest);
      assert.deepStrictEqual(quest.prerequisites, expectedPrerequisites[index]);
      assert.strictEqual(quest.rewards.gem, 0);
      assert.strictEqual(quest.rewards.xp, expectedRewards[index].xp);
      assert.strictEqual(quest.rewards.gold, expectedRewards[index].gold);
      assert.deepStrictEqual(quest.rewards.items, []);
      assert.strictEqual(quest.repeatable, false);
      assert.strictEqual(quest.credit.mode, "solo");
    });

    assert.strictEqual(getQuestDefinition(QUEST_IDS[0])?.initialState, "available");
    assert.strictEqual(getQuestDefinition(QUEST_IDS[3])?.nextQuestId, "");
  });

  it("keeps the cemetery outside every explicit Stage 4 QuestRegion", () => {
    const explicitRegionIds = ["village_01", "south_fields_01", "deep_wilds_01"];

    for (const respawnPoint of CEMETERY_RESPAWN_POINTS) {
      for (const regionId of explicitRegionIds) {
        const region = getWorldQuestRegion(regionId);
        assert.ok(region);
        assert.strictEqual(
          isPointInsideWorldQuestRegion(
            region,
            respawnPoint.mapId,
            respawnPoint.x,
            respawnPoint.y,
          ),
          false,
          `Cemetery respawn ${respawnPoint.x},${respawnPoint.y} must not enter ${regionId}.`,
        );
      }
    }

    assert.ok(!getWorldQuestRegionIds().some((id) => /cemet|grave|respawn/i.test(id)));
  });

  it("exports reusable NPC and region metadata", () => {
    assert.strictEqual(getWorldQuestNpc("npc_village_guard")?.displayName, "Arlen");
    assert.strictEqual(getWorldQuestNpc("npc_south_scout")?.displayName, "Nara");

    const village = getWorldQuestRegion("village_01");
    const south = getWorldQuestRegion("south_fields_01");
    const deep = getWorldQuestRegion("deep_wilds_01");

    assert.ok(village && south && deep);
    assert.strictEqual(village.displayName, "Vila");
    assert.strictEqual(village.regionType, "safe");
    assert.strictEqual(south.displayName, "Campos do Sul");
    assert.strictEqual(south.regionType, "hostile");
    assert.strictEqual(deep.displayName, "Terras Selvagens");
    assert.strictEqual(deep.regionType, "hostile");
    assert.strictEqual(deep.accessQuestId, "quest_map1_tusks_on_path");
    assert.strictEqual(deep.associatedQuestId, "quest_map1_wild_guardian");
  });

  it("configures the quest drop and guardian through the generic monster catalog", () => {
    const hare = getMonsterDefinition("mob_hare");
    const guardian = getMonsterDefinition("mob_boar_guardian");

    assert.ok(hare?.drops);
    assert.strictEqual(hare.drops.chancePercent, 100);
    assert.strictEqual(hare.drops.rolls, 1);
    assert.deepStrictEqual(
      hare.drops.rarities.flatMap((rarity) => rarity.items).map((item) => ({
        itemID: item.itemID,
        minQuantity: item.minQuantity,
        maxQuantity: item.maxQuantity,
      })),
      [{ itemID: "rabbit_skin", minQuantity: 1, maxQuantity: 1 }],
    );

    assert.ok(guardian);
    assert.strictEqual(guardian.maxHealth, 40);
    assert.strictEqual(guardian.xpReward, 80);
    assert.strictEqual(guardian.behaviors.chaseAndAttack, true);
    assert.strictEqual(guardian.attack?.damage, 10);
    assert.strictEqual(guardian.attack?.intervalMs, 1800);
  });

  it("can complete the full chain with authoritative objective events", () => {
    let now = 10_000;
    const service = new QuestService(() => ++now);
    const progress = createEmptyQuestProgress();
    let rabbitSkins = 0;
    const inventory = (itemId: string) => itemId === "rabbit_skin" ? rabbitSkins : 0;

    const q1 = getQuestDefinition(QUEST_IDS[0])!;
    const q2 = getQuestDefinition(QUEST_IDS[1])!;
    const q3 = getQuestDefinition(QUEST_IDS[2])!;
    const q4 = getQuestDefinition(QUEST_IDS[3])!;

    assert.strictEqual(getQuestRuntimeState(q1, progress), "available");
    assert.strictEqual(getQuestRuntimeState(q2, progress), "locked");

    assert.strictEqual(service.acceptQuest(progress, q1.questId, "q1-accept", inventory).ok, true);
    service.recordObjectiveEvent(progress, "explore", "south_fields_01", 1, "q1-explore");
    service.recordObjectiveEvent(progress, "talk", "npc_south_scout", 1, "q1-talk");
    assert.strictEqual(progress.quests[q1.questId]?.state, "ready");
    assert.strictEqual(service.validateTurnIn(progress, q1.questId, "q1-turn", inventory).ok, true);
    assert.strictEqual(service.completeTurnIn(progress, q1.questId, "q1-turn").ok, true);
    assert.strictEqual(getQuestRuntimeState(q2, progress), "available");

    assert.strictEqual(service.acceptQuest(progress, q2.questId, "q2-accept", inventory).ok, true);
    for (let index = 0; index < 3; index += 1) {
      service.recordObjectiveEvent(progress, "kill", "mob_hare", 1, `q2-kill-${index}`);
      rabbitSkins += 1;
      service.recordObjectiveEvent(progress, "collect", "rabbit_skin", 1, `q2-collect-${index}`);
    }
    service.synchronizeDeliverObjectives(progress, inventory);
    assert.strictEqual(progress.quests[q2.questId]?.state, "ready");
    assert.strictEqual(service.validateTurnIn(progress, q2.questId, "q2-turn", inventory).ok, true);
    rabbitSkins -= 3;
    assert.strictEqual(service.completeTurnIn(progress, q2.questId, "q2-turn").ok, true);
    assert.strictEqual(getQuestRuntimeState(q3, progress), "available");

    assert.strictEqual(service.acceptQuest(progress, q3.questId, "q3-accept", inventory).ok, true);
    service.recordObjectiveEvent(progress, "explore", "grassland_boar_01", 1, "q3-explore");
    for (let index = 0; index < 3; index += 1) {
      service.recordObjectiveEvent(progress, "kill", "mob_boar", 1, `q3-kill-${index}`);
    }
    assert.strictEqual(progress.quests[q3.questId]?.state, "ready");
    assert.strictEqual(service.completeTurnIn(progress, q3.questId, "q3-turn").ok, true);
    assert.strictEqual(getQuestRuntimeState(q4, progress), "available");

    assert.strictEqual(service.acceptQuest(progress, q4.questId, "q4-accept", inventory).ok, true);
    service.recordObjectiveEvent(progress, "explore", "deep_wilds_01", 1, "q4-explore");
    service.recordObjectiveEvent(progress, "kill", "mob_boar_guardian", 1, "q4-boss");
    assert.strictEqual(progress.quests[q4.questId]?.state, "ready");
    assert.strictEqual(service.completeTurnIn(progress, q4.questId, "q4-turn").ok, true);
    assert.strictEqual(getQuestRuntimeState(q4, progress), "completed");
    assert.strictEqual(progress.quests[q4.questId]?.completionCount, 1);
  });
});
