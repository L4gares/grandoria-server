import {
  ArraySchema,
  Schema,
  MapSchema,
  type,
} from "@colyseus/schema";

export class PlayerAppearanceState extends Schema {
  @type("string")
  Sex: string = "Male";

  @type("string")
  SkinTone: string = "Tone_01";

  @type("string")
  EyeColor: string = "EyeColor_01";

  @type("string")
  HairStyle: string = "HairStyle_01";

  @type("string")
  HairColor: string = "HairColor_01";
}

export class PlayerEquipmentSlotState extends Schema {
  @type("string")
  id: string = "empty";

  @type("string")
  type: string = "0";

  @type("string")
  sub_type: string = "0";
}

export class PlayerEquipmentState extends Schema {
  @type(PlayerEquipmentSlotState)
  Head = new PlayerEquipmentSlotState();

  @type(PlayerEquipmentSlotState)
  Tronco = new PlayerEquipmentSlotState();

  @type(PlayerEquipmentSlotState)
  Legs = new PlayerEquipmentSlotState();

  @type(PlayerEquipmentSlotState)
  Foots = new PlayerEquipmentSlotState();

  @type(PlayerEquipmentSlotState)
  Weapons = new PlayerEquipmentSlotState();

  @type(PlayerEquipmentSlotState)
  OffHand = new PlayerEquipmentSlotState();
}

export class PlayerInventorySlotState extends Schema {
  @type("string")
  id: string = "empty";

  @type("string")
  type: string = "0";

  @type("string")
  sub_type: string = "0";

  @type("number")
  quantity: number = 0;
}

export class PlayerState extends Schema {
  @type("number")
  x: number = 0;

  @type("number")
  y: number = 0;

  @type("string")
  direction: string = "down";

  @type("string")
  animation: string = "idle";

  @type("string")
  displayName: string = "";

  @type("string")
  characterId: string = "";

  @type("string")
  mapId: string = "";

  @type("number")
  currentHealth: number = 50;

  @type("number")
  maxHealth: number = 50;

  @type("boolean")
  isAlive: boolean = true;

  @type(PlayerAppearanceState)
  appearance = new PlayerAppearanceState();

  @type(PlayerEquipmentState)
  equipment = new PlayerEquipmentState();

  @type([PlayerInventorySlotState])
  inventory = new ArraySchema<PlayerInventorySlotState>();
}

export class MonsterState extends Schema {
  @type("string")
  monsterType: string = "slime";

  @type("string")
  mapId: string = "MAP_1";

  @type("number")
  x: number = 0;

  @type("number")
  y: number = 0;

  @type("string")
  direction: string = "down";

  @type("string")
  animation: string = "idle";

  @type("number")
  currentHealth: number = 30;

  @type("number")
  maxHealth: number = 30;

  @type("boolean")
  isAlive: boolean = true;

  @type("number")
  hitboxMinX: number = 0;

  @type("number")
  hitboxMaxX: number = 0;

  @type("number")
  hitboxMinY: number = 0;

  @type("number")
  hitboxMaxY: number = 0;
}

export class WorldItemState extends Schema {
  @type("string")
  itemID: string = "";

  @type("string")
  type: string = "0";

  @type("string")
  subType: string = "0";

  @type("number")
  quantity: number = 1;

  @type("number")
  x: number = 0;

  @type("number")
  y: number = 0;

  @type("number")
  zOrder: number = 300;

  @type("string")
  mapId: string = "MAP_1";

  @type("string")
  source: string = "";

  @type("string")
  createdBy: string = "";

  @type("number")
  createdAt: number = 0;

  @type("string")
  monsterType: string = "";

  @type("string")
  monsterId: string = "";

  @type("string")
  rarity: string = "";
}

export class MyRoomState extends Schema {
  @type({ map: PlayerState })
  players = new MapSchema<PlayerState>();

  @type({ map: MonsterState })
  monsters = new MapSchema<MonsterState>();

  @type({ map: WorldItemState })
  items = new MapSchema<WorldItemState>();
}
