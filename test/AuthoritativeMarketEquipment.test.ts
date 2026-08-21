import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { Client } from "colyseus";

import { getItemDefinition } from "../src/items/ItemCatalog.js";
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

function setInventorySlot(
  player: PlayerState,
  index: number,
  itemID: string,
  quantity: number,
) {
  const definition = getItemDefinition(itemID);

  assert.ok(definition);

  const slot = player.inventory[index];

  assert.ok(slot);

  slot.id = itemID;
  slot.quantity = quantity;
  slot.sub_type = definition.subType;
  slot.type = definition.type;
}

function readInventory(player: PlayerState) {
  return Array.from(player.inventory).map((slot) => ({
    id: slot.id,
    quantity: slot.quantity,
    sub_type: slot.sub_type,
    type: slot.type,
  }));
}

function createWarriorAttributes() {
  const Base = {
    AttackPower: 6,
    MagicPower: 0,
    HealingPower: 0,
    Agility: 2,
    Vitality: 6,
    Regeneration: 3,
    Armor: 5,
    CriticalChance: 2,
  };

  const Allocated = {
    AttackPower: 0,
    MagicPower: 0,
    HealingPower: 0,
    Agility: 0,
    Vitality: 0,
    Regeneration: 0,
    Armor: 0,
    CriticalChance: 0,
  };

  return {
    Base,
    Allocated,
    Final: { ...Base },
  };
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

function visitObjects(
  value: unknown,
  callback: (value: Record<string, unknown>) => void,
) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => visitObjects(entry, callback));
    return;
  }

  const object = value as Record<string, unknown>;

  callback(object);
  Object.values(object).forEach((entry) => visitObjects(entry, callback));
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
      attributes: createWarriorAttributes(),
      characterId: "character-market",
      level: 1,
      unspentAttributePoints: 0,
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

  it("sells partial and full stacks once, then restores the authoritative result", async () => {
    const room = new MyRoom();
    const { client, sent } = createClient("sale-session");
    const player = new PlayerState();

    player.characterId = "character-sale";
    player.mapId = "MAP_1";
    player.gold = 25;
    player.gem = 4;
    addEmptyInventorySlots(player, 3);
    setInventorySlot(player, 0, "item_test", 7);
    room.state.players.set(client.sessionId, player);

    let persistenceCount = 0;
    let persistedInventory = readInventory(player);
    let persistedGold = player.gold;

    (room as unknown as Record<string, unknown>)[
      "persistPlayerInventoryAndCurrencies"
    ] = async () => {
      persistenceCount += 1;
      persistedInventory = readInventory(player);
      persistedGold = player.gold;
    };

    const sell = getMessageHandler(room, "sell_item");

    await sell(client, {
      itemID: "item_test",
      price: 999_999,
      quantity: 3,
      requestId: "sell-partial-stack",
    });

    assert.strictEqual(sent.at(-1)?.type, "sell_item_result");
    assert.strictEqual(sent.at(-1)?.payload.code, "ITEM_SOLD");
    assert.strictEqual(sent.at(-1)?.payload.unitPrice, 10);
    assert.strictEqual(sent.at(-1)?.payload.totalPrice, 30);
    assert.strictEqual(player.gold, 55);
    assert.strictEqual(player.inventory[0].id, "item_test");
    assert.strictEqual(player.inventory[0].quantity, 4);
    assert.strictEqual(persistenceCount, 1);

    await sell(client, {
      itemID: "item_test",
      price: 1,
      quantity: 3,
      requestId: "sell-partial-stack",
    });

    assert.strictEqual(player.gold, 55);
    assert.strictEqual(player.inventory[0].quantity, 4);
    assert.strictEqual(persistenceCount, 1);

    await sell(client, {
      itemID: "item_test",
      quantity: 4,
      requestId: "sell-full-stack",
    });

    assert.strictEqual(sent.at(-1)?.payload.code, "ITEM_SOLD");
    assert.strictEqual(player.gold, 95);
    assert.strictEqual(player.inventory[0].id, "empty");
    assert.strictEqual(player.inventory[0].quantity, 0);
    assert.strictEqual(persistenceCount, 2);
    assert.strictEqual(persistedGold, 95);

    const reconnectedRoom = new MyRoom();
    const reconnected = createClient("sale-reconnected-session", {
      attributes: createWarriorAttributes(),
      characterId: "character-sale",
      level: 1,
      unspentAttributePoints: 0,
      currencies: {
        gem: player.gem,
        gold: persistedGold,
      },
      equipment: readEquipment(player),
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
      uid: "sale-owner-uid",
    });

    reconnectedRoom.onJoin(reconnected.client, {
      characterId: "untrusted-client-character",
      characterName: "Sale Test",
    });

    const restored = reconnectedRoom.state.players.get(
      reconnected.client.sessionId,
    );

    assert.ok(restored);
    assert.strictEqual(restored.characterId, "character-sale");
    assert.strictEqual(restored.gold, 95);
    assert.strictEqual(restored.gem, 4);
    assert.strictEqual(restored.inventory[0].id, "empty");
    assert.strictEqual(restored.inventory[0].quantity, 0);
  });

  it("rejects invalid sale requests without changing inventory or Gold", async () => {
    const room = new MyRoom();
    const { client, sent } = createClient("invalid-sale-session");
    const player = new PlayerState();

    player.gold = 12;
    player.gem = 3;
    addEmptyInventorySlots(player, 2);
    setInventorySlot(player, 0, "item_test", 2);
    room.state.players.set(client.sessionId, player);

    let persistenceCount = 0;

    (room as unknown as Record<string, unknown>)[
      "persistPlayerInventoryAndCurrencies"
    ] = async () => {
      persistenceCount += 1;
    };

    const sell = getMessageHandler(room, "sell_item");
    const invalidRequests = [
      {
        code: "UNKNOWN_ITEM",
        message: {
          itemID: "missing_item",
          quantity: 1,
          requestId: "unknown-sale-item",
        },
      },
      {
        code: "INSUFFICIENT_ITEM_QUANTITY",
        message: {
          itemID: "item_test",
          quantity: 3,
          requestId: "excessive-sale-quantity",
        },
      },
      {
        code: "INVALID_QUANTITY",
        message: {
          itemID: "item_test",
          quantity: 0,
          requestId: "zero-sale-quantity",
        },
      },
      {
        code: "INVALID_QUANTITY",
        message: {
          itemID: "item_test",
          quantity: -1,
          requestId: "negative-sale-quantity",
        },
      },
      {
        code: "INVALID_QUANTITY",
        message: {
          itemID: "item_test",
          quantity: 1.5,
          requestId: "fractional-sale-quantity",
        },
      },
    ] as const;

    for (const testCase of invalidRequests) {
      await sell(client, testCase.message);
      assert.strictEqual(sent.at(-1)?.payload.code, testCase.code);
      assert.strictEqual(sent.at(-1)?.payload.ok, false);
      assert.strictEqual(player.gold, 12);
      assert.strictEqual(player.inventory[0].id, "item_test");
      assert.strictEqual(player.inventory[0].quantity, 2);
    }

    assert.strictEqual(persistenceCount, 0);
  });

  it("rolls inventory and Gold back when sale persistence fails", async () => {
    const room = new MyRoom();
    const { client, sent } = createClient("rollback-sale-session");
    const player = new PlayerState();

    player.gold = 5;
    addEmptyInventorySlots(player, 1);
    setInventorySlot(player, 0, "item_test", 2);
    room.state.players.set(client.sessionId, player);

    let shouldFail = true;

    (room as unknown as Record<string, unknown>)[
      "persistPlayerInventoryAndCurrencies"
    ] = async () => {
      if (shouldFail) {
        throw new Error("simulated sale persistence failure");
      }
    };

    const sell = getMessageHandler(room, "sell_item");
    const request = {
      itemID: "item_test",
      quantity: 2,
      requestId: "rollback-sale",
    };

    await sell(client, request);

    assert.strictEqual(sent.at(-1)?.payload.code, "SALE_SAVE_FAILED");
    assert.strictEqual(player.gold, 5);
    assert.strictEqual(player.inventory[0].id, "item_test");
    assert.strictEqual(player.inventory[0].quantity, 2);

    shouldFail = false;
    await sell(client, request);

    assert.strictEqual(sent.at(-1)?.payload.code, "ITEM_SOLD");
    assert.strictEqual(player.gold, 25);
    assert.strictEqual(player.inventory[0].id, "empty");
    assert.strictEqual(player.inventory[0].quantity, 0);
  });

  it("allocates character attributes authoritatively and deduplicates requestId", async () => {
    const room = new MyRoom();
    const { client, sent } = createClient("attribute-session");
    const player = new PlayerState();
    const attributes = createWarriorAttributes();

    Object.assign(player.attributes.Base, attributes.Base);
    Object.assign(player.attributes.Allocated, attributes.Allocated);
    Object.assign(player.attributes.Final, attributes.Final);
    player.unspentAttributePoints = 5;
    room.state.players.set(client.sessionId, player);

    let persistenceCount = 0;

    (room as unknown as Record<string, unknown>)["persistPlayerAttributes"] =
      async () => {
        persistenceCount += 1;
      };

    const allocate = getMessageHandler(room, "allocate_attributes");

    await allocate(client, {
      allocations: {
        AttackPower: 2,
        Vitality: 1,
      },
      requestId: "attributes-1",
    });

    assert.strictEqual(sent.at(-1)?.type, "allocate_attributes_result");
    assert.strictEqual(sent.at(-1)?.payload.ok, true);
    assert.strictEqual(sent.at(-1)?.payload.code, "ATTRIBUTES_ALLOCATED");
    assert.strictEqual(player.attributes.Allocated.AttackPower, 2);
    assert.strictEqual(player.attributes.Allocated.Vitality, 1);
    assert.strictEqual(player.attributes.Final.AttackPower, 8);
    assert.strictEqual(player.attributes.Final.Vitality, 7);
    assert.strictEqual(player.unspentAttributePoints, 2);
    assert.strictEqual(persistenceCount, 1);

    await allocate(client, {
      allocations: {
        AttackPower: 2,
        Vitality: 1,
      },
      requestId: "attributes-1",
    });

    assert.strictEqual(player.attributes.Allocated.AttackPower, 2);
    assert.strictEqual(player.attributes.Allocated.Vitality, 1);
    assert.strictEqual(player.unspentAttributePoints, 2);
    assert.strictEqual(persistenceCount, 1);
  });

  it("rejects invalid or excessive attribute allocations without mutating the player", async () => {
    const room = new MyRoom();
    const { client, sent } = createClient("attribute-invalid-session");
    const player = new PlayerState();
    const attributes = createWarriorAttributes();

    Object.assign(player.attributes.Base, attributes.Base);
    Object.assign(player.attributes.Allocated, attributes.Allocated);
    Object.assign(player.attributes.Final, attributes.Final);
    player.unspentAttributePoints = 2;
    room.state.players.set(client.sessionId, player);

    const allocate = getMessageHandler(room, "allocate_attributes");

    await allocate(client, {
      allocations: { AttackPower: 1.5 },
      requestId: "fractional-attributes",
    });

    assert.strictEqual(sent.at(-1)?.payload.code, "INVALID_REQUEST");
    assert.strictEqual(player.attributes.Allocated.AttackPower, 0);
    assert.strictEqual(player.unspentAttributePoints, 2);

    await allocate(client, {
      allocations: { AttackPower: 3 },
      requestId: "too-many-attributes",
    });

    assert.strictEqual(
      sent.at(-1)?.payload.code,
      "INSUFFICIENT_ATTRIBUTE_POINTS",
    );
    assert.strictEqual(player.attributes.Allocated.AttackPower, 0);
    assert.strictEqual(player.attributes.Final.AttackPower, 6);
    assert.strictEqual(player.unspentAttributePoints, 2);
  });

  it("rolls attribute allocation back when persistence fails and allows retrying the same requestId", async () => {
    const room = new MyRoom();
    const { client, sent } = createClient("attribute-rollback-session");
    const player = new PlayerState();
    const attributes = createWarriorAttributes();

    Object.assign(player.attributes.Base, attributes.Base);
    Object.assign(player.attributes.Allocated, attributes.Allocated);
    Object.assign(player.attributes.Final, attributes.Final);
    player.unspentAttributePoints = 2;
    room.state.players.set(client.sessionId, player);

    let failPersistence = true;

    (room as unknown as Record<string, unknown>)["persistPlayerAttributes"] =
      async () => {
        if (failPersistence) {
          throw new Error("simulated attribute persistence failure");
        }
      };

    const allocate = getMessageHandler(room, "allocate_attributes");
    const request = {
      allocations: { AttackPower: 2 },
      requestId: "attribute-rollback",
    };

    await allocate(client, request);

    assert.strictEqual(sent.at(-1)?.payload.code, "ATTRIBUTE_SAVE_FAILED");
    assert.strictEqual(player.attributes.Allocated.AttackPower, 0);
    assert.strictEqual(player.attributes.Final.AttackPower, 6);
    assert.strictEqual(player.unspentAttributePoints, 2);

    failPersistence = false;
    await allocate(client, request);

    assert.strictEqual(sent.at(-1)?.payload.code, "ATTRIBUTES_ALLOCATED");
    assert.strictEqual(player.attributes.Allocated.AttackPower, 2);
    assert.strictEqual(player.attributes.Final.AttackPower, 8);
    assert.strictEqual(player.unspentAttributePoints, 0);
  });

  it("derives authoritative combat stats from final attributes and equipped catalog items", () => {
    const room = new MyRoom();
    const player = new PlayerState();
    const attributes = createWarriorAttributes();

    Object.assign(player.attributes.Base, attributes.Base);
    Object.assign(player.attributes.Allocated, attributes.Allocated);
    Object.assign(player.attributes.Final, attributes.Final);

    player.equipment.Weapons.id = "iron_sword_01";
    player.equipment.Weapons.type = "Weapons";
    player.equipment.Weapons.sub_type = "Sword";
    player.equipment.Head.id = "purple_helmet";
    player.equipment.Head.type = "Head";
    player.equipment.Head.sub_type = "Warrior Helmet";
    player.equipment.Tronco.id = "purple_chest";
    player.equipment.Tronco.type = "Tronco";
    player.equipment.Tronco.sub_type = "Warrior Chest";

    const recalculateCombatStats = (
      room as unknown as Record<
        string,
        (player: PlayerState) => Record<string, number>
      >
    )["recalculatePlayerCombatStats"];

    const stats = recalculateCombatStats.call(room, player);

    assert.deepStrictEqual(stats, {
      weaponMinDamage: 5,
      weaponMaxDamage: 7,
      physicalDamageBonus: 3,
      magicDamageBonus: 0,
      healingBonus: 0,
      attackSpeedBonus: 0.02,
      maxHealthBonus: 12,
      healthRegenPerSecond: 0.6,
      armor: 39,
      criticalChancePercent: 0.6,
    });
    assert.strictEqual(player.combatStats.weaponMinDamage, 5);
    assert.strictEqual(player.combatStats.weaponMaxDamage, 7);
    assert.strictEqual(player.combatStats.armor, 39);
  });

  it("recalculates combat stats after authoritative attribute allocation and equipment changes", async () => {
    const room = new MyRoom();
    const { client } = createClient("combat-stats-session");
    const player = new PlayerState();
    const attributes = createWarriorAttributes();

    Object.assign(player.attributes.Base, attributes.Base);
    Object.assign(player.attributes.Allocated, attributes.Allocated);
    Object.assign(player.attributes.Final, attributes.Final);
    player.unspentAttributePoints = 3;
    addEmptyInventorySlots(player, 4);
    setInventorySlot(player, 0, "iron_sword_01", 1);
    setInventorySlot(player, 1, "purple_chest", 1);
    room.state.players.set(client.sessionId, player);

    (room as unknown as Record<string, unknown>)["persistPlayerAttributes"] =
      async () => {};
    (room as unknown as Record<string, unknown>)[
      "persistPlayerInventoryAndEquipment"
    ] = async () => {};

    const recalculateCombatStats = (
      room as unknown as Record<
        string,
        (player: PlayerState) => Record<string, number>
      >
    )["recalculatePlayerCombatStats"];

    recalculateCombatStats.call(room, player);
    assert.strictEqual(player.combatStats.physicalDamageBonus, 3);
    assert.strictEqual(player.combatStats.magicDamageBonus, 0);
    assert.strictEqual(player.combatStats.armor, 4);

    const allocate = getMessageHandler(room, "allocate_attributes");

    await allocate(client, {
      allocations: {
        AttackPower: 2,
        MagicPower: 1,
      },
      requestId: "combat-attributes",
    });

    assert.strictEqual(player.combatStats.physicalDamageBonus, 4);
    assert.strictEqual(player.combatStats.magicDamageBonus, 0.7);

    const equip = getMessageHandler(room, "set_equipment");

    await equip(client, {
      item: {
        id: "iron_sword_01",
        sub_type: "Sword",
        type: "Weapons",
      },
      requestId: "combat-equip-weapon",
      slot: "Weapons",
    });

    assert.strictEqual(player.combatStats.weaponMinDamage, 5);
    assert.strictEqual(player.combatStats.weaponMaxDamage, 7);

    await equip(client, {
      item: {
        id: "purple_chest",
        sub_type: "Warrior Chest",
        type: "Tronco",
      },
      requestId: "combat-equip-chest",
      slot: "Tronco",
    });

    assert.strictEqual(player.combatStats.armor, 29);
  });

  it("applies XP and multiple level-ups authoritatively with the existing progression curve", () => {
    const room = new MyRoom();
    const player = new PlayerState();

    player.level = 1;
    player.experience = 90;
    player.experienceToNextLevel = 100;
    player.unspentAttributePoints = 0;

    const applyExperience = (
      room as unknown as Record<
        string,
        (player: PlayerState, amount: number) => { levelsGained: number }
      >
    )["applyExperienceToPlayer"];

    const firstReward = applyExperience.call(room, player, 20);

    assert.strictEqual(firstReward.levelsGained, 1);
    assert.strictEqual(player.level, 2);
    assert.strictEqual(player.experience, 10);
    assert.strictEqual(player.experienceToNextLevel, 125);
    assert.strictEqual(player.unspentAttributePoints, 2);

    const multiLevelReward = applyExperience.call(room, player, 300);

    assert.strictEqual(multiLevelReward.levelsGained, 2);
    assert.strictEqual(player.level, 4);
    assert.strictEqual(player.experience, 28);
    assert.strictEqual(player.experienceToNextLevel, 196);
    assert.strictEqual(player.unspentAttributePoints, 6);
  });

  it("caps authoritative progression at level 30", () => {
    const room = new MyRoom();
    const player = new PlayerState();

    player.level = 29;
    player.experience = 0;
    player.experienceToNextLevel = 0;
    player.unspentAttributePoints = 4;

    const applyExperience = (
      room as unknown as Record<
        string,
        (player: PlayerState, amount: number) => { levelsGained: number }
      >
    )["applyExperienceToPlayer"];

    const result = applyExperience.call(room, player, 1000000);

    assert.strictEqual(result.levelsGained, 1);
    assert.strictEqual(player.level, 30);
    assert.strictEqual(player.experience, 0);
    assert.strictEqual(player.experienceToNextLevel, 0);
    assert.strictEqual(player.unspentAttributePoints, 6);
  });

  it("rolls authoritative weapon damage from catalog min/max plus Attack Power", () => {
    const room = new MyRoom();
    const player = new PlayerState();
    const attributes = createWarriorAttributes();

    Object.assign(player.attributes.Base, attributes.Base);
    Object.assign(player.attributes.Allocated, attributes.Allocated);
    Object.assign(player.attributes.Final, attributes.Final);
    player.equipment.Weapons.id = "iron_sword_01";
    player.equipment.Weapons.type = "Weapons";
    player.equipment.Weapons.sub_type = "Sword";

    const recalculateCombatStats = (
      room as unknown as Record<
        string,
        (player: PlayerState) => Record<string, number>
      >
    )["recalculatePlayerCombatStats"];
    const rollPhysicalDamage = (
      room as unknown as Record<
        string,
        (
          player: PlayerState,
          weaponRandomValue?: number,
          criticalRandomValue?: number,
        ) => Record<string, unknown>
      >
    )["rollPlayerPhysicalAttackDamage"];

    recalculateCombatStats.call(room, player);

    assert.deepStrictEqual(rollPhysicalDamage.call(room, player, 0, 0.5), {
      baseDamage: 8,
      criticalChancePercent: 0.6,
      criticalMultiplier: 1,
      criticalRoll: 50,
      damage: 8,
      isCritical: false,
      physicalDamageBonus: 3,
      weaponID: "iron_sword_01",
      weaponRoll: 5,
    });
    assert.deepStrictEqual(
      rollPhysicalDamage.call(room, player, 0.999999, 0.5),
      {
        baseDamage: 10,
        criticalChancePercent: 0.6,
        criticalMultiplier: 1,
        criticalRoll: 50,
        damage: 10,
        isCritical: false,
        physicalDamageBonus: 3,
        weaponID: "iron_sword_01",
        weaponRoll: 7,
      },
    );

    player.attributes.Allocated.AttackPower = 4;
    player.attributes.Final.AttackPower = 10;
    recalculateCombatStats.call(room, player);

    assert.deepStrictEqual(rollPhysicalDamage.call(room, player, 0, 0.5), {
      baseDamage: 10,
      criticalChancePercent: 0.6,
      criticalMultiplier: 1,
      criticalRoll: 50,
      damage: 10,
      isCritical: false,
      physicalDamageBonus: 5,
      weaponID: "iron_sword_01",
      weaponRoll: 5,
    });
    assert.deepStrictEqual(
      rollPhysicalDamage.call(room, player, 0.999999, 0.5),
      {
        baseDamage: 12,
        criticalChancePercent: 0.6,
        criticalMultiplier: 1,
        criticalRoll: 50,
        damage: 12,
        isCritical: false,
        physicalDamageBonus: 5,
        weaponID: "iron_sword_01",
        weaponRoll: 7,
      },
    );
  });

  it("uses authoritative unarmed base damage when no weapon is equipped", () => {
    const room = new MyRoom();
    const player = new PlayerState();
    const attributes = createWarriorAttributes();

    Object.assign(player.attributes.Base, attributes.Base);
    Object.assign(player.attributes.Allocated, attributes.Allocated);
    Object.assign(player.attributes.Final, attributes.Final);

    const recalculateCombatStats = (
      room as unknown as Record<
        string,
        (player: PlayerState) => Record<string, number>
      >
    )["recalculatePlayerCombatStats"];
    const rollPhysicalDamage = (
      room as unknown as Record<
        string,
        (
          player: PlayerState,
          weaponRandomValue?: number,
          criticalRandomValue?: number,
        ) => Record<string, unknown>
      >
    )["rollPlayerPhysicalAttackDamage"];

    recalculateCombatStats.call(room, player);

    assert.deepStrictEqual(rollPhysicalDamage.call(room, player, 0.5, 0.5), {
      baseDamage: 4,
      criticalChancePercent: 0.6,
      criticalMultiplier: 1,
      criticalRoll: 50,
      damage: 4,
      isCritical: false,
      physicalDamageBonus: 3,
      weaponID: "unarmed",
      weaponRoll: 1,
    });
  });

  it("doubles authoritative physical damage when the Critical Chance roll succeeds", () => {
    const room = new MyRoom();
    const player = new PlayerState();
    const attributes = createWarriorAttributes();

    Object.assign(player.attributes.Base, attributes.Base);
    Object.assign(player.attributes.Allocated, attributes.Allocated);
    Object.assign(player.attributes.Final, attributes.Final);
    player.equipment.Weapons.id = "iron_sword_01";
    player.equipment.Weapons.type = "Weapons";
    player.equipment.Weapons.sub_type = "Sword";

    const recalculateCombatStats = (
      room as unknown as Record<
        string,
        (player: PlayerState) => Record<string, number>
      >
    )["recalculatePlayerCombatStats"];
    const rollPhysicalDamage = (
      room as unknown as Record<
        string,
        (
          player: PlayerState,
          weaponRandomValue?: number,
          criticalRandomValue?: number,
        ) => Record<string, unknown>
      >
    )["rollPlayerPhysicalAttackDamage"];

    recalculateCombatStats.call(room, player);

    assert.deepStrictEqual(rollPhysicalDamage.call(room, player, 0, 0), {
      baseDamage: 8,
      criticalChancePercent: 0.6,
      criticalMultiplier: 2,
      criticalRoll: 0,
      damage: 16,
      isCritical: true,
      physicalDamageBonus: 3,
      weaponID: "iron_sword_01",
      weaponRoll: 5,
    });
  });

  it("keeps authoritative physical damage normal when the Critical Chance roll misses", () => {
    const room = new MyRoom();
    const player = new PlayerState();
    const attributes = createWarriorAttributes();

    Object.assign(player.attributes.Base, attributes.Base);
    Object.assign(player.attributes.Allocated, attributes.Allocated);
    Object.assign(player.attributes.Final, attributes.Final);
    player.equipment.Weapons.id = "iron_sword_01";
    player.equipment.Weapons.type = "Weapons";
    player.equipment.Weapons.sub_type = "Sword";

    const recalculateCombatStats = (
      room as unknown as Record<
        string,
        (player: PlayerState) => Record<string, number>
      >
    )["recalculatePlayerCombatStats"];
    const rollPhysicalDamage = (
      room as unknown as Record<
        string,
        (
          player: PlayerState,
          weaponRandomValue?: number,
          criticalRandomValue?: number,
        ) => Record<string, unknown>
      >
    )["rollPlayerPhysicalAttackDamage"];

    recalculateCombatStats.call(room, player);

    assert.deepStrictEqual(rollPhysicalDamage.call(room, player, 0, 0.006), {
      baseDamage: 8,
      criticalChancePercent: 0.6,
      criticalMultiplier: 1,
      criticalRoll: 0.6,
      damage: 8,
      isCritical: false,
      physicalDamageBonus: 3,
      weaponID: "iron_sword_01",
      weaponRoll: 5,
    });
  });

  it("derives MaxHP authoritatively from level and effective Vitality", () => {
    const room = new MyRoom();
    const player = new PlayerState();
    const attributes = createWarriorAttributes();

    Object.assign(player.attributes.Base, attributes.Base);
    Object.assign(player.attributes.Allocated, attributes.Allocated);
    Object.assign(player.attributes.Final, attributes.Final);
    player.level = 12;
    player.currentHealth = 58;
    player.maxHealth = 145;

    const recalculateCombatStats = (
      room as unknown as Record<
        string,
        (player: PlayerState) => Record<string, number>
      >
    )["recalculatePlayerCombatStats"];
    const recalculateMaxHealth = (
      room as unknown as Record<
        string,
        (player: PlayerState) => Record<string, number | boolean>
      >
    )["recalculatePlayerMaxHealth"];

    recalculateCombatStats.call(room, player);
    recalculateMaxHealth.call(room, player);

    assert.strictEqual(player.combatStats.maxHealthBonus, 12);
    assert.strictEqual(player.maxHealth, 145);
    assert.strictEqual(player.currentHealth, 58);

    player.attributes.Allocated.Vitality = 4;
    player.attributes.Final.Vitality = 10;
    recalculateCombatStats.call(room, player);
    recalculateMaxHealth.call(room, player);

    assert.strictEqual(player.combatStats.maxHealthBonus, 20);
    assert.strictEqual(player.maxHealth, 164);
    assert.strictEqual(player.currentHealth, 58);
  });

  it("recalculates authoritative MaxHP after Vitality allocation without healing the player", async () => {
    const room = new MyRoom();
    const { client, sent } = createClient("vitality-health-session");
    const player = new PlayerState();
    const attributes = createWarriorAttributes();

    Object.assign(player.attributes.Base, attributes.Base);
    Object.assign(player.attributes.Allocated, attributes.Allocated);
    Object.assign(player.attributes.Final, attributes.Final);
    player.level = 12;
    player.currentHealth = 58;
    player.maxHealth = 145;
    player.isAlive = true;
    player.unspentAttributePoints = 2;
    room.state.players.set(client.sessionId, player);

    (room as unknown as Record<string, unknown>)["persistPlayerAttributes"] =
      async () => {};

    const allocate = getMessageHandler(room, "allocate_attributes");

    await allocate(client, {
      allocations: { Vitality: 2 },
      requestId: "vitality-max-health",
    });

    assert.strictEqual(player.attributes.Final.Vitality, 8);
    assert.strictEqual(player.combatStats.maxHealthBonus, 16);
    assert.strictEqual(player.maxHealth, 154);
    assert.strictEqual(player.currentHealth, 58);
    assert.strictEqual(sent.at(-1)?.payload.maxHealth, 154);
    assert.strictEqual(sent.at(-1)?.payload.currentHealth, 58);
  });

  it("applies authoritative health regeneration in 2-second ticks without changing its long-term strength", () => {
    const room = new MyRoom();
    const player = new PlayerState();

    player.isAlive = true;
    player.currentHealth = 100;
    player.maxHealth = 200;
    player.combatStats.healthRegenPerSecond = 1.6;
    room.state.players.set("regen-session", player);

    const updatePlayerHealthRegeneration = (
      room as unknown as {
        updatePlayerHealthRegeneration(deltaTime: number): void;
      }
    ).updatePlayerHealthRegeneration;

    updatePlayerHealthRegeneration.call(room, 1999);

    assert.strictEqual(player.currentHealth, 100);

    updatePlayerHealthRegeneration.call(room, 1);

    assert.strictEqual(player.currentHealth, 103);

    updatePlayerHealthRegeneration.call(room, 2000);
    assert.strictEqual(player.currentHealth, 106);

    updatePlayerHealthRegeneration.call(room, 2000);
    assert.strictEqual(player.currentHealth, 109);

    updatePlayerHealthRegeneration.call(room, 2000);
    assert.strictEqual(player.currentHealth, 112);

    updatePlayerHealthRegeneration.call(room, 2000);

    // Regeneration 8 = 1.6 HP/s, therefore 10 seconds restores exactly 16 HP.
    assert.strictEqual(player.currentHealth, 116);
  });

  it("reduces incoming monster physical damage with authoritative Armor", () => {
    const room = new MyRoom();
    const calculateDamageAfterArmor = (
      room as unknown as Record<
        string,
        (rawDamage: number, armor: number) => Record<string, number>
      >
    )["calculatePhysicalDamageAfterArmor"];

    assert.deepStrictEqual(calculateDamageAfterArmor.call(room, 7, 0), {
      armor: 0,
      damage: 7,
      damageReductionPercent: 0,
      rawDamage: 7,
    });

    assert.deepStrictEqual(calculateDamageAfterArmor.call(room, 7, 39), {
      armor: 39,
      damage: 5,
      damageReductionPercent: 28.0576,
      rawDamage: 7,
    });

    assert.deepStrictEqual(calculateDamageAfterArmor.call(room, 10, 35), {
      armor: 35,
      damage: 7,
      damageReductionPercent: 25.9259,
      rawDamage: 10,
    });
  });

  it("uses equipment-derived Armor when calculating monster damage mitigation", () => {
    const room = new MyRoom();
    const player = new PlayerState();
    const attributes = createWarriorAttributes();

    Object.assign(player.attributes.Base, attributes.Base);
    Object.assign(player.attributes.Allocated, attributes.Allocated);
    Object.assign(player.attributes.Final, attributes.Final);

    const recalculateCombatStats = (
      room as unknown as Record<
        string,
        (player: PlayerState) => Record<string, number>
      >
    )["recalculatePlayerCombatStats"];
    const calculateDamageAfterArmor = (
      room as unknown as Record<
        string,
        (rawDamage: number, armor: number) => Record<string, number>
      >
    )["calculatePhysicalDamageAfterArmor"];

    recalculateCombatStats.call(room, player);
    assert.strictEqual(player.combatStats.armor, 4);
    assert.strictEqual(
      calculateDamageAfterArmor.call(room, 10, player.combatStats.armor).damage,
      10,
    );

    player.equipment.Head.id = "purple_helmet";
    player.equipment.Head.type = "Head";
    player.equipment.Head.sub_type = "Warrior Helmet";
    player.equipment.Tronco.id = "purple_chest";
    player.equipment.Tronco.type = "Tronco";
    player.equipment.Tronco.sub_type = "Warrior Chest";

    recalculateCombatStats.call(room, player);
    assert.strictEqual(player.combatStats.armor, 39);
    assert.strictEqual(
      calculateDamageAfterArmor.call(room, 10, player.combatStats.armor).damage,
      7,
    );
  });

  it("enforces a 1500 ms base interval and reduces it authoritatively with Agility", async () => {
    const room = new MyRoom();
    const { client } = createClient("attack-speed-session");
    const player = new PlayerState();

    player.characterId = "character-attack-speed";
    player.mapId = "MAP_1";
    player.attributes.Final.Agility = 0;
    room.state.players.set(client.sessionId, player);

    const roomInternals = room as unknown as {
      fixedTick(deltaTime: number): void;
      playerAttackCooldownRemaining: Map<string, number>;
      playerAttackRemaining: Map<string, number>;
      recalculatePlayerCombatStats(player: PlayerState): void;
    };

    roomInternals.recalculatePlayerCombatStats(player);

    assert.strictEqual(player.combatStats.attackSpeedBonus, 0);
    assert.strictEqual(player.attackIntervalMs, 1500);

    const attack = getMessageHandler(room, "attack");

    await attack(client, {});

    assert.strictEqual(
      roomInternals.playerAttackRemaining.get(client.sessionId),
      320,
    );
    assert.strictEqual(
      roomInternals.playerAttackCooldownRemaining.get(client.sessionId),
      1500,
    );

    roomInternals.fixedTick(1500);

    assert.strictEqual(
      roomInternals.playerAttackRemaining.has(client.sessionId),
      false,
    );
    assert.strictEqual(
      roomInternals.playerAttackCooldownRemaining.has(client.sessionId),
      false,
    );

    player.attributes.Final.Agility = 4;
    roomInternals.recalculatePlayerCombatStats(player);

    assert.strictEqual(player.combatStats.attackSpeedBonus, 0.04);
    assert.strictEqual(player.attackIntervalMs, 1415);

    await attack(client, {});

    assert.strictEqual(
      roomInternals.playerAttackCooldownRemaining.get(client.sessionId),
      1415,
    );

    roomInternals.fixedTick(320);

    assert.strictEqual(
      roomInternals.playerAttackRemaining.has(client.sessionId),
      false,
    );
    assert.strictEqual(
      roomInternals.playerAttackCooldownRemaining.get(client.sessionId),
      1095,
    );

    await attack(client, {});

    assert.strictEqual(
      roomInternals.playerAttackRemaining.has(client.sessionId),
      false,
    );

    roomInternals.fixedTick(1096);
    await attack(client, {});

    assert.strictEqual(
      roomInternals.playerAttackRemaining.get(client.sessionId),
      320,
    );
  });

  it("clamps very high Agility to the 320 ms attack animation minimum", () => {
    const room = new MyRoom();
    const player = new PlayerState();

    player.attributes.Final.Agility = 999;

    const recalculateCombatStats = (
      room as unknown as {
        recalculatePlayerCombatStats(player: PlayerState): void;
      }
    ).recalculatePlayerCombatStats;

    recalculateCombatStats.call(room, player);

    assert.strictEqual(player.combatStats.attackSpeedBonus, 9.99);
    assert.strictEqual(player.attackIntervalMs, 320);
  });

  it("keeps attack timing centralized, applies Agility server-side, and gates GDevelop before local animation", () => {
    const roomSource = readFileSync("src/rooms/MyRoom.ts", "utf8");

    assert.match(
      roomSource,
      /const ATTACK_ANIMATION_DURATION_MS = 320;/,
    );
    assert.match(
      roomSource,
      /const PLAYER_MIN_ATTACK_INTERVAL_MS = ATTACK_ANIMATION_DURATION_MS;/,
    );
    assert.match(
      roomSource,
      /const PLAYER_BASE_ATTACK_INTERVAL_MS = Math\.max\(\s*1_500,/,
    );
    assert.match(
      roomSource,
      /const AGILITY_ATTACKS_PER_SECOND_PER_POINT = 0\.01;/,
    );
    assert.match(
      roomSource,
      /const PLAYER_HEALTH_REGEN_TICK_MS = 2_000;/,
    );
    assert.match(
      roomSource,
      /calculatePlayerAttackIntervalMs\(player: PlayerState\)[\s\S]{0,900}attackSpeedBonus/,
    );
    assert.match(
      roomSource,
      /const baseAttacksPerSecond =[\s\S]{0,200}PLAYER_BASE_ATTACK_INTERVAL_MS/,
    );
    assert.match(
      roomSource,
      /const attacksPerSecond =[\s\S]{0,200}baseAttacksPerSecond \+ attackSpeedBonus/,
    );

    const projectPath = process.env.GRANDORIA_GDEVELOP_PROJECT;
    assert.ok(
      projectPath,
      "GRANDORIA_GDEVELOP_PROJECT must select the fixed project.",
    );

    const project = JSON.parse(readFileSync(projectPath, "utf8"));
    const extension = project.eventsFunctionsExtensions.find(
      (candidate: Record<string, unknown>) =>
        candidate.name === "GrandoriaColyseus",
    );
    const sendMonsterAttackFunction = extension.eventsFunctions.find(
      (candidate: Record<string, unknown>) =>
        candidate.name === "SendMonsterAttack",
    );
    const sendMonsterAttackCode =
      sendMonsterAttackFunction.events[0].inlineCode.join("\n");

    assert.match(
      sendMonsterAttackCode,
      /AUTHORITATIVE_ATTACK_INTERVAL_GATE/,
    );
    assert.match(sendMonsterAttackCode, /player\.attackIntervalMs/);
    assert.match(sendMonsterAttackCode, /network\.lastAttackSentAt/);
    assert.match(sendMonsterAttackCode, /network\.lastAttackIntervalMs/);
    assert.match(sendMonsterAttackCode, /setLocalAttackState\(false\)/);
    assert.match(sendMonsterAttackCode, /setLocalAttackState\(true\)/);
    assert.doesNotMatch(sendMonsterAttackCode, /1500|1_500/);

    const sendIndex = sendMonsterAttackCode.indexOf(
      'network.room.send(',
    );
    const localAnimationStartIndex = sendMonsterAttackCode.indexOf(
      "setLocalAttackState(true)",
    );

    assert.ok(sendIndex >= 0);
    assert.ok(localAnimationStartIndex > sendIndex);

    const characterExternalEvents = project.externalEvents.find(
      (candidate: Record<string, unknown>) =>
        candidate.name === "character",
    );
    const colyseusExternalEvents = project.externalEvents.find(
      (candidate: Record<string, unknown>) =>
        candidate.name === "colyseus",
    );
    const localAttackGroup = findNamedEvent(
      characterExternalEvents.events,
      "LOCAL CHARACTER — ATTACK ANIMATION AND HITBOX",
    );
    const legacyPostAttackSendGroup = findNamedEvent(
      colyseusExternalEvents.events,
      "COLYSEUS — SEND MONSTER ATTACK TO SERVER",
    );

    assert.ok(localAttackGroup);
    assert.ok(legacyPostAttackSendGroup);

    const serializedLocalAttack = JSON.stringify(localAttackGroup);

    assert.match(
      serializedLocalAttack,
      /GrandoriaColyseus::SendMonsterAttack/,
    );

    const directLocalAttackStarts: Record<string, unknown>[] = [];

    visitObjects(localAttackGroup, (entry) => {
      const actionType = (entry.type as Record<string, unknown> | undefined)
        ?.value;
      const parameters = Array.isArray(entry.parameters)
        ? entry.parameters
        : [];

      if (
        actionType === "SetBooleanObjectVariable" &&
        parameters[0] === "character" &&
        parameters[1] === "attack" &&
        parameters[2] === "True"
      ) {
        directLocalAttackStarts.push(entry);
      }
    });

    assert.deepStrictEqual(directLocalAttackStarts, []);

    const legacyEvents = Array.isArray(legacyPostAttackSendGroup.events)
      ? legacyPostAttackSendGroup.events
      : [];

    assert.strictEqual(legacyEvents[0]?.disabled, true);

    assert.doesNotThrow(
      () =>
        new Function(
          "runtimeScene",
          "eventsFunctionContext",
          "gdjs",
          sendMonsterAttackCode,
        ),
    );
  });

  it("contains no local currency or inventory mutation in authoritative market events", () => {
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
    const sellFunction = extension.eventsFunctions.find(
      (candidate: Record<string, unknown>) => candidate.name === "SellItem",
    );
    const allocateAttributesFunction = extension.eventsFunctions.find(
      (candidate: Record<string, unknown>) =>
        candidate.name === "AllocateAttributes",
    );
    const connectFunction = extension.eventsFunctions.find(
      (candidate: Record<string, unknown>) =>
        candidate.name === "ConnectToServer",
    );
    const syncLocalEquipmentFunction = extension.eventsFunctions.find(
      (candidate: Record<string, unknown>) =>
        candidate.name === "SyncLocalEquipmentState",
    );
    const applyLocalPlayerStateFunction = extension.eventsFunctions.find(
      (candidate: Record<string, unknown>) =>
        candidate.name === "ApplyLocalPlayerState",
    );

    assert.ok(buyFunction);
    assert.ok(sellFunction);
    assert.ok(allocateAttributesFunction);
    assert.deepStrictEqual(
      sellFunction.parameters.map(
        (parameter: Record<string, unknown>) => parameter.name,
      ),
      ["ItemID", "Quantity"],
    );

    const connectCode = connectFunction.events[0].inlineCode.join("\n");
    const syncLocalEquipmentCode =
      syncLocalEquipmentFunction.events[0].inlineCode.join("\n");
    const applyLocalPlayerStateCode =
      applyLocalPlayerStateFunction.events[1].inlineCode.join("\n");

    assert.match(connectCode, /buy_item_result/);
    assert.match(connectCode, /sell_item_result/);
    assert.match(connectCode, /allocate_attributes_result/);
    assert.match(connectCode, /progression_updated/);
    assert.doesNotMatch(connectCode, /xp_awarded/);
    assert.doesNotMatch(connectCode, /set_max_health_result/);
    assert.doesNotMatch(syncLocalEquipmentCode, /set_max_health/);
    assert.doesNotMatch(syncLocalEquipmentCode, /lastRequestedMaxHealth/);
    assert.match(
      applyLocalPlayerStateCode,
      /authoritative progression, attributes, and health/,
    );
    assert.match(applyLocalPlayerStateCode, /getChild\("CurrentHP"\)/);
    assert.match(applyLocalPlayerStateCode, /getChild\("MaxHP"\)/);

    const roomSource = readFileSync("src/rooms/MyRoom.ts", "utf8");
    assert.doesNotMatch(roomSource, /PLAYER_ATTACK_DAMAGE/);
    assert.doesNotMatch(roomSource, /set_max_health/);
    assert.match(roomSource, /calculateAuthoritativeMaxHealth/);
    assert.match(roomSource, /PLAYER_MAX_HEALTH_LEVEL_GROWTH = 1\.08/);
    assert.match(roomSource, /PHYSICAL_CRITICAL_DAMAGE_MULTIPLIER = 2/);
    assert.match(roomSource, /criticalRollPercent < criticalChancePercent/);
    assert.match(
      roomSource,
      /const attackDamage = this\.rollPlayerPhysicalAttackDamage\(player\);/,
    );
    assert.match(roomSource, /const damage = attackDamage\.damage;/);

    const interfaces = project.externalEvents.find(
      (candidate: Record<string, unknown>) => candidate.name === "interfaces",
    );
    const marketBuyGroup = findNamedEvent(
      interfaces.events,
      "MARKET — BUY ITEMS",
    );
    const marketSaleGroup = findNamedEvent(
      interfaces.events,
      "MARKET — SELL ITEMS",
    );
    const inventoryOpenCloseGroup = findNamedEvent(
      interfaces.events,
      "INVENTORY — OPEN AND CLOSE",
    );
    const marketOpenCloseGroup = findNamedEvent(
      interfaces.events,
      "MARKET — OPEN AND CLOSE WINDOW",
    );

    assert.ok(marketBuyGroup);
    assert.ok(marketSaleGroup);
    assert.ok(inventoryOpenCloseGroup);
    assert.ok(marketOpenCloseGroup);

    const inventoryEvents = Array.isArray(inventoryOpenCloseGroup.events)
      ? inventoryOpenCloseGroup.events as Record<string, unknown>[]
      : [];
    const genericInventoryCloseEvent = inventoryEvents.find((event) => {
      const actions = Array.isArray(event.actions)
        ? event.actions as Record<string, unknown>[]
        : [];

      return actions.some((action) => {
        const actionType = (
          action.type as Record<string, unknown> | undefined
        )?.value;
        const parameters = Array.isArray(action.parameters)
          ? action.parameters
          : [];

        return (
          actionType === "SetBooleanObjectVariable" &&
          parameters[0] === "UI_inventory" &&
          parameters[1] === "open" &&
          parameters[2] === "False"
        );
      });
    });

    assert.ok(genericInventoryCloseEvent);

    const genericInventoryCloseConditions = Array.isArray(
      genericInventoryCloseEvent.conditions,
    )
      ? genericInventoryCloseEvent.conditions as Record<string, unknown>[]
      : [];
    const leavesMarketCloseForMarketHandler =
      genericInventoryCloseConditions.some((condition) => {
        const conditionType = (
          condition.type as Record<string, unknown> | undefined
        )?.value;
        const parameters = Array.isArray(condition.parameters)
          ? condition.parameters
          : [];

        return (
          conditionType === "StringVariable" &&
          parameters[0] === "Game_State" &&
          parameters[1] === "!=" &&
          parameters[2] === '"MARKET"'
        );
      });

    assert.ok(
      leavesMarketCloseForMarketHandler,
      "The generic inventory close event must not consume the market close click.",
    );

    const serializedPurchase = JSON.stringify(marketBuyGroup);
    const serializedSale = JSON.stringify(marketSaleGroup);
    const serializedMarketOpenClose = JSON.stringify(marketOpenCloseGroup);

    assert.match(serializedPurchase, /GrandoriaColyseus::BuyItem/);
    assert.doesNotMatch(serializedPurchase, /inventory\[A\]/);
    assert.doesNotMatch(serializedPurchase, /player_Gold","-"/);
    assert.doesNotMatch(serializedPurchase, /player_Gem","-"/);
    assert.match(serializedSale, /GrandoriaColyseus::SellItem/);
    assert.match(serializedMarketOpenClose, /SetStringVariable/);
    assert.match(serializedMarketOpenClose, /Game_State/);
    assert.match(serializedMarketOpenClose, /GAME/);

    const localSaleMutations: Record<string, unknown>[] = [];

    visitObjects(marketSaleGroup, (entry) => {
      const actionType = (entry.type as Record<string, unknown> | undefined)
        ?.value;
      const parameters = Array.isArray(entry.parameters)
        ? entry.parameters
        : [];
      const target = String(parameters[0] ?? "");

      if (
        (actionType === "SetNumberVariable" ||
          actionType === "SetStringVariable") &&
        (target === "player_Gold" ||
          target === "player_Gem" ||
          target.startsWith("inventory["))
      ) {
        localSaleMutations.push(entry);
      }
    });

    assert.deepStrictEqual(localSaleMutations, []);

    const buyCode = buyFunction.events[0].inlineCode.join("\n");
    const sellCode = sellFunction.events[0].inlineCode.join("\n");

    assert.match(sellCode, /room\.send\(\s*"sell_item"/);
    assert.match(sellCode, /requestId/);
    assert.doesNotMatch(sellCode, /sellPrice|unitPrice|totalPrice/);

    const allocateCode =
      allocateAttributesFunction.events[0].inlineCode.join("\n");

    assert.match(allocateCode, /room\.send\(\"allocate_attributes\"/);
    assert.match(allocateCode, /requestId/);

    const characterExternalEvents = project.externalEvents.find(
      (candidate: Record<string, unknown>) => candidate.name === "character",
    );
    const attributeDistribution = findNamedEvent(
      characterExternalEvents.events,
      "Attribute Distribution",
    );

    assert.ok(attributeDistribution);

    const serializedAttributeDistribution = JSON.stringify(attributeDistribution);

    assert.match(
      serializedAttributeDistribution,
      /GrandoriaColyseus::AllocateAttributes/,
    );

    const localAttributeMutations: Record<string, unknown>[] = [];

    visitObjects(attributeDistribution, (entry) => {
      const actionType = (entry.type as Record<string, unknown> | undefined)
        ?.value;
      const parameters = Array.isArray(entry.parameters)
        ? entry.parameters
        : [];
      const target = String(parameters[0] ?? "");
      const operator = String(parameters[1] ?? "");

      if (
        actionType === "SetNumberVariable" &&
        operator === "+" &&
        target.startsWith("ActiveCharacterData.Attributes.Allocated.")
      ) {
        localAttributeMutations.push(entry);
      }
    });

    assert.deepStrictEqual(localAttributeMutations, []);

    const backendExtension = project.eventsFunctionsExtensions.find(
      (candidate: Record<string, unknown>) => candidate.name === "Backend",
    );
    const saveCharacterFunction = backendExtension.eventsFunctions.find(
      (candidate: Record<string, unknown>) =>
        candidate.name === "SaveCharacter",
    );
    const saveCharacterCode =
      saveCharacterFunction.events[0].inlineCode.join("\n");

    assert.doesNotMatch(saveCharacterCode, /firestore\.updateDocument/);
    assert.doesNotMatch(saveCharacterCode, /persistentFields/);
    assert.match(saveCharacterCode, /saveResult\.setString\("ok"\)/);

    const authoritativeLevelProgress = findNamedEvent(
      characterExternalEvents.events,
      "CHARACTER — AUTHORITATIVE LEVEL PROGRESS",
    );

    assert.ok(authoritativeLevelProgress);

    const serializedLevelProgress = JSON.stringify(authoritativeLevelProgress);

    assert.doesNotMatch(serializedLevelProgress, /ProgressionConfig/);
    assert.doesNotMatch(serializedLevelProgress, /CharacterProgressSaveStatus/);
    assert.doesNotMatch(serializedLevelProgress, /KeyFromTextPressed/);
    assert.doesNotMatch(serializedLevelProgress, /ActiveCharacterData\.Level/);
    assert.doesNotMatch(serializedLevelProgress, /UnspentAttributePoints/);

    const allExternalEvents = project.externalEvents.flatMap(
      (externalEvent: Record<string, unknown>) =>
        Array.isArray(externalEvent.events) ? externalEvent.events : [],
    );
    const persistenceGroup = findNamedEvent(
      allExternalEvents,
      "FIREBASE — INVENTORY, CURRENCIES, AND PERSISTENCE",
    );

    assert.ok(persistenceGroup);

    const serializedPersistenceGroup = JSON.stringify(persistenceGroup);

    assert.doesNotMatch(serializedPersistenceGroup, /player_Gold/);
    assert.doesNotMatch(serializedPersistenceGroup, /player_Gem/);

    assert.doesNotThrow(
      () => new Function("runtimeScene", "eventsFunctionContext", "gdjs", buyCode),
    );
    assert.doesNotThrow(
      () => new Function("runtimeScene", "eventsFunctionContext", "gdjs", sellCode),
    );
    assert.doesNotThrow(
      () => new Function("runtimeScene", "eventsFunctionContext", "gdjs", connectCode),
    );
  });
});
