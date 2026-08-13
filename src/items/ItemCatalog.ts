export type ItemDefinition = {
  maxStack: number;
  subType: string;
  type: string;
};

export const ITEM_DEFINITIONS = {
  black_sword_01: {
    maxStack: 1,
    subType: "Sword",
    type: "Weapons",
  },
  iron_sword_01: {
    maxStack: 1,
    subType: "Sword",
    type: "Weapons",
  },
  purple_chest: {
    maxStack: 1,
    subType: "Warrior Chest",
    type: "Tronco",
  },
  purple_helmet: {
    maxStack: 1,
    subType: "Warrior Helmet",
    type: "Head",
  },
  rabbit_foot: {
    maxStack: 4,
    subType: "Monster Parts",
    type: "Materials",
  },
  rabbit_skin: {
    maxStack: 10,
    subType: "Monster Parts",
    type: "Materials",
  },
} as const satisfies Record<string, ItemDefinition>;

export function getItemDefinition(itemID: string): ItemDefinition | undefined {
  if (!Object.prototype.hasOwnProperty.call(ITEM_DEFINITIONS, itemID)) {
    return undefined;
  }

  return ITEM_DEFINITIONS[itemID as keyof typeof ITEM_DEFINITIONS];
}