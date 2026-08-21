import { createEmptyQuestProgress } from "../src/quests/QuestProgress.js";
import { MyRoom } from "../src/rooms/MyRoom.js";

type TestJoinOptions = {
  characterId?: unknown;
  direction?: unknown;
  equipment?: unknown;
  mapId?: unknown;
  playerUid?: unknown;
  x?: unknown;
  y?: unknown;
};

const EMPTY_ATTRIBUTES = {
  AttackPower: 0,
  MagicPower: 0,
  HealingPower: 0,
  Agility: 0,
  Vitality: 0,
  Regeneration: 0,
  Armor: 0,
  CriticalChance: 0,
};

const EMPTY_EQUIPMENT_SLOT = {
  id: "empty",
  sub_type: "0",
  type: "0",
};

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function readEquipment(value: unknown) {
  const source =
    value && typeof value === "object"
      ? value as Record<string, unknown>
      : {};

  return {
    Head: { ...EMPTY_EQUIPMENT_SLOT },
    Tronco: { ...EMPTY_EQUIPMENT_SLOT },
    Legs: { ...EMPTY_EQUIPMENT_SLOT },
    Foots: { ...EMPTY_EQUIPMENT_SLOT },
    Weapons: { ...EMPTY_EQUIPMENT_SLOT },
    OffHand: { ...EMPTY_EQUIPMENT_SLOT },
    ...source,
  };
}

export function installTestAuthentication() {
  Object.defineProperty(MyRoom, "onAuth", {
    configurable: true,
    value: async (_token: string, rawOptions: unknown) => {
      const options =
        rawOptions && typeof rawOptions === "object"
          ? rawOptions as TestJoinOptions
          : {};

      return {
        uid: readString(options.playerUid, "test-player"),
        characterId: readString(options.characterId, "test-character"),
        classId: "warrior",
        level: 1,
        experience: 0,
        unspentAttributePoints: 0,
        attributes: {
          Base: { ...EMPTY_ATTRIBUTES },
          Allocated: { ...EMPTY_ATTRIBUTES },
          Final: { ...EMPTY_ATTRIBUTES },
        },
        location: {
          mapId: readString(options.mapId, "MAP_1"),
          x: readNumber(options.x, 728),
          y: readNumber(options.y, 1362),
          direction: readString(options.direction, "down"),
        },
        equipment: readEquipment(options.equipment),
        inventory: [
          {
            id: "rabbit_skin",
            type: "Materials",
            sub_type: "Monster Parts",
            quantity: 5,
          },
          {
            id: "rabbit_foot",
            type: "Materials",
            sub_type: "Monster Parts",
            quantity: 4,
          },
        ],
        currencies: {
          gold: 0,
          gem: 0,
        },
        resources: {
          currentHealth: 50,
          maxHealth: 50,
        },
        skillCooldowns: {},
        skillLoadout: {},
        questProgress: createEmptyQuestProgress(),
      };
    },
    writable: true,
  });
}
