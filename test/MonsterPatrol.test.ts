import assert from "node:assert/strict";

import { MyRoom } from "../src/rooms/MyRoom.js";
import {
  resolveMonsterMovement,
  resolvePlayerMovement,
} from "../src/world/WorldCollision.js";

const FIXED_TIME_STEP_MS = 1000 / 60;
const HARE_ID = "grassland_hare_01__001";
const BOAR_ID = "grassland_boar_01__001";

type TestableMyRoom = MyRoom & {
  fixedTick(deltaTime: number): void;
  monsterHurtRemaining: Map<string, number>;
  monsterRandom: () => number;
  monsterSpawnsById: Map<string, { x: number; y: number }>;
};

function advanceFixedTicks(room: TestableMyRoom, tickCount: number) {
  for (let tick = 0; tick < tickCount; tick += 1) {
    room.fixedTick(FIXED_TIME_STEP_MS);
  }
}

function createRandomSequence(values: number[], fallback = 1) {
  let index = 0;

  return () => {
    const value = values[index] ?? fallback;
    index += 1;
    return value;
  };
}

function assertClose(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${expected}, received ${actual}`,
  );
}

function placeMonster(
  room: TestableMyRoom,
  monsterId: string,
  x: number,
  y: number,
) {
  const monster = room.state.monsters.get(monsterId);
  const spawn = room.monsterSpawnsById.get(monsterId);

  assert.ok(monster);
  assert.ok(spawn);

  monster.x = x;
  monster.y = y;
  spawn.x = x;
  spawn.y = y;
}

describe("MyRoom authoritative monster patrol", () => {
  const rooms: TestableMyRoom[] = [];

  afterEach(() => {
    for (const room of rooms) {
      room.onDispose();
    }

    rooms.length = 0;
  });

  async function createRoom(randomValues: number[]) {
    const room = new MyRoom();

    room.onCreate();

    room.setSimulationInterval();

    const testRoom = room as unknown as TestableMyRoom;

    for (const monsterId of testRoom.state.monsters.keys()) {
      if (monsterId !== HARE_ID && monsterId !== BOAR_ID) {
        testRoom.state.monsters.delete(monsterId);
      }
    }

    placeMonster(testRoom, HARE_ID, 110, 870);
    placeMonster(testRoom, BOAR_ID, 120, 1120);

    testRoom.monsterRandom = createRandomSequence(randomValues);
    rooms.push(testRoom);

    return testRoom;
  }

  it("moves the hare at 25 pixels per second and can idle the boar", async () => {
    const room = await createRoom([0, 1, 0, 0.5, 0.5]);
    const hare = room.state.monsters.get(HARE_ID);
    const boar = room.state.monsters.get(BOAR_ID);

    assert.ok(hare);
    assert.ok(boar);

    const hareStartX = hare.x;
    const hareStartY = hare.y;
    const boarStartX = boar.x;
    const boarStartY = boar.y;

    advanceFixedTicks(room, 60);

    assertClose(hare.x, hareStartX + 25);
    assertClose(hare.y, hareStartY);
    assert.strictEqual(hare.direction, "right");
    assert.strictEqual(hare.animation, "walk");
    assertClose(boar.x, boarStartX);
    assertClose(boar.y, boarStartY);
    assert.strictEqual(boar.animation, "idle");
  });

  it("moves the boar at 15 pixels per second", async () => {
    const room = await createRoom([0, 0, 0.5, 1, 1]);
    const hare = room.state.monsters.get(HARE_ID);
    const boar = room.state.monsters.get(BOAR_ID);

    assert.ok(hare);
    assert.ok(boar);

    const hareStartX = hare.x;
    const boarStartX = boar.x;
    const boarStartY = boar.y;

    advanceFixedTicks(room, 60);

    assertClose(hare.x, hareStartX);
    assertClose(boar.x, boarStartX + 15);
    assertClose(boar.y, boarStartY);
    assert.strictEqual(boar.direction, "right");
    assert.strictEqual(boar.animation, "walk");
  });

  it("never leaves the 96 pixel patrol radius", async () => {
    const room = await createRoom([0, 1, 1, 0, 0.5]);
    const hare = room.state.monsters.get(HARE_ID);

    assert.ok(hare);

    const spawnX = hare.x;
    const spawnY = hare.y;

    advanceFixedTicks(room, 600);

    const distanceFromSpawn = Math.hypot(hare.x - spawnX, hare.y - spawnY);

    assert.ok(distanceFromSpawn <= 96);
    assert.ok(distanceFromSpawn >= 95.5);
    assert.strictEqual(hare.animation, "idle");
  });

  it("uses monster body profiles and the monster-only collision channel", () => {
    const playerMovement = resolvePlayerMovement(
      "MAP_1",
      727,
      1280,
      20,
      0,
    );

    const hareMovement = resolveMonsterMovement(
      "MAP_1",
      "mob_hare",
      727,
      1280,
      20,
      0,
    );

    const boarMovement = resolveMonsterMovement(
      "MAP_1",
      "mob_boar",
      727,
      1280,
      20,
      0,
    );

    assert.strictEqual(playerMovement.blockedX, false);
    assert.strictEqual(playerMovement.x, 747);
    assert.strictEqual(hareMovement.blockedX, true);
    assert.ok(hareMovement.x < 736);
    assert.strictEqual(boarMovement.blockedX, true);
    assert.ok(boarMovement.x < 736);
  });

  it("stops movement throughout hurt and death states", async () => {
    const room = await createRoom([0, 0, 0.5, 1, 1]);

    advanceFixedTicks(room, 30);

    const hare = room.state.monsters.get(HARE_ID);

    assert.ok(hare);

    room.monsterHurtRemaining.set(HARE_ID, 320);
    hare.animation = "hurt";

    const hurtX = hare.x;
    const hurtY = hare.y;

    advanceFixedTicks(room, 10);

    assertClose(hare.x, hurtX);
    assertClose(hare.y, hurtY);
    assert.strictEqual(hare.animation, "hurt");

    hare.isAlive = false;
    hare.currentHealth = 0;
    hare.animation = "death";

    advanceFixedTicks(room, 10);

    assertClose(hare.x, hurtX);
    assertClose(hare.y, hurtY);
    assert.strictEqual(hare.animation, "death");
  });
});
