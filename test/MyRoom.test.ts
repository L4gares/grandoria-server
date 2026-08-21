import assert from "node:assert/strict";

import type { Room as ClientRoom } from "@colyseus/sdk";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { MyRoom } from "../src/rooms/MyRoom.js";
import { installTestAuthentication } from "./TestAuthentication.js";

const ROOM_NAME = "my_room";
const MAP_ID = "MAP_1";
const FIXED_TIME_STEP_MS = 1000 / 60;
const ATTACK_HIT_TICKS = 15;
const ATTACK_FINISH_TICKS_AFTER_HIT =
  Math.ceil(1_500 / FIXED_TIME_STEP_MS) - ATTACK_HIT_TICKS + 1;
const DEATH_DURATION_MS = 480;
const RESPAWN_DELAY_MS = 10_000;
const PLAYER_MAX_HEALTH = 50;
const BOAR_ATTACK_DAMAGE = 7;
const BOAR_ATTACK_HIT_TICKS = 15;
const PLAYER_RESPAWN_TICKS = 180;

installTestAuthentication();

type MonsterFixture = {
  id: string;
  type: string;
  mapId: string;
  maxHealth: number;
  attackOffset: {
    x: number;
    y: number;
    direction: "up" | "down" | "left" | "right";
  };
};

const HARE_MONSTER: MonsterFixture = {
  id: "grassland_hare_01__001",
  type: "mob_hare",
  mapId: MAP_ID,
  maxHealth: 2,
  attackOffset: {
    x: -18,
    y: 0,
    direction: "right",
  },
};

const BOAR_MONSTER: MonsterFixture = {
  id: "grassland_boar_01__001",
  type: "mob_boar",
  mapId: MAP_ID,
  maxHealth: 10,
  attackOffset: {
    x: 0,
    y: -24,
    direction: "down",
  },
};

const DEFAULT_JOIN_OPTIONS = {
  playerUid: "test-player",
  characterId: "test-character",
  characterName: "Test Character",
  mapId: MAP_ID,
  x: 728,
  y: 1362,
  direction: "down" as const,
};

type JoinOptions = typeof DEFAULT_JOIN_OPTIONS;

type PublicMyRoom = {
  [Key in keyof MyRoom]: MyRoom[Key];
};

type TestableMyRoom = PublicMyRoom & {
  fixedTick(deltaTime: number): void;
};

type GrandoriaClient = ClientRoom<MyRoom, MyRoom["state"]>;

function advanceFixedTicks(room: TestableMyRoom, tickCount: number) {
  for (let tick = 0; tick < tickCount; tick += 1) {
    room.fixedTick(FIXED_TIME_STEP_MS);
  }
}

