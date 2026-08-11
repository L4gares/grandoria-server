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
const HARE_ID = "map1_hare_001";

const DEFAULT_JOIN_OPTIONS = {
  playerUid: "test-player",
  characterId: "test-character",
  characterName: "Test Character",
  mapId: MAP_ID,
  x: 150,
  y: 968,
  direction: "right",
};

type PublicMyRoom = {
  [Key in keyof MyRoom]: MyRoom[Key];
};

type TestableMyRoom = PublicMyRoom & {
  fixedTick(deltaTime: number): void;
  worldItemRandom: () => number;
};

type GrandoriaClient = ClientRoom<MyRoom, MyRoom["state"]>;

function advanceFixedTicks(room: TestableMyRoom, tickCount: number) {
  for (let tick = 0; tick < tickCount; tick += 1) {
    room.fixedTick(FIXED_TIME_STEP_MS);
  }
}

function waitForClientMessage(
  client: GrandoriaClient,
  messageType: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | undefined;

    unsubscribe = client.onMessage(messageType, (message) => {
      unsubscribe?.();
      resolve(message as Record<string, unknown>);
    });
  });
}

async function sendAndReceive(
  room: TestableMyRoom,
  client: GrandoriaClient,
  messageType: "collect_item" | "drop_item",
  responseType: "collect_item_result" | "drop_item_result",
  message: Record<string, unknown>,
) {
  const serverReceived = room.waitForMessage(messageType);
  const response = waitForClientMessage(client, responseType);

  client.send(messageType, message);

  await serverReceived;

  return response;
}

