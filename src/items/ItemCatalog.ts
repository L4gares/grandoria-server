export type ItemDefinition = {
  maxStack: number;
  subType: string;
  type: string;
};

export type DropRarityDefinition = {
  itemIDs: readonly string[];
  name: string;
  weight: number;
};

export type MonsterDropDefinition = {
  chancePercent: number;
  rarities: readonly DropRarityDefinition[];
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

export const MONSTER_DROP_DEFINITIONS = {
  mob_hare: {
    chancePercent: 80,
    rarities: [
      {
        itemIDs: ["rabbit_foot", "rabbit_skin"],
        name: "common",
        weight: 70,
      },
    ],
  },
} as const satisfies Record<string, MonsterDropDefinition>;

export function getItemDefinition(itemID: string): ItemDefinition | undefined {
  if (!Object.prototype.hasOwnProperty.call(ITEM_DEFINITIONS, itemID)) {
    return undefined;
  }

  return ITEM_DEFINITIONS[itemID as keyof typeof ITEM_DEFINITIONS];
}

export function getMonsterDropDefinition(
  monsterType: string,
): MonsterDropDefinition | undefined {
  if (
    !Object.prototype.hasOwnProperty.call(
      MONSTER_DROP_DEFINITIONS,
      monsterType,
    )
  ) {
    return undefined;
  }

  return MONSTER_DROP_DEFINITIONS[
    monsterType as keyof typeof MONSTER_DROP_DEFINITIONS
  ];
}
