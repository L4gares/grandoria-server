import assert from "node:assert/strict";

import { MyRoom } from "../src/rooms/MyRoom.js";
import { PlayerState } from "../src/rooms/schema/MyRoomState.js";

const MAP_ID = "MAP_1";
const FIXED_TIME_STEP_MS = 1000 / 60;
const HARE_ID = "map1_hare_001";
const BOAR_ID = "map1_boar_001";

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

    testRoom.monsterRandom = () => 1;
    rooms.push(testRoom);

    return testRoom;
  }

  it("detects a player at 128 pixels but not at 129 pixels", async () => {
    const room = await createRoom();
    const player = addPlayer(room, "player", 297, 968);
    const hare = room.state.monsters.get(HARE_ID);

    assert.ok(hare);

    advanceFixedTicks(room, 1);
    assertClose(hare.x, 168);

    player.x = 296;

    advanceFixedTicks(room, 1);
    assert.ok(hare.x < 168);
  });

  it("makes the hare flee at 45 pixels per second", async () => {
    const room = await createRoom();

    addPlayer(room, "player", 200, 968);

    advanceFixedTicks(room, 60);

    const hare = room.state.monsters.get(HARE_ID);

    assert.ok(hare);
    assertClose(hare.x, 123);
    assertClose(hare.y, 968);
    assert.strictEqual(hare.direction, "left");
    assert.strictEqual(hare.animation, "run");
  });

  it("reacts to the closest player on the same map", async () => {
    const room = await createRoom();

    addPlayer(room, "far-player", 100, 968);
    addPlayer(room, "near-player", 180, 968);

    const hare = room.state.monsters.get(HARE_ID);

    assert.ok(hare);

    advanceFixedTicks(room, 1);

    assert.ok(hare.x < 168);
    assert.strictEqual(hare.direction, "left");
  });

  it("makes the boar chase at 50 pixels per second", async () => {
    const room = await createRoom();

    addPlayer(room, "player", 250, 1056);

    advanceFixedTicks(room, 30);

    const boar = room.state.monsters.get(BOAR_ID);

    assert.ok(boar);
    assertClose(boar.x, 169);
    assertClose(boar.y, 1056);
    assert.strictEqual(boar.direction, "right");
    assert.strictEqual(boar.animation, "run");
  });

  it("keeps the acquired target until it passes 192 pixels", async () => {
    const room = await createRoom();
    const player = addPlayer(room, "player", 250, 1056);
    const boar = room.state.monsters.get(BOAR_ID);

    assert.ok(boar);

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
    const player = addPlayer(room, "player", 250, 1056);
    const boar = room.state.monsters.get(BOAR_ID);

    assert.ok(boar);

    advanceFixedTicks(room, 30);
    assertClose(boar.x, 169);

    player.x = 400;

    advanceFixedTicks(room, 120);

    assertClose(boar.x, 144);
    assertClose(boar.y, 1056);
    assert.strictEqual(boar.direction, "down");
    assert.strictEqual(boar.animation, "idle");
  });

  it("does not let a reaction leave the 192 pixel home leash", async () => {
    const room = await createRoom();
    const player = addPlayer(room, "player", 200, 1056);
    const boar = room.state.monsters.get(BOAR_ID);

    assert.ok(boar);

    advanceFixedTicks(room, 1);

    boar.x = 335.9;
    boar.y = 1056;
    player.x = 385.9;
    player.y = 1056;

    const beforeLeash = boar.x;

    advanceFixedTicks(room, 1);

    assert.ok(boar.x < beforeLeash);
    assert.ok(Math.hypot(boar.x - 144, boar.y - 1056) < 192);
  });

  it("stops the boar near the player while respecting attack cadence", async () => {
    const room = await createRoom();
    const player = addPlayer(room, "player", 200, 1056);

    advanceFixedTicks(room, 300);

    const boar = room.state.monsters.get(BOAR_ID);

    assert.ok(boar);
    assertClose(Math.hypot(player.x - boar.x, player.y - boar.y), 16);
    assert.ok(player.currentHealth < player.maxHealth);
    assert.strictEqual(boar.animation, "idle");
  });

  it("ignores players on another map", async () => {
    const room = await createRoom();
    const player = addPlayer(room, "player", 200, 968);
    const hare = room.state.monsters.get(HARE_ID);

    assert.ok(hare);

    player.mapId = "MAP_2";

    advanceFixedTicks(room, 60);

    assertClose(hare.x, 168);
    assertClose(hare.y, 968);
    assert.strictEqual(hare.animation, "idle");
  });
});
