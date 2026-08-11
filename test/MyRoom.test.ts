import assert from "node:assert/strict";

import type { Room as ClientRoom } from "@colyseus/sdk";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { MyRoom } from "../src/rooms/MyRoom.js";

const ROOM_NAME = "my_room";
const MAP_ID = "MAP_1";
const FIXED_TIME_STEP_MS = 1000 / 60;
const ATTACK_HIT_TICKS = 15;
const ATTACK_FINISH_TICKS_AFTER_HIT = 5;
const DEATH_DURATION_MS = 480;
const RESPAWN_DELAY_MS = 10_000;
const PLAYER_MAX_HEALTH = 50;
const BOAR_ATTACK_DAMAGE = 7;
const BOAR_ATTACK_HIT_TICKS = 15;
const PLAYER_RESPAWN_TICKS = 180;

type MonsterFixture = {
  id: string;
  type: string;
  mapId: string;
  x: number;
  y: number;
  direction: "up" | "down" | "left" | "right";
  maxHealth: number;
  attackPosition: {
    x: number;
    y: number;
    direction: "up" | "down" | "left" | "right";
  };
};

const HARE_MONSTER: MonsterFixture = {
  id: "map1_hare_001",
  type: "mob_hare",
  mapId: MAP_ID,
  x: 168,
  y: 968,
  direction: "down",
  maxHealth: 2,
  attackPosition: {
    x: 150,
    y: 968,
    direction: "right",
  },
};

const BOAR_MONSTER: MonsterFixture = {
  id: "map1_boar_001",
  type: "mob_boar",
  mapId: MAP_ID,
  x: 144,
  y: 1056,
  direction: "down",
  maxHealth: 10,
  attackPosition: {
    x: 144,
    y: 1032,
    direction: "down",
  },
};

