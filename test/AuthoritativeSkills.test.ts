import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { Client } from "colyseus";

import { MyRoom } from "../src/rooms/MyRoom.js";
import { PlayerState } from "../src/rooms/schema/MyRoomState.js";

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
    (client: Client, message: Record<string, unknown>) => Promise<void>
  >)[name];
}

function findNamedEvent(events: unknown[], name: string): Record<string, unknown> | null {
  for (const candidate of events) {
    const event = candidate as Record<string, unknown>;

    if (event.name === name) {
      return event;
    }

    const nested = Array.isArray(event.events) ? event.events : [];
    const result = findNamedEvent(nested, name);

    if (result) {
      return result;
    }
  }

  return null;
}

describe("authoritative universal basic heal", () => {
  it("heals exactly 20% of MaxHP without using Healing Power", async () => {
    const room = new MyRoom();
    const { client, sent } = createClient("skill-heal-session");
    const player = new PlayerState();

    player.isAlive = true;
    player.currentHealth = 100;
    player.maxHealth = 200;
    player.combatStats.healingBonus = 999;
    room.state.players.set(client.sessionId, player);

    const internals = room as unknown as {
      skillNow: () => number;
      persistPlayerSkillUse: () => Promise<void>;
    };

    Object.defineProperty(internals, "skillNow", { value: () => 1_000_000 });
    internals.persistPlayerSkillUse = async () => {};

    await getMessageHandler(room, "use_skill")(client, {
      requestId: "heal-1",
      skillID: "skill_heal_basic",
    });

    assert.strictEqual(player.currentHealth, 140);
    assert.strictEqual(sent.at(-1)?.type, "use_skill_result");
    assert.strictEqual(sent.at(-1)?.payload.code, "SKILL_USED");
    assert.strictEqual(sent.at(-1)?.payload.healAmount, 40);
    assert.strictEqual(sent.at(-1)?.payload.cooldownMs, 30_000);
  });

  it("enforces the 30-second cooldown authoritatively", async () => {
    const room = new MyRoom();
    const { client, sent } = createClient("skill-cooldown-session");
    const player = new PlayerState();
    let now = 2_000_000;

    player.isAlive = true;
    player.currentHealth = 50;
    player.maxHealth = 200;
    room.state.players.set(client.sessionId, player);

    const internals = room as unknown as {
      skillNow: () => number;
      persistPlayerSkillUse: () => Promise<void>;
    };

    Object.defineProperty(internals, "skillNow", { value: () => now });
    internals.persistPlayerSkillUse = async () => {};

    const useSkill = getMessageHandler(room, "use_skill");

    await useSkill(client, { requestId: "heal-a", skillID: "skill_heal_basic" });
    assert.strictEqual(player.currentHealth, 90);

    await useSkill(client, { requestId: "heal-b", skillID: "skill_heal_basic" });
    assert.strictEqual(sent.at(-1)?.payload.code, "SKILL_ON_COOLDOWN");
    assert.strictEqual(player.currentHealth, 90);

    now += 30_000;
    await useSkill(client, { requestId: "heal-c", skillID: "skill_heal_basic" });
    assert.strictEqual(sent.at(-1)?.payload.code, "SKILL_USED");
    assert.strictEqual(player.currentHealth, 130);
  });

  it("does not consume cooldown at full health and rejects dead players", async () => {
    const room = new MyRoom();
    const { client, sent } = createClient("skill-invalid-state-session");
    const player = new PlayerState();

    player.isAlive = true;
    player.currentHealth = 200;
    player.maxHealth = 200;
    room.state.players.set(client.sessionId, player);

    const internals = room as unknown as {
      skillNow: () => number;
      persistPlayerSkillUse: () => Promise<void>;
      playerSkillCooldowns: Map<string, Map<string, number>>;
    };

    Object.defineProperty(internals, "skillNow", { value: () => 3_000_000 });
    internals.persistPlayerSkillUse = async () => {};

    const useSkill = getMessageHandler(room, "use_skill");

    await useSkill(client, { requestId: "full", skillID: "skill_heal_basic" });
    assert.strictEqual(sent.at(-1)?.payload.code, "HEALTH_FULL");
    assert.strictEqual(internals.playerSkillCooldowns.has(client.sessionId), false);

    player.currentHealth = 0;
    player.isAlive = false;
    await useSkill(client, { requestId: "dead", skillID: "skill_heal_basic" });
    assert.strictEqual(sent.at(-1)?.payload.code, "PLAYER_UNAVAILABLE");
  });

  it("rolls the heal and cooldown back if persistence fails", async () => {
    const room = new MyRoom();
    const { client, sent } = createClient("skill-rollback-session");
    const player = new PlayerState();

    player.isAlive = true;
    player.currentHealth = 80;
    player.maxHealth = 200;
    room.state.players.set(client.sessionId, player);

    const internals = room as unknown as {
      skillNow: () => number;
      persistPlayerSkillUse: () => Promise<void>;
      playerSkillCooldowns: Map<string, Map<string, number>>;
    };

    Object.defineProperty(internals, "skillNow", { value: () => 4_000_000 });
    internals.persistPlayerSkillUse = async () => {
      throw new Error("simulated skill persistence failure");
    };

    await getMessageHandler(room, "use_skill")(client, {
      requestId: "rollback",
      skillID: "skill_heal_basic",
    });

    assert.strictEqual(sent.at(-1)?.payload.code, "SKILL_SAVE_FAILED");
    assert.strictEqual(player.currentHealth, 80);
    assert.strictEqual(internals.playerSkillCooldowns.has(client.sessionId), false);
  });

  it("replaces the old local F heal with the authoritative skill and countdown HUD", () => {
    const projectPath = process.env.GRANDORIA_GDEVELOP_PROJECT;
    assert.ok(projectPath, "GRANDORIA_GDEVELOP_PROJECT must select the fixed project.");

    const project = JSON.parse(readFileSync(projectPath, "utf8"));
    const extension = project.eventsFunctionsExtensions.find(
      (candidate: Record<string, unknown>) => candidate.name === "GrandoriaColyseus",
    );
    const useSkillFunction = extension.eventsFunctions.find(
      (candidate: Record<string, unknown>) => candidate.name === "UseSkill",
    );
    const updateCooldownFunction = extension.eventsFunctions.find(
      (candidate: Record<string, unknown>) => candidate.name === "UpdateBasicHealCooldown",
    );

    assert.ok(useSkillFunction);
    assert.ok(updateCooldownFunction);

    const connectFunction = extension.eventsFunctions.find(
      (candidate: Record<string, unknown>) => candidate.name === "ConnectToServer",
    );
    const connectCode = connectFunction.events[0].inlineCode.join("\
");
    assert.match(connectCode, /use_skill_result/);
    assert.match(connectCode, /BasicHealVisualPending/);

    const characterExternalEvents = project.externalEvents.find(
      (candidate: Record<string, unknown>) => candidate.name === "character",
    );
    const potionGroup = findNamedEvent(
      characterExternalEvents.events,
      "HUD — HEALTH POTION",
    );

    assert.ok(potionGroup);
    const serializedPotion = JSON.stringify(potionGroup);

    assert.match(serializedPotion, /GrandoriaColyseus::UseSkill/);
    assert.match(serializedPotion, /skill_heal_basic/);
    assert.match(serializedPotion, /BasicHealCooldownSeconds/);
    assert.match(serializedPotion, /Txt_HealthPotionCooldown/);
    assert.match(serializedPotion, /empt_potion_life/);
    assert.ok(!serializedPotion.includes("character.HP + (character.max_HP / 2)"));
    assert.ok(!serializedPotion.includes('"parameters":["10"]'));
  });
});