function assertClose(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${expected}, received ${actual}`,
  );
}

async function sendAttack(
  room: TestableMyRoom,
  client: GrandoriaClient,
  message: unknown,
) {
  const received = room.waitForMessage("attack");

  client.send("attack", message);

  await received;
}

describe("MyRoom authoritative monster combat", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    colyseus = await boot(appConfig);
  });

  after(async () => {
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  async function createJoinedRoom(
    overrides: Partial<JoinOptions> = {},
    attackMonster: MonsterFixture = HARE_MONSTER,
  ) {
    const room = await colyseus.createRoom<MyRoom>(ROOM_NAME, {});

    // Stop only this test room's native interval. Tests advance the same
    // production simulation step synchronously without real-time sleeps.
    room.setSimulationInterval();

    for (const monsterId of room.state.monsters.keys()) {
      if (monsterId !== HARE_MONSTER.id && monsterId !== BOAR_MONSTER.id) {
        room.state.monsters.delete(monsterId);
      }
    }

    const target = room.state.monsters.get(attackMonster.id);

    assert.ok(target);

    const joinOptions = {
      ...DEFAULT_JOIN_OPTIONS,
      mapId: target.mapId,
      x: target.x + attackMonster.attackOffset.x,
      y: target.y + attackMonster.attackOffset.y,
      direction: attackMonster.attackOffset.direction,
      ...overrides,
    };

    const client = await colyseus.connectTo(room, joinOptions);

    return {
      client,
      joinOptions,
      room: room as unknown as TestableMyRoom,
    };
  }

  async function performValidHit(
    room: TestableMyRoom,
    client: GrandoriaClient,
    monster: MonsterFixture = HARE_MONSTER,
  ) {
    await sendAttack(room, client, { monsterId: monster.id });
    advanceFixedTicks(room, ATTACK_HIT_TICKS);
  }

  async function killMonster(
    room: TestableMyRoom,
    client: GrandoriaClient,
    monster: MonsterFixture = HARE_MONSTER,
  ) {
    for (let hit = 0; hit < monster.maxHealth; hit += 1) {
      const player = room.state.players.get(client.sessionId);
      const target = room.state.monsters.get(monster.id);

      assert.ok(player);
      assert.ok(target);

      player.mapId = target.mapId;
      player.x = target.x + monster.attackOffset.x;
      player.y = target.y + monster.attackOffset.y;
      player.direction = monster.attackOffset.direction;
      player.currentHealth = player.maxHealth;
      player.isAlive = true;

      await performValidHit(room, client, monster);

      if (hit < monster.maxHealth - 1) {
        advanceFixedTicks(room, ATTACK_FINISH_TICKS_AFTER_HIT);
      }
    }
  }

  it("synchronizes the joined player and both initial monster types", async () => {
    const { client, joinOptions, room } = await createJoinedRoom();

    assert.strictEqual(client.sessionId, room.clients[0].sessionId);

    await room.waitForNextPatch();

    const serverPlayer = room.state.players.get(client.sessionId);
    const serverHare = room.state.monsters.get(HARE_MONSTER.id);
    const serverBoar = room.state.monsters.get(BOAR_MONSTER.id);
    const syncedPlayer = client.state.players.get(client.sessionId);
    const syncedHare = client.state.monsters.get(HARE_MONSTER.id);
    const syncedBoar = client.state.monsters.get(BOAR_MONSTER.id);

    assert.ok(serverPlayer);
    assert.strictEqual(serverPlayer.mapId, MAP_ID);
    assert.strictEqual(serverPlayer.x, joinOptions.x);
    assert.strictEqual(serverPlayer.y, joinOptions.y);
    assert.strictEqual(serverPlayer.direction, joinOptions.direction);
    assert.strictEqual(serverPlayer.currentHealth, PLAYER_MAX_HEALTH);
    assert.strictEqual(serverPlayer.maxHealth, PLAYER_MAX_HEALTH);
    assert.strictEqual(serverPlayer.isAlive, true);

    assert.ok(serverHare);
    assert.strictEqual(serverHare.monsterType, HARE_MONSTER.type);
    assert.strictEqual(serverHare.mapId, HARE_MONSTER.mapId);
    assert.ok(Number.isFinite(serverHare.x));
    assert.ok(Number.isFinite(serverHare.y));
    assert.strictEqual(serverHare.direction, "down");
    assert.strictEqual(serverHare.animation, "idle");
    assert.strictEqual(serverHare.currentHealth, HARE_MONSTER.maxHealth);
    assert.strictEqual(serverHare.maxHealth, HARE_MONSTER.maxHealth);
    assert.strictEqual(serverHare.isAlive, true);

    assert.ok(serverBoar);
    assert.strictEqual(serverBoar.monsterType, BOAR_MONSTER.type);
    assert.strictEqual(serverBoar.mapId, BOAR_MONSTER.mapId);
    assert.ok(Number.isFinite(serverBoar.x));
    assert.ok(Number.isFinite(serverBoar.y));
    assert.strictEqual(serverBoar.direction, "down");
    assert.strictEqual(serverBoar.animation, "idle");
    assert.strictEqual(serverBoar.currentHealth, BOAR_MONSTER.maxHealth);
    assert.strictEqual(serverBoar.maxHealth, BOAR_MONSTER.maxHealth);
    assert.strictEqual(serverBoar.isAlive, true);

    assert.ok(syncedPlayer);
    assert.strictEqual(syncedPlayer.mapId, MAP_ID);
    assert.ok(syncedHare);
    assert.strictEqual(syncedHare.monsterType, HARE_MONSTER.type);
    assertClose(syncedHare.x, serverHare.x, 1e-4);
    assertClose(syncedHare.y, serverHare.y, 1e-4);
    assert.strictEqual(syncedHare.currentHealth, HARE_MONSTER.maxHealth);
    assert.strictEqual(syncedHare.isAlive, true);
    assert.ok(syncedBoar);
    assert.strictEqual(syncedBoar.monsterType, BOAR_MONSTER.type);
    assertClose(syncedBoar.x, serverBoar.x, 1e-4);
    assertClose(syncedBoar.y, serverBoar.y, 1e-4);
    assert.strictEqual(syncedBoar.currentHealth, BOAR_MONSTER.maxHealth);
    assert.strictEqual(syncedBoar.isAlive, true);
  });

  it("does not leak equipment when the same account changes characters", async () => {
    const room = await colyseus.createRoom<MyRoom>(ROOM_NAME, {});

    room.setSimulationInterval();
    room.autoDispose = false;

    const firstClient = await colyseus.connectTo(room, {
      ...DEFAULT_JOIN_OPTIONS,
      characterId: "first-character",
      characterName: "First Character",
      equipment: {
        Weapons: {
          id: "first-character-sword",
          type: "weapon",
          sub_type: "one_handed_sword",
        },
      },
    });

    await room.waitForNextPatch();

    const firstPlayer = room.state.players.get(firstClient.sessionId);

    assert.ok(firstPlayer);
    assert.strictEqual(firstPlayer.characterId, "first-character");
    assert.strictEqual(firstPlayer.equipment.Weapons.id, "first-character-sword");

    await firstClient.leave();

    assert.strictEqual(room.state.players.has(firstClient.sessionId), false);

    const secondClient = await colyseus.connectTo(room, {
      ...DEFAULT_JOIN_OPTIONS,
      characterId: "second-character",
      characterName: "Second Character",
    });

    await room.waitForNextPatch();

    const secondPlayer = room.state.players.get(secondClient.sessionId);

    assert.ok(secondPlayer);
    assert.strictEqual(secondPlayer.characterId, "second-character");
    assert.strictEqual(secondPlayer.displayName, "Second Character");
    assert.strictEqual(secondPlayer.equipment.Head.id, "empty");
    assert.strictEqual(secondPlayer.equipment.Tronco.id, "empty");
    assert.strictEqual(secondPlayer.equipment.Legs.id, "empty");
    assert.strictEqual(secondPlayer.equipment.Foots.id, "empty");
    assert.strictEqual(secondPlayer.equipment.Weapons.id, "empty");
    assert.strictEqual(secondPlayer.equipment.OffHand.id, "empty");
  });

  it("damages only the hare for a valid hare attack", async () => {
    const { client, room } = await createJoinedRoom();

    await sendAttack(room, client, { monsterId: HARE_MONSTER.id });
    advanceFixedTicks(room, ATTACK_HIT_TICKS - 1);

    assert.strictEqual(
      room.state.monsters.get(HARE_MONSTER.id)?.currentHealth,
      HARE_MONSTER.maxHealth,
    );

    advanceFixedTicks(room, 1);

    const monster = room.state.monsters.get(HARE_MONSTER.id);

    assert.ok(monster);
    assert.strictEqual(monster.currentHealth, HARE_MONSTER.maxHealth - 1);
    assert.strictEqual(monster.isAlive, true);
    assert.strictEqual(monster.animation, "hurt");
    assert.strictEqual(
      room.state.monsters.get(BOAR_MONSTER.id)?.currentHealth,
      BOAR_MONSTER.maxHealth,
    );
  });

  it("damages only the boar for a valid boar attack", async () => {
    const { client, room } = await createJoinedRoom({}, BOAR_MONSTER);

    await sendAttack(room, client, { monsterId: BOAR_MONSTER.id });
    advanceFixedTicks(room, ATTACK_HIT_TICKS - 1);

    assert.strictEqual(
      room.state.monsters.get(BOAR_MONSTER.id)?.currentHealth,
      BOAR_MONSTER.maxHealth,
    );

    advanceFixedTicks(room, 1);

    const monster = room.state.monsters.get(BOAR_MONSTER.id);

    assert.ok(monster);
    assert.strictEqual(monster.currentHealth, BOAR_MONSTER.maxHealth - 1);
    assert.strictEqual(monster.isAlive, true);
    assert.strictEqual(monster.animation, "hurt");
    assert.strictEqual(
      room.state.monsters.get(HARE_MONSTER.id)?.currentHealth,
      HARE_MONSTER.maxHealth,
    );
  });

  it("starts the boar attack and damages the player on the hit frame", async () => {
    const { client, room } = await createJoinedRoom({}, BOAR_MONSTER);

    const player = room.state.players.get(client.sessionId);
    const boar = room.state.monsters.get(BOAR_MONSTER.id);

    assert.ok(player);
    assert.ok(boar);

    advanceFixedTicks(room, 1);

    assert.strictEqual(boar.animation, "attack");
    assert.strictEqual(boar.direction, "up");
    assert.strictEqual(player.currentHealth, PLAYER_MAX_HEALTH);

    advanceFixedTicks(room, BOAR_ATTACK_HIT_TICKS - 1);

    assert.strictEqual(player.currentHealth, PLAYER_MAX_HEALTH);

    advanceFixedTicks(room, 1);

    assert.strictEqual(
      player.currentHealth,
      PLAYER_MAX_HEALTH - BOAR_ATTACK_DAMAGE,
    );
    assert.strictEqual(player.isAlive, true);
  });

  it("does not damage a player who leaves range before the hit frame", async () => {
    const { client, room } = await createJoinedRoom({}, BOAR_MONSTER);

    const player = room.state.players.get(client.sessionId);

    assert.ok(player);

    advanceFixedTicks(room, 1);

    player.x = 500;
    player.y = 500;

    advanceFixedTicks(room, BOAR_ATTACK_HIT_TICKS);

    assert.strictEqual(player.currentHealth, PLAYER_MAX_HEALTH);
    assert.strictEqual(player.isAlive, true);
  });

  it("respawns a player after lethal boar damage", async () => {
    const { client, room } = await createJoinedRoom({}, BOAR_MONSTER);

    const player = room.state.players.get(client.sessionId);

    assert.ok(player);

    player.currentHealth = BOAR_ATTACK_DAMAGE;

    advanceFixedTicks(room, 1 + BOAR_ATTACK_HIT_TICKS);

    assert.strictEqual(player.currentHealth, 0);
    assert.strictEqual(player.isAlive, false);
    assert.strictEqual(player.animation, "death");

    advanceFixedTicks(room, PLAYER_RESPAWN_TICKS);

    assert.strictEqual(player.currentHealth, PLAYER_MAX_HEALTH / 2);
    assert.strictEqual(player.maxHealth, PLAYER_MAX_HEALTH);
    assert.strictEqual(player.isAlive, true);
    assert.strictEqual(player.animation, "idle");
    assert.strictEqual(player.mapId, MAP_ID);
  });

  it("rejects an attack from a different map", async () => {
    const { client, room } = await createJoinedRoom();

    const player = room.state.players.get(client.sessionId);

    assert.ok(player);

    player.mapId = "MAP_2";

    await performValidHit(room, client);

    assert.strictEqual(
      room.state.monsters.get(HARE_MONSTER.id)?.currentHealth,
      HARE_MONSTER.maxHealth,
    );
  });

  it("rejects an attack outside the maximum distance", async () => {
    const { client, room } = await createJoinedRoom();
    const player = room.state.players.get(client.sessionId);
    const hare = room.state.monsters.get(HARE_MONSTER.id);

    assert.ok(player);
    assert.ok(hare);

    player.x = hare.x - 200;
    player.y = hare.y;

    await performValidHit(room, client);

    assert.strictEqual(
      room.state.monsters.get(HARE_MONSTER.id)?.currentHealth,
      HARE_MONSTER.maxHealth,
    );
  });

  it("rejects an attack outside the directional hitbox", async () => {
    const { client, room } = await createJoinedRoom();
    const player = room.state.players.get(client.sessionId);

    assert.ok(player);

    player.direction = "left";

    await performValidHit(room, client);

    assert.strictEqual(
      room.state.monsters.get(HARE_MONSTER.id)?.currentHealth,
      HARE_MONSTER.maxHealth,
    );
  });

  it("does not apply repeated attacks during the same attack window", async () => {
    const { client, room } = await createJoinedRoom();

    await sendAttack(room, client, { monsterId: HARE_MONSTER.id });
    await sendAttack(room, client, { monsterId: HARE_MONSTER.id });
    advanceFixedTicks(room, ATTACK_HIT_TICKS);

    assert.strictEqual(
      room.state.monsters.get(HARE_MONSTER.id)?.currentHealth,
      HARE_MONSTER.maxHealth - 1,
    );
  });

  it("does not let a malformed attack acquire a later repeated target", async () => {
    const { client, room } = await createJoinedRoom();

    await sendAttack(room, client, {
      monsterId: { unexpected: true },
    });
    await sendAttack(room, client, { monsterId: HARE_MONSTER.id });
    advanceFixedTicks(room, ATTACK_HIT_TICKS);

    assert.strictEqual(
      room.state.monsters.get(HARE_MONSTER.id)?.currentHealth,
      HARE_MONSTER.maxHealth,
    );
  });

  it("rejects an unknown monster id without damaging registered monsters", async () => {
    const { client, room } = await createJoinedRoom();

    await sendAttack(room, client, { monsterId: "unknown_monster" });
    advanceFixedTicks(room, ATTACK_HIT_TICKS);

    assert.strictEqual(
      room.state.monsters.get(HARE_MONSTER.id)?.currentHealth,
      HARE_MONSTER.maxHealth,
    );
    assert.strictEqual(
      room.state.monsters.get(BOAR_MONSTER.id)?.currentHealth,
      BOAR_MONSTER.maxHealth,
    );
  });

  it("enters the authoritative hare death state after lethal damage", async () => {
    const { client, room } = await createJoinedRoom();

    await killMonster(room, client);

    const monster = room.state.monsters.get(HARE_MONSTER.id);

    assert.ok(monster);
    assert.strictEqual(monster.currentHealth, 0);
    assert.strictEqual(monster.isAlive, false);
    assert.strictEqual(monster.animation, "death");
  });

  it("removes the hare only after the 480 ms death period", async () => {
    const { client, room } = await createJoinedRoom();

    await killMonster(room, client);

    const ticksBeforeRemoval = Math.floor(
      DEATH_DURATION_MS / FIXED_TIME_STEP_MS,
    );

    advanceFixedTicks(room, ticksBeforeRemoval);

    const dyingMonster = room.state.monsters.get(HARE_MONSTER.id);

    assert.ok(dyingMonster);
    assert.strictEqual(dyingMonster.animation, "death");

    advanceFixedTicks(room, 1);

    assert.strictEqual(room.state.monsters.has(HARE_MONSTER.id), false);
  });

  it("respawns the hare after the configured delay with its spawn state", async () => {
    const { client, room } = await createJoinedRoom();

    await killMonster(room, client);

    const originalMonster = room.state.monsters.get(HARE_MONSTER.id);
    const deathTicks = Math.ceil(DEATH_DURATION_MS / FIXED_TIME_STEP_MS);

    advanceFixedTicks(room, deathTicks);

    assert.strictEqual(room.state.monsters.has(HARE_MONSTER.id), false);

    let respawnTicks = 0;
    const maximumRespawnTicks = Math.ceil(
      RESPAWN_DELAY_MS / FIXED_TIME_STEP_MS,
    ) + 1;

    while (
      !room.state.monsters.has(HARE_MONSTER.id) &&
      respawnTicks < maximumRespawnTicks
    ) {
      advanceFixedTicks(room, 1);
      respawnTicks += 1;
    }

    const simulatedRespawnDelay = respawnTicks * FIXED_TIME_STEP_MS;

    assert.ok(
      simulatedRespawnDelay >= RESPAWN_DELAY_MS - FIXED_TIME_STEP_MS,
    );
    assert.ok(
      simulatedRespawnDelay <= RESPAWN_DELAY_MS + FIXED_TIME_STEP_MS,
    );

    const respawnedMonster = room.state.monsters.get(HARE_MONSTER.id);

    assert.ok(respawnedMonster);
    assert.notStrictEqual(respawnedMonster, originalMonster);
    assert.strictEqual(respawnedMonster.monsterType, HARE_MONSTER.type);
    assert.strictEqual(respawnedMonster.mapId, HARE_MONSTER.mapId);
    assert.ok(Number.isFinite(respawnedMonster.x));
    assert.ok(Number.isFinite(respawnedMonster.y));
    assert.strictEqual(respawnedMonster.direction, "down");
    assert.strictEqual(respawnedMonster.animation, "idle");
    assert.strictEqual(respawnedMonster.currentHealth, HARE_MONSTER.maxHealth);
    assert.strictEqual(respawnedMonster.maxHealth, HARE_MONSTER.maxHealth);
    assert.strictEqual(respawnedMonster.isAlive, true);
  });

  it("kills, removes, and respawns the boar through the shared lifecycle", async () => {
    const { client, room } = await createJoinedRoom({}, BOAR_MONSTER);
    const originalBoar = room.state.monsters.get(BOAR_MONSTER.id);

    assert.ok(originalBoar);

    await killMonster(room, client, BOAR_MONSTER);

    const deadBoar = room.state.monsters.get(BOAR_MONSTER.id);

    assert.ok(deadBoar);
    assert.strictEqual(deadBoar.currentHealth, 0);
    assert.strictEqual(deadBoar.isAlive, false);
    assert.strictEqual(deadBoar.animation, "death");
    assert.strictEqual(
      room.state.monsters.get(HARE_MONSTER.id)?.currentHealth,
      HARE_MONSTER.maxHealth,
    );

    const ticksBeforeRemoval = Math.floor(
      DEATH_DURATION_MS / FIXED_TIME_STEP_MS,
    );

    advanceFixedTicks(room, ticksBeforeRemoval);

    const dyingBoar = room.state.monsters.get(BOAR_MONSTER.id);

    assert.ok(dyingBoar);
    assert.strictEqual(dyingBoar.animation, "death");

    advanceFixedTicks(room, 1);

    assert.strictEqual(room.state.monsters.has(BOAR_MONSTER.id), false);

    let respawnTicks = 0;
    const maximumRespawnTicks = Math.ceil(
      RESPAWN_DELAY_MS / FIXED_TIME_STEP_MS,
    ) + 1;

    while (
      !room.state.monsters.has(BOAR_MONSTER.id) &&
      respawnTicks < maximumRespawnTicks
    ) {
      advanceFixedTicks(room, 1);
      respawnTicks += 1;
    }

    const simulatedRespawnDelay = respawnTicks * FIXED_TIME_STEP_MS;

    assert.ok(
      simulatedRespawnDelay >= RESPAWN_DELAY_MS - FIXED_TIME_STEP_MS,
    );
    assert.ok(
      simulatedRespawnDelay <= RESPAWN_DELAY_MS + FIXED_TIME_STEP_MS,
    );

    const respawnedBoar = room.state.monsters.get(BOAR_MONSTER.id);

    assert.ok(respawnedBoar);
    assert.notStrictEqual(respawnedBoar, originalBoar);
    assert.strictEqual(respawnedBoar.monsterType, BOAR_MONSTER.type);
    assert.strictEqual(respawnedBoar.mapId, BOAR_MONSTER.mapId);
    assert.ok(Number.isFinite(respawnedBoar.x));
    assert.ok(Number.isFinite(respawnedBoar.y));
    assert.strictEqual(respawnedBoar.direction, "down");
    assert.strictEqual(respawnedBoar.animation, "idle");
    assert.strictEqual(respawnedBoar.currentHealth, BOAR_MONSTER.maxHealth);
    assert.strictEqual(respawnedBoar.maxHealth, BOAR_MONSTER.maxHealth);
    assert.strictEqual(respawnedBoar.isAlive, true);
  });
});
