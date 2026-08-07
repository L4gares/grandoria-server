import assert from "node:assert/strict";

import type { Room as ClientRoom } from "@colyseus/sdk";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { MyRoom } from "../src/rooms/MyRoom.js";

const ROOM_NAME = "my_room";
const MONSTER_ID = "map1_hare_001";
const MONSTER_TYPE = "mob_hare";
const MAP_ID = "MAP_1";
const FIXED_TIME_STEP_MS = 1000 / 60;
const ATTACK_HIT_TICKS = 15;
const ATTACK_FINISH_TICKS_AFTER_HIT = 5;
const DEATH_DURATION_MS = 480;
const RESPAWN_DELAY_MS = 10_000;

const DEFAULT_JOIN_OPTIONS = {
  playerUid: "test-player",
  characterId: "test-character",
  characterName: "Test Character",
  mapId: MAP_ID,
  x: 150,
  y: 968,
  direction: "right",
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

  async function performValidHit(
    room: TestableMyRoom,
    client: GrandoriaClient,
  ) {
    await sendAttack(room, client, { monsterId: MONSTER_ID });
    advanceFixedTicks(room, ATTACK_HIT_TICKS);
  }

  async function killMonster(
    room: TestableMyRoom,
    client: GrandoriaClient,
  ) {
    await performValidHit(room, client);
    advanceFixedTicks(room, ATTACK_FINISH_TICKS_AFTER_HIT);
    await performValidHit(room, client);
  }

  it("synchronizes the joined player and initial monster state", async () => {
    const { client, room } = await createJoinedRoom();

    assert.strictEqual(client.sessionId, room.clients[0].sessionId);

    await room.waitForNextPatch();

    const serverPlayer = room.state.players.get(client.sessionId);
    const serverMonster = room.state.monsters.get(MONSTER_ID);
    const syncedPlayer = client.state.players.get(client.sessionId);
    const syncedMonster = client.state.monsters.get(MONSTER_ID);

    assert.ok(serverPlayer);
    assert.strictEqual(serverPlayer.mapId, MAP_ID);
    assert.strictEqual(serverPlayer.x, DEFAULT_JOIN_OPTIONS.x);
    assert.strictEqual(serverPlayer.y, DEFAULT_JOIN_OPTIONS.y);
    assert.strictEqual(serverPlayer.direction, DEFAULT_JOIN_OPTIONS.direction);

    assert.ok(serverMonster);
    assert.strictEqual(serverMonster.monsterType, MONSTER_TYPE);
    assert.strictEqual(serverMonster.mapId, MAP_ID);
    assert.strictEqual(serverMonster.x, 168);
    assert.strictEqual(serverMonster.y, 968);
    assert.strictEqual(serverMonster.direction, "down");
    assert.strictEqual(serverMonster.animation, "idle");
    assert.strictEqual(serverMonster.currentHealth, 2);
    assert.strictEqual(serverMonster.maxHealth, 2);
    assert.strictEqual(serverMonster.isAlive, true);

    assert.ok(syncedPlayer);
    assert.strictEqual(syncedPlayer.mapId, MAP_ID);
    assert.ok(syncedMonster);
    assert.strictEqual(syncedMonster.monsterType, MONSTER_TYPE);
    assert.strictEqual(syncedMonster.currentHealth, 2);
    assert.strictEqual(syncedMonster.isAlive, true);
  });

  it("damages a monster for a valid attack", async () => {
    const { client, room } = await createJoinedRoom();

    await sendAttack(room, client, { monsterId: MONSTER_ID });
    advanceFixedTicks(room, ATTACK_HIT_TICKS - 1);

    assert.strictEqual(room.state.monsters.get(MONSTER_ID)?.currentHealth, 2);

    advanceFixedTicks(room, 1);

    const monster = room.state.monsters.get(MONSTER_ID);

    assert.ok(monster);
    assert.strictEqual(monster.currentHealth, 1);
    assert.strictEqual(monster.isAlive, true);
    assert.strictEqual(monster.animation, "hurt");
  });

  it("rejects an attack from a different map", async () => {
    const { client, room } = await createJoinedRoom({ mapId: "MAP_2" });

    await performValidHit(room, client);

    assert.strictEqual(room.state.monsters.get(MONSTER_ID)?.currentHealth, 2);
  });

  it("rejects an attack outside the maximum distance", async () => {
    const { client, room } = await createJoinedRoom({ x: 100 });

    await performValidHit(room, client);

    assert.strictEqual(room.state.monsters.get(MONSTER_ID)?.currentHealth, 2);
  });

  it("rejects an attack outside the directional hitbox", async () => {
    const { client, room } = await createJoinedRoom({ direction: "left" });

    await performValidHit(room, client);

    assert.strictEqual(room.state.monsters.get(MONSTER_ID)?.currentHealth, 2);
  });

  it("does not apply repeated attacks during the same attack window", async () => {
    const { client, room } = await createJoinedRoom();

    await sendAttack(room, client, { monsterId: MONSTER_ID });
    await sendAttack(room, client, { monsterId: MONSTER_ID });
    advanceFixedTicks(room, ATTACK_HIT_TICKS);

    assert.strictEqual(room.state.monsters.get(MONSTER_ID)?.currentHealth, 1);
  });

  it("does not let a malformed attack acquire a later repeated target", async () => {
    const { client, room } = await createJoinedRoom();

    await sendAttack(room, client, {
      monsterId: { unexpected: true },
    });
    await sendAttack(room, client, { monsterId: MONSTER_ID });
    advanceFixedTicks(room, ATTACK_HIT_TICKS);

    assert.strictEqual(room.state.monsters.get(MONSTER_ID)?.currentHealth, 2);
  });

  it("enters the authoritative death state after lethal damage", async () => {
    const { client, room } = await createJoinedRoom();

    await killMonster(room, client);

    const monster = room.state.monsters.get(MONSTER_ID);

    assert.ok(monster);
    assert.strictEqual(monster.currentHealth, 0);
    assert.strictEqual(monster.isAlive, false);
    assert.strictEqual(monster.animation, "death");
  });

  it("removes the monster only after the 480 ms death period", async () => {
    const { client, room } = await createJoinedRoom();

    await killMonster(room, client);

    const ticksBeforeRemoval = Math.floor(
      DEATH_DURATION_MS / FIXED_TIME_STEP_MS,
    );

    advanceFixedTicks(room, ticksBeforeRemoval);

    const dyingMonster = room.state.monsters.get(MONSTER_ID);

    assert.ok(dyingMonster);
    assert.strictEqual(dyingMonster.animation, "death");

    advanceFixedTicks(room, 1);

    assert.strictEqual(room.state.monsters.has(MONSTER_ID), false);
  });

  it("respawns the monster after the configured delay with its spawn state", async () => {
    const { client, room } = await createJoinedRoom();

    await killMonster(room, client);

    const originalMonster = room.state.monsters.get(MONSTER_ID);
    const deathTicks = Math.ceil(DEATH_DURATION_MS / FIXED_TIME_STEP_MS);

    advanceFixedTicks(room, deathTicks);

    assert.strictEqual(room.state.monsters.has(MONSTER_ID), false);

    let respawnTicks = 0;
    const maximumRespawnTicks = Math.ceil(
      RESPAWN_DELAY_MS / FIXED_TIME_STEP_MS,
    ) + 1;

    while (
      !room.state.monsters.has(MONSTER_ID) &&
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

    const respawnedMonster = room.state.monsters.get(MONSTER_ID);

    assert.ok(respawnedMonster);
    assert.notStrictEqual(respawnedMonster, originalMonster);
    assert.strictEqual(respawnedMonster.monsterType, MONSTER_TYPE);
    assert.strictEqual(respawnedMonster.mapId, MAP_ID);
    assert.strictEqual(respawnedMonster.x, 168);
    assert.strictEqual(respawnedMonster.y, 968);
    assert.strictEqual(respawnedMonster.direction, "down");
    assert.strictEqual(respawnedMonster.animation, "idle");
    assert.strictEqual(respawnedMonster.currentHealth, 2);
    assert.strictEqual(respawnedMonster.maxHealth, 2);
    assert.strictEqual(respawnedMonster.isAlive, true);
  });
});