const DEFAULT_JOIN_OPTIONS = {
  playerUid: "test-player",
  characterId: "test-character",
  characterName: "Test Character",
  mapId: MAP_ID,
  x: HARE_MONSTER.attackPosition.x,
  y: HARE_MONSTER.attackPosition.y,
  direction: HARE_MONSTER.attackPosition.direction,
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

  async function createJoinedRoom(overrides: Partial<JoinOptions> = {}) {
    const room = await colyseus.createRoom<MyRoom>(ROOM_NAME, {});

    // Stop only this test room's native interval. Tests advance the same
    // production simulation step synchronously without real-time sleeps.
    room.setSimulationInterval();

    const client = await colyseus.connectTo(room, {
      ...DEFAULT_JOIN_OPTIONS,
      ...overrides,
    });

    return {
      client,
      room: room as unknown as TestableMyRoom,
    };
  }

  function getAttackJoinOptions(monster: MonsterFixture): Partial<JoinOptions> {
    return {
      mapId: monster.mapId,
      x: monster.attackPosition.x,
      y: monster.attackPosition.y,
      direction: monster.attackPosition.direction,
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
      await performValidHit(room, client, monster);

      if (hit < monster.maxHealth - 1) {
        advanceFixedTicks(room, ATTACK_FINISH_TICKS_AFTER_HIT);
      }
    }
  }

  it("synchronizes the joined player and both initial monster types", async () => {
    const { client, room } = await createJoinedRoom();

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
    assert.strictEqual(serverPlayer.x, DEFAULT_JOIN_OPTIONS.x);
    assert.strictEqual(serverPlayer.y, DEFAULT_JOIN_OPTIONS.y);
    assert.strictEqual(serverPlayer.direction, DEFAULT_JOIN_OPTIONS.direction);
    assert.strictEqual(serverPlayer.currentHealth, PLAYER_MAX_HEALTH);
    assert.strictEqual(serverPlayer.maxHealth, PLAYER_MAX_HEALTH);
    assert.strictEqual(serverPlayer.isAlive, true);

    assert.ok(serverHare);
    assert.strictEqual(serverHare.monsterType, HARE_MONSTER.type);
    assert.strictEqual(serverHare.mapId, HARE_MONSTER.mapId);
    assert.strictEqual(serverHare.x, HARE_MONSTER.x);
    assert.strictEqual(serverHare.y, HARE_MONSTER.y);
    assert.strictEqual(serverHare.direction, HARE_MONSTER.direction);
    assert.strictEqual(serverHare.animation, "idle");
    assert.strictEqual(serverHare.currentHealth, HARE_MONSTER.maxHealth);
    assert.strictEqual(serverHare.maxHealth, HARE_MONSTER.maxHealth);
    assert.strictEqual(serverHare.isAlive, true);

    assert.ok(serverBoar);
    assert.strictEqual(serverBoar.monsterType, BOAR_MONSTER.type);
    assert.strictEqual(serverBoar.mapId, BOAR_MONSTER.mapId);
    assert.strictEqual(serverBoar.x, BOAR_MONSTER.x);
    assert.strictEqual(serverBoar.y, BOAR_MONSTER.y);
    assert.strictEqual(serverBoar.direction, BOAR_MONSTER.direction);
    assert.strictEqual(serverBoar.animation, "idle");
    assert.strictEqual(serverBoar.currentHealth, BOAR_MONSTER.maxHealth);
    assert.strictEqual(serverBoar.maxHealth, BOAR_MONSTER.maxHealth);
    assert.strictEqual(serverBoar.isAlive, true);

    assert.ok(syncedPlayer);
    assert.strictEqual(syncedPlayer.mapId, MAP_ID);
    assert.ok(syncedHare);
    assert.strictEqual(syncedHare.monsterType, HARE_MONSTER.type);
    assert.strictEqual(syncedHare.currentHealth, HARE_MONSTER.maxHealth);
    assert.strictEqual(syncedHare.isAlive, true);
    assert.ok(syncedBoar);
    assert.strictEqual(syncedBoar.monsterType, BOAR_MONSTER.type);
    assert.strictEqual(syncedBoar.currentHealth, BOAR_MONSTER.maxHealth);
    assert.strictEqual(syncedBoar.isAlive, true);
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
    const { client, room } = await createJoinedRoom(
      getAttackJoinOptions(BOAR_MONSTER),
    );

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
    const { client, room } = await createJoinedRoom(
      getAttackJoinOptions(BOAR_MONSTER),
    );

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
    const { client, room } = await createJoinedRoom(
      getAttackJoinOptions(BOAR_MONSTER),
    );

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
    const { client, room } = await createJoinedRoom(
      getAttackJoinOptions(BOAR_MONSTER),
    );

    const player = room.state.players.get(client.sessionId);

    assert.ok(player);

    player.currentHealth = BOAR_ATTACK_DAMAGE;

    advanceFixedTicks(room, 1 + BOAR_ATTACK_HIT_TICKS);

    assert.strictEqual(player.currentHealth, 0);
    assert.strictEqual(player.isAlive, false);
    assert.strictEqual(player.animation, "death");

    advanceFixedTicks(room, PLAYER_RESPAWN_TICKS);

    assert.strictEqual(player.currentHealth, PLAYER_MAX_HEALTH);
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
    const { client, room } = await createJoinedRoom({ x: 100 });

    await performValidHit(room, client);

    assert.strictEqual(
      room.state.monsters.get(HARE_MONSTER.id)?.currentHealth,
      HARE_MONSTER.maxHealth,
    );
  });

  it("rejects an attack outside the directional hitbox", async () => {
    const { client, room } = await createJoinedRoom({ direction: "left" });

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
    assert.strictEqual(respawnedMonster.x, HARE_MONSTER.x);
    assert.strictEqual(respawnedMonster.y, HARE_MONSTER.y);
    assert.strictEqual(respawnedMonster.direction, HARE_MONSTER.direction);
    assert.strictEqual(respawnedMonster.animation, "idle");
    assert.strictEqual(respawnedMonster.currentHealth, HARE_MONSTER.maxHealth);
    assert.strictEqual(respawnedMonster.maxHealth, HARE_MONSTER.maxHealth);
    assert.strictEqual(respawnedMonster.isAlive, true);
  });

  it("kills, removes, and respawns the boar through the shared lifecycle", async () => {
    const { client, room } = await createJoinedRoom(
      getAttackJoinOptions(BOAR_MONSTER),
    );
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
    assert.strictEqual(respawnedBoar.x, BOAR_MONSTER.x);
    assert.strictEqual(respawnedBoar.y, BOAR_MONSTER.y);
    assert.strictEqual(respawnedBoar.direction, BOAR_MONSTER.direction);
    assert.strictEqual(respawnedBoar.animation, "idle");
    assert.strictEqual(respawnedBoar.currentHealth, BOAR_MONSTER.maxHealth);
    assert.strictEqual(respawnedBoar.maxHealth, BOAR_MONSTER.maxHealth);
    assert.strictEqual(respawnedBoar.isAlive, true);
  });
});
