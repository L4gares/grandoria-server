import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { Client } from "colyseus";

import { MyRoom } from "../src/rooms/MyRoom.js";
import {
  PlayerInventorySlotState,
  PlayerState,
} from "../src/rooms/schema/MyRoomState.js";

type SentMessage = {
  payload: Record<string, unknown>;
  type: string;
};

function createClient(
  sessionId: string,
  auth?: Record<string, unknown>,
): {
  client: Client;
  sent: SentMessage[];
} {
  const sent: SentMessage[] = [];
  const client = {
    auth,
    sessionId,
    send(type: string, payload: Record<string, unknown>) {
      sent.push({ payload, type });
    },
  } as unknown as Client;

  return { client, sent };
}

function addEmptyInventorySlots(player: PlayerState, count: number) {
  for (let index = 0; index < count; index += 1) {
    player.inventory.push(new PlayerInventorySlotState());
  }
}

function readInventory(player: PlayerState) {
  return Array.from(player.inventory).map((slot) => ({
    id: slot.id,
    quantity: slot.quantity,
    sub_type: slot.sub_type,
    type: slot.type,
  }));
}

function readEquipment(player: PlayerState) {
  return {
    Foots: {
      id: player.equipment.Foots.id,
      sub_type: player.equipment.Foots.sub_type,
      type: player.equipment.Foots.type,
    },
    Head: {
      id: player.equipment.Head.id,
      sub_type: player.equipment.Head.sub_type,
      type: player.equipment.Head.type,
    },
    Legs: {
      id: player.equipment.Legs.id,
      sub_type: player.equipment.Legs.sub_type,
      type: player.equipment.Legs.type,
    },
    OffHand: {
      id: player.equipment.OffHand.id,
      sub_type: player.equipment.OffHand.sub_type,
      type: player.equipment.OffHand.type,
    },
    Tronco: {
      id: player.equipment.Tronco.id,
      sub_type: player.equipment.Tronco.sub_type,
      type: player.equipment.Tronco.type,
    },
    Weapons: {
      id: player.equipment.Weapons.id,
      sub_type: player.equipment.Weapons.sub_type,
      type: player.equipment.Weapons.type,
    },
  };
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

describe("authoritative market and equipment flow", () => {
  it("buys and equips Head/Tronco items once, then restores the same character", async () => {
    const room = new MyRoom();
    const { client, sent } = createClient("market-session");
    const player = new PlayerState();

    player.characterId = "character-market";
    player.mapId = "MAP_1";
    player.gold = 560;
    player.gem = 13;
    addEmptyInventorySlots(player, 4);
    room.state.players.set(client.sessionId, player);

    let purchasePersistenceCount = 0;
    let persistedInventory = readInventory(player);
    let persistedEquipment = readEquipment(player);

    (room as unknown as Record<string, unknown>)[
      "persistPlayerInventoryAndCurrencies"
    ] = async () => {
      purchasePersistenceCount += 1;
      persistedInventory = readInventory(player);
    };

    (room as unknown as Record<string, unknown>)[
      "persistPlayerInventoryAndEquipment"
    ] = async () => {
      persistedInventory = readInventory(player);
      persistedEquipment = readEquipment(player);
    };

    const buy = getMessageHandler(room, "buy_item");
    const equip = getMessageHandler(room, "set_equipment");

    await buy(client, {
      currency: "Gold",
      itemID: "purple_helmet",
      requestId: "buy-helmet",
    });

    assert.strictEqual(sent.at(-1)?.type, "buy_item_result");
    assert.strictEqual(sent.at(-1)?.payload.code, "ITEM_PURCHASED");
    assert.strictEqual(player.gold, 320);
    assert.strictEqual(
      readInventory(player).filter((slot) => slot.id === "purple_helmet").length,
      1,
    );

    await buy(client, {
      currency: "Gold",
      itemID: "purple_helmet",
      requestId: "buy-helmet",
    });

    assert.strictEqual(player.gold, 320);
    assert.strictEqual(purchasePersistenceCount, 1);
    assert.strictEqual(
      readInventory(player).filter((slot) => slot.id === "purple_helmet").length,
      1,
    );

    await equip(client, {
      item: {
        id: "purple_helmet",
        sub_type: "Warrior Helmet",
        type: "Head",
      },
      requestId: "equip-helmet",
      slot: "Head",
    });

    assert.strictEqual(sent.at(-1)?.payload.code, "EQUIPMENT_UPDATED");
    assert.strictEqual(player.equipment.Head.id, "purple_helmet");
    assert.strictEqual(
      readInventory(player).filter((slot) => slot.id === "purple_helmet").length,
      0,
    );

    await buy(client, {
      currency: "Gold",
      itemID: "purple_helmet",
      requestId: "buy-helmet",
    });

    const repeatedInventory = sent.at(-1)?.payload.inventory as Array<{
      id: string;
    }>;

    assert.strictEqual(player.gold, 320);
    assert.strictEqual(
      repeatedInventory.filter((slot) => slot.id === "purple_helmet").length,
      0,
    );

    await buy(client, {
      currency: "Gem",
      itemID: "purple_chest",
      requestId: "buy-chest",
    });
    await equip(client, {
      item: {
        id: "purple_chest",
        sub_type: "Warrior Chest",
        type: "Tronco",
      },
      requestId: "equip-chest",
      slot: "Tronco",
    });

    assert.strictEqual(player.gem, 5);
    assert.strictEqual(player.equipment.Tronco.id, "purple_chest");
    assert.strictEqual(
      persistedInventory.every((slot) => slot.id === "empty"),
      true,
    );
    assert.strictEqual(persistedEquipment.Head.id, "purple_helmet");
    assert.strictEqual(persistedEquipment.Tronco.id, "purple_chest");

    const reconnectedRoom = new MyRoom();
    const reconnected = createClient("reconnected-session", {
      characterId: "character-market",
      currencies: {
        gem: player.gem,
        gold: player.gold,
      },
      equipment: persistedEquipment,
      inventory: persistedInventory,
      location: {
        direction: "down",
        mapId: "MAP_1",
        x: 728,
        y: 1362,
      },
      resources: {
        currentHealth: 50,
        maxHealth: 50,
      },
      uid: "owner-uid",
    });

    reconnectedRoom.onJoin(reconnected.client, {
      characterId: "different-client-value",
      characterName: "Market Test",
      equipment: {},
    });

    const restored = reconnectedRoom.state.players.get(
      reconnected.client.sessionId,
    );

    assert.ok(restored);
    assert.strictEqual(restored.characterId, "character-market");
    assert.strictEqual(restored.gold, 320);
    assert.strictEqual(restored.gem, 5);
    assert.strictEqual(restored.equipment.Head.id, "purple_helmet");
    assert.strictEqual(restored.equipment.Tronco.id, "purple_chest");
    assert.strictEqual(
      Array.from(restored.inventory).every((slot) => slot.id === "empty"),
      true,
    );
  });

  it("rolls inventory and balance back when purchase persistence fails", async () => {
    const room = new MyRoom();
    const { client, sent } = createClient("rollback-session");
    const player = new PlayerState();

    player.gold = 240;
    addEmptyInventorySlots(player, 1);
    room.state.players.set(client.sessionId, player);

    (room as unknown as Record<string, unknown>)[
      "persistPlayerInventoryAndCurrencies"
    ] = async () => {
      throw new Error("simulated persistence failure");
    };

    await getMessageHandler(room, "buy_item")(client, {
      currency: "Gold",
      itemID: "purple_helmet",
      requestId: "rollback-purchase",
    });

    assert.strictEqual(sent.at(-1)?.payload.code, "PURCHASE_SAVE_FAILED");
    assert.strictEqual(player.gold, 240);
    assert.strictEqual(player.inventory[0].id, "empty");
    assert.strictEqual(player.inventory[0].quantity, 0);
  });

  it("contains no local currency or inventory mutation in market purchase events", () => {
    const projectPath = process.env.GRANDORIA_GDEVELOP_PROJECT;

    assert.ok(projectPath, "GRANDORIA_GDEVELOP_PROJECT must select the fixed project.");

    const project = JSON.parse(readFileSync(projectPath, "utf8"));
    const extension = project.eventsFunctionsExtensions.find(
      (candidate: Record<string, unknown>) =>
        candidate.name === "GrandoriaColyseus",
    );
    const buyFunction = extension.eventsFunctions.find(
      (candidate: Record<string, unknown>) => candidate.name === "BuyItem",
    );
    const connectFunction = extension.eventsFunctions.find(
      (candidate: Record<string, unknown>) =>
        candidate.name === "ConnectToServer",
    );

    assert.ok(buyFunction);
    assert.match(
      connectFunction.events[0].inlineCode.join("\n"),
      /buy_item_result/,
    );

    const interfaces = project.externalEvents.find(
      (candidate: Record<string, unknown>) => candidate.name === "interfaces",
    );
    const marketGroup = findNamedEvent(
      interfaces.events,
      "MARKET — BUY ITEMS",
    );

    assert.ok(marketGroup);

    const serializedMarket = JSON.stringify(marketGroup);

    assert.match(serializedMarket, /GrandoriaColyseus::BuyItem/);
    assert.doesNotMatch(serializedMarket, /inventory\[A\]/);
    assert.doesNotMatch(serializedMarket, /player_Gold","-"/);
    assert.doesNotMatch(serializedMarket, /player_Gem","-"/);

    const buyCode = buyFunction.events[0].inlineCode.join("\n");
    const connectCode = connectFunction.events[0].inlineCode.join("\n");

    assert.doesNotThrow(
      () => new Function("runtimeScene", "eventsFunctionContext", "gdjs", buyCode),
    );
    assert.doesNotThrow(
      () => new Function("runtimeScene", "eventsFunctionContext", "gdjs", connectCode),
    );
  });
});