describe("MyRoom authoritative shared world items", () => {
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
    overrides: Partial<typeof DEFAULT_JOIN_OPTIONS> = {},
  ) {
    const room = await colyseus.createRoom<MyRoom>(ROOM_NAME, {});

    room.setSimulationInterval();

    const client = await colyseus.connectTo(room, {
      ...DEFAULT_JOIN_OPTIONS,
      ...overrides,
    });
    const testRoom = room as unknown as TestableMyRoom;

    testRoom.worldItemRandom = () => 0.5;

    return {
      client,
      room: testRoom,
    };
  }

  it("creates inventory drops from the authoritative player position", async () => {
    const { client, room } = await createJoinedRoom();

    const result = await sendAndReceive(
      room,
      client,
      "drop_item",
      "drop_item_result",
      {
        itemID: "rabbit_skin",
        quantity: 2,
        requestId: "drop-1",
        type: "forged-client-type",
        x: 999999,
        y: 999999,
      },
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, "DROP_CREATED");
    assert.strictEqual(result.type, "Materials");
    assert.strictEqual(result.subType, "Monster Parts");
    assert.strictEqual(result.quantity, 2);
    assert.strictEqual(room.state.items.size, 2);

    for (const item of room.state.items.values()) {
      assert.strictEqual(item.itemID, "rabbit_skin");
      assert.strictEqual(item.type, "Materials");
      assert.strictEqual(item.subType, "Monster Parts");
      assert.strictEqual(item.quantity, 1);
      assert.strictEqual(item.mapId, MAP_ID);
      assert.strictEqual(item.source, "inventory_drop");
      assert.strictEqual(item.x, DEFAULT_JOIN_OPTIONS.x);
      assert.strictEqual(item.y, DEFAULT_JOIN_OPTIONS.y);
      assert.strictEqual(item.createdBy, DEFAULT_JOIN_OPTIONS.playerUid);
    }

    await room.waitForNextPatch();

    assert.strictEqual(client.state.items.size, 2);
  });

  it("rejects unknown items and quantities above the catalog stack", async () => {
    const { client, room } = await createJoinedRoom();

    const unknownResult = await sendAndReceive(
      room,
      client,
      "drop_item",
      "drop_item_result",
      {
        itemID: "client_forged_item",
        quantity: 1,
        requestId: "drop-unknown",
      },
    );

    assert.strictEqual(unknownResult.ok, false);
    assert.strictEqual(unknownResult.code, "UNKNOWN_ITEM");

    const quantityResult = await sendAndReceive(
      room,
      client,
      "drop_item",
      "drop_item_result",
      {
        itemID: "rabbit_foot",
        quantity: 5,
        requestId: "drop-too-many",
      },
    );

    assert.strictEqual(quantityResult.ok, false);
    assert.strictEqual(quantityResult.code, "INVALID_QUANTITY");
    assert.strictEqual(room.state.items.size, 0);
  });

  it("replays a completed drop result without duplicating world items", async () => {
    const { client, room } = await createJoinedRoom();
    const request = {
      itemID: "rabbit_foot",
      quantity: 1,
      requestId: "drop-idempotent",
    };
    const firstResult = await sendAndReceive(
      room,
      client,
      "drop_item",
      "drop_item_result",
      request,
    );
    const secondResult = await sendAndReceive(
      room,
      client,
      "drop_item",
      "drop_item_result",
      request,
    );

    assert.deepStrictEqual(secondResult, firstResult);
    assert.strictEqual(room.state.items.size, 1);
  });

  it("rejects collection outside the authoritative range", async () => {
    const { client, room } = await createJoinedRoom();

    const dropResult = await sendAndReceive(
      room,
      client,
      "drop_item",
      "drop_item_result",
      {
        itemID: "rabbit_foot",
        quantity: 1,
        requestId: "drop-range",
      },
    );
    const sharedItemIDs = dropResult.sharedItemIDs as string[];
    const player = room.state.players.get(client.sessionId);

    assert.ok(player);

    player.x += 100;

    const collectResult = await sendAndReceive(
      room,
      client,
      "collect_item",
      "collect_item_result",
      {
        requestId: "collect-range",
        sharedItemID: sharedItemIDs[0],
      },
    );

    assert.strictEqual(collectResult.ok, false);
    assert.strictEqual(collectResult.code, "OUT_OF_RANGE");
    assert.strictEqual(room.state.items.size, 1);
  });

  it("allows only one of two players to collect the same item", async () => {
    const { client: firstClient, room } = await createJoinedRoom();
    const secondClient = await colyseus.connectTo(room as unknown as MyRoom, {
      ...DEFAULT_JOIN_OPTIONS,
      characterId: "second-character",
      playerUid: "second-player",
    });
    const dropResult = await sendAndReceive(
      room,
      firstClient,
      "drop_item",
      "drop_item_result",
      {
        itemID: "rabbit_foot",
        quantity: 1,
        requestId: "drop-race",
      },
    );
    const sharedItemID = (dropResult.sharedItemIDs as string[])[0];
    const firstResponse = waitForClientMessage(
      firstClient,
      "collect_item_result",
    );
    const secondResponse = waitForClientMessage(
      secondClient,
      "collect_item_result",
    );

    firstClient.send("collect_item", {
      requestId: "collect-first",
      sharedItemID,
    });
    secondClient.send("collect_item", {
      requestId: "collect-second",
      sharedItemID,
    });

    const results = await Promise.all([firstResponse, secondResponse]);
    const successCount = results.filter((result) => result.ok === true).length;
    const missingCount = results.filter(
      (result) => result.code === "ITEM_NOT_FOUND",
    ).length;

    assert.strictEqual(successCount, 1);
    assert.strictEqual(missingCount, 1);
    assert.strictEqual(room.state.items.size, 0);
  });

  it("creates the configured hare drop exactly once on lethal damage", async () => {
    const { client, room } = await createJoinedRoom();
    const randomValues = [0, 0, 0];

    room.worldItemRandom = () => randomValues.shift() ?? 0;

    for (let hit = 0; hit < 2; hit += 1) {
      const serverReceived = room.waitForMessage("attack");

      client.send("attack", { monsterId: HARE_ID });
      await serverReceived;
      advanceFixedTicks(room, ATTACK_HIT_TICKS);

      if (hit === 0) {
        advanceFixedTicks(room, ATTACK_FINISH_TICKS_AFTER_HIT);
      }
    }

    assert.strictEqual(room.state.items.size, 1);

    const [sharedItemID, item] = [...room.state.items.entries()][0];

    assert.ok(sharedItemID.startsWith(`mob_drop_${HARE_ID}_`));
    assert.strictEqual(item.itemID, "rabbit_foot");
    assert.strictEqual(item.type, "Materials");
    assert.strictEqual(item.subType, "Monster Parts");
    assert.strictEqual(item.source, "mob_drop");
    assert.strictEqual(item.monsterType, "mob_hare");
    assert.strictEqual(item.monsterId, HARE_ID);
    assert.strictEqual(item.rarity, "common");
    assert.strictEqual(item.x, 168);
    assert.strictEqual(item.y, 968);
  });
});
