import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";
import {
  resolve,
} from "node:path";

import type { Client } from "colyseus";

import {
  MyRoom,
} from "../src/rooms/MyRoom.js";
import {
  PlayerState,
} from "../src/rooms/schema/MyRoomState.js";
import {
  getSkillDefinition,
} from "../src/skills/SkillCatalog.js";
import {
  createEmptySkillLoadout,
  planSkillLoadoutAssignment,
} from "../src/skills/SkillLoadout.js";

type SentMessage = {
  type: string;
  payload: Record<string, unknown>;
};

function createClient(sessionId: string) {
  const sent: SentMessage[] = [];
  const client = {
    sessionId,
    send(type: string, payload: Record<string, unknown>) {
      sent.push({ type, payload });
    },
  } as unknown as Client;

  return { client, sent };
}

function getMessageHandler(room: MyRoom, name: string) {
  return (room.messages as unknown as Record<
    string,
    (
      client: Client,
      message: Record<string, unknown>,
    ) => Promise<void>
  >)[name];
}

function seedLoadout(
  player: PlayerState,
  overrides: Record<string, string> = {},
) {
  const loadout = {
    ...createEmptySkillLoadout(),
    ...overrides,
  };

  for (const [slotId, skillID] of Object.entries(loadout)) {
    player.skillLoadout.set(slotId, skillID);
  }
}

describe("Authoritative SkillLoadout assignment foundation", () => {
  it("keeps Basic Heal outside the configurable loadout", () => {
    const basicHeal = getSkillDefinition("skill_heal_basic");

    assert.ok(basicHeal);
    assert.equal(basicHeal.enabled, true);
    assert.equal(basicHeal.availableToAll, true);
    assert.equal(basicHeal.loadoutEligible, false);
  });

  it("plans generic equip and remove operations without a real new skill", () => {
    const empty = createEmptySkillLoadout();
    const equipPlan = planSkillLoadoutAssignment(
      empty,
      "slot_1",
      "skill_test_only",
      {
        enabled: true,
        loadoutEligible: true,
      },
    );

    assert.equal(equipPlan.ok, true);

    if (!equipPlan.ok) {
      return;
    }

    assert.equal(equipPlan.changed, true);
    assert.equal(equipPlan.loadout.slot_1, "skill_test_only");

    const removePlan = planSkillLoadoutAssignment(
      equipPlan.loadout,
      "slot_1",
      "empty",
      undefined,
    );

    assert.equal(removePlan.ok, true);

    if (!removePlan.ok) {
      return;
    }

    assert.equal(removePlan.changed, true);
    assert.equal(removePlan.loadout.slot_1, "empty");
  });

  it("rejects Basic Heal and unknown slots instead of hardcoding them into Q/E/R", () => {
    const empty = createEmptySkillLoadout();
    const basicHeal = getSkillDefinition("skill_heal_basic");

    assert.ok(basicHeal);

    const basicHealPlan = planSkillLoadoutAssignment(
      empty,
      "slot_1",
      "skill_heal_basic",
      {
        enabled: basicHeal.enabled,
        loadoutEligible: basicHeal.loadoutEligible,
      },
    );

    assert.equal(basicHealPlan.ok, false);

    if (!basicHealPlan.ok) {
      assert.equal(
        basicHealPlan.code,
        "SKILL_NOT_LOADOUT_ELIGIBLE",
      );
    }

    const unknownSlotPlan = planSkillLoadoutAssignment(
      empty,
      "slot_999",
      "skill_test_only",
      {
        enabled: true,
        loadoutEligible: true,
      },
    );

    assert.equal(unknownSlotPlan.ok, false);

    if (!unknownSlotPlan.ok) {
      assert.equal(unknownSlotPlan.code, "UNKNOWN_SLOT");
    }

    const malformedSkillPlan = planSkillLoadoutAssignment(
      empty,
      "slot_1",
      "../invalid",
      undefined,
    );

    assert.equal(malformedSkillPlan.ok, false);

    if (!malformedSkillPlan.ok) {
      assert.equal(malformedSkillPlan.code, "INVALID_SKILL_ID");
    }
  });

  it("prevents the same future skill from occupying two slots", () => {
    const loadout = {
      ...createEmptySkillLoadout(),
      slot_1: "skill_test_only",
    };

    const plan = planSkillLoadoutAssignment(
      loadout,
      "slot_2",
      "skill_test_only",
      {
        enabled: true,
        loadoutEligible: true,
      },
    );

    assert.equal(plan.ok, false);

    if (!plan.ok) {
      assert.equal(plan.code, "SKILL_ALREADY_EQUIPPED");
    }
  });

  it("persists authoritative removal and returns the synchronized loadout", async () => {
    const room = new MyRoom();
    const { client, sent } = createClient("loadout-remove-session");
    const player = new PlayerState();

    seedLoadout(player, { slot_1: "skill_test_only" });
    room.state.players.set(client.sessionId, player);

    const internals = room as unknown as {
      persistPlayerSkillLoadout: () => Promise<void>;
    };

    internals.persistPlayerSkillLoadout = async () => {};

    await getMessageHandler(room, "set_skill_loadout_slot")(
      client,
      {
        requestId: "remove-1",
        slotId: "slot_1",
        skillID: "empty",
      },
    );

    assert.equal(player.skillLoadout.get("slot_1"), "empty");
    assert.equal(
      sent.at(-1)?.type,
      "set_skill_loadout_slot_result",
    );
    assert.equal(sent.at(-1)?.payload.code, "LOADOUT_UPDATED");
    assert.equal(sent.at(-1)?.payload.ok, true);
  });

  it("rolls SkillLoadout back when Firestore persistence fails", async () => {
    const room = new MyRoom();
    const { client, sent } = createClient("loadout-rollback-session");
    const player = new PlayerState();

    seedLoadout(player, { slot_1: "skill_test_only" });
    room.state.players.set(client.sessionId, player);

    const internals = room as unknown as {
      persistPlayerSkillLoadout: () => Promise<void>;
    };

    internals.persistPlayerSkillLoadout = async () => {
      throw new Error("simulated SkillLoadout persistence failure");
    };

    await getMessageHandler(room, "set_skill_loadout_slot")(
      client,
      {
        requestId: "rollback-1",
        slotId: "slot_1",
        skillID: "empty",
      },
    );

    assert.equal(
      player.skillLoadout.get("slot_1"),
      "skill_test_only",
    );
    assert.equal(
      sent.at(-1)?.payload.code,
      "SKILL_LOADOUT_SAVE_FAILED",
    );
    assert.equal(sent.at(-1)?.payload.ok, false);
  });

  it("adds no slot execution and no class-skill unlock logic yet", () => {
    const roomSource = readFileSync(
      resolve(process.cwd(), "src", "rooms", "MyRoom.ts"),
      "utf8",
    );

    assert.match(roomSource, /set_skill_loadout_slot/);
    assert.match(roomSource, /persistPlayerSkillLoadout/);
    assert.match(roomSource, /SKILL_LOADOUT_SAVE_FAILED/);
    assert.doesNotMatch(roomSource, /use_skill_slot/);
    assert.doesNotMatch(roomSource, /unlock_skill/);
    assert.doesNotMatch(roomSource, /classSkills/);
  });
});
