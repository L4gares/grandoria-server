import assert from "node:assert/strict";

import { MyRoom } from "../src/rooms/MyRoom.js";
import { PlayerState } from "../src/rooms/schema/MyRoomState.js";

const MAP_ID = "MAP_1";
const FIXED_TIME_STEP_MS = 1000 / 60;
const HARE_ID = "grassland_hare_01__001";
const BOAR_ID = "grassland_boar_01__001";

type TestableMyRoom = MyRoom & {
  fixedTick(deltaTime: number): void;
  monsterRandom: () => number;
};

function advanceFixedTicks(room: TestableMyRoom, tickCount: number) {
  for (let tick = 0; tick < tickCount; tick += 1) {
    room.fixedTick(FIXED_TIME_STEP_MS);
  }
}

function addPlayer(
  room: TestableMyRoom,
  sessionId: string,
  x: number,
  y: number,
) {
  const player = new PlayerState();

  player.mapId = MAP_ID;
  player.x = x;
  player.y = y;

  room.state.players.set(sessionId, player);

  return player;
}

function assertClose(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${expected}, received ${actual}`,
  );
}

describe("MyRoom authoritative monster reactions", () => {
  const rooms: TestableMyRoom[] = [];

  afterEach(() => {
    for (const room of rooms) {
      room.onDispose();
    }

    rooms.length = 0;
  });

  async function createRoom() {
    const room = new MyRoom();

    room.onCreate();

    room.setSimulationInterval();

    const testRoom = room as unknown as TestableMyRoom;

    for (const monsterId of testRoom.state.monsters.keys()) {
      if (monsterId !== HARE_ID && monsterId !== BOAR_ID) {
        testRoom.state.monsters.delete(monsterId);
      }
    }

    testRoom.monsterRandom = () => 1;
    rooms.push(testRoom);

    return testRoom;
  }

  it("detects a player at 128 pixels but not at 129 pixels", async () => {
    const room = await createRoom();
    const hare = room.state.monsters.get(HARE_ID);

    assert.ok(hare);

    const spawnX = hare.x;
    const spawnY = hare.y;
    const player = addPlayer(room, "player", spawnX + 129, spawnY);

    advanceFixedTicks(room, 1);
    assertClose(hare.x, spawnX);

    player.x = spawnX + 128;

    advanceFixedTicks(room, 1);
    assert.ok(hare.x < spawnX);
  });

  it("makes the hare flee at 45 pixels per second", async () => {
    const room = await createRoom();
    const hare = room.state.monsters.get(HARE_ID);

    assert.ok(hare);

    const spawnX = hare.x;
    const spawnY = hare.y;

    addPlayer(room, "player", spawnX + 32, spawnY);

    advanceFixedTicks(room, 60);

    assertClose(hare.x, spawnX - 45);
    assertClose(hare.y, spawnY);
    assert.strictEqual(hare.direction, "left");
    assert.strictEqual(hare.animation, "run");
  });

  it("reacts to the closest player on the same map", async () => {
    const room = await createRoom();
    const hare = room.state.monsters.get(HARE_ID);

    assert.ok(hare);

    const spawnX = hare.x;
    const spawnY = hare.y;

    addPlayer(room, "far-player", spawnX - 68, spawnY);
    addPlayer(room, "near-player", spawnX + 12, spawnY);

    advanceFixedTicks(room, 1);

    assert.ok(hare.x < spawnX);
    assert.strictEqual(hare.direction, "left");
  });

  it("makes the boar chase at 50 pixels per second", async () => {
    const room = await createRoom();
    const boar = room.state.monsters.get(BOAR_ID);

    assert.ok(boar);

    const spawnX = boar.x;
    const spawnY = boar.y;

    addPlayer(room, "player", spawnX + 106, spawnY);

    advanceFixedTicks(room, 30);

    assertClose(boar.x, spawnX + 25);
    assertClose(boar.y, spawnY);
    assert.strictEqual(boar.direction, "right");
    assert.strictEqual(boar.animation, "run");
  });

  it("keeps the acquired target until it passes 192 pixels", async () => {
    const room = await createRoom();
    const boar = room.state.monsters.get(BOAR_ID);

    assert.ok(boar);

    const player = addPlayer(room, "player", boar.x + 106, boar.y);

    advanceFixedTicks(room, 1);

    player.x = boar.x + 180;

    const beforeRetainedTarget = boar.x;

    advanceFixedTicks(room, 1);
    assert.ok(boar.x > beforeRetainedTarget);

    player.x = boar.x + 193;

    const beforeReturn = boar.x;

    advanceFixedTicks(room, 1);
    assert.ok(boar.x < beforeReturn);
  });

  it("returns to the spawn after losing the target", async () => {
    const room = await createRoom();
    const boar = room.state.monsters.get(BOAR_ID);

    assert.ok(boar);

    const spawnX = boar.x;
    const spawnY = boar.y;
    const player = addPlayer(room, "player", spawnX + 106, spawnY);

    advanceFixedTicks(room, 30);
    assertClose(boar.x, spawnX + 25);

    player.x = spawnX + 256;

    advanceFixedTicks(room, 120);

    assertClose(boar.x, spawnX);
    assertClose(boar.y, spawnY);
    assert.strictEqual(boar.direction, "down");
    assert.strictEqual(boar.animation, "idle");
  });

  it("does not let a reaction leave the 192 pixel home leash", async () => {
    const room = await createRoom();
    const boar = room.state.monsters.get(BOAR_ID);

    assert.ok(boar);

    const spawnX = boar.x;
    const spawnY = boar.y;
    const player = addPlayer(room, "player", spawnX + 56, spawnY);

    advanceFixedTicks(room, 1);

    boar.x = spawnX + 191.9;
    boar.y = spawnY;
    player.x = boar.x + 50;
    player.y = spawnY;

    const beforeLeash = boar.x;

    advanceFixedTicks(room, 1);

    assert.ok(boar.x < beforeLeash);
    assert.ok(Math.hypot(boar.x - spawnX, boar.y - spawnY) < 192);
  });

  it("stops the boar near the player while respecting attack cadence", async () => {
    const room = await createRoom();
    const boar = room.state.monsters.get(BOAR_ID);

    assert.ok(boar);

    const player = addPlayer(room, "player", boar.x + 56, boar.y);

    advanceFixedTicks(room, 300);

    assertClose(Math.hypot(player.x - boar.x, player.y - boar.y), 16);
    assert.ok(player.currentHealth < player.maxHealth);
    assert.strictEqual(boar.animation, "idle");
  });

  it("ignores players on another map", async () => {
    const room = await createRoom();
    const hare = room.state.monsters.get(HARE_ID);

    assert.ok(hare);

    const spawnX = hare.x;
    const spawnY = hare.y;
    const player = addPlayer(room, "player", spawnX + 32, spawnY);

    player.mapId = "MAP_2";

    advanceFixedTicks(room, 60);

    assertClose(hare.x, spawnX);
    assertClose(hare.y, spawnY);
    assert.strictEqual(hare.animation, "idle");
  });
});
