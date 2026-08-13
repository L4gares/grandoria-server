import {
  Room,
  Client,
  CloseCode,
  ErrorCode,
  ServerError,
  type AuthContext,
} from "colyseus";

import {
  firebaseAdminAuth,
  firebaseAdminFirestore,
} from "../firebase/FirebaseAdmin.js";

import {
  MyRoomState,
  MonsterState,
  PlayerState,
  PlayerEquipmentSlotState,
  PlayerInventorySlotState,
  WorldItemState,
} from "./schema/MyRoomState.js";

import {
  getItemDefinition,
} from "../items/ItemCatalog.js";

import {
  getMonsterDefinition,
  type MonsterAttackDefinition,
  type MonsterDefinition,
  type MonsterDropDefinition,
  type MonsterType,
} from "../config/MonsterCatalog.js";

import {
  findMonsterSpawnPoint,
  getMonsterSpawnRegions,
  normalizeWorldMapId,
  resolveMonsterMovement,
  resolvePlayerMovement,
  resolvePlayerSpawn,
  type MonsterSpawnRegion,
} from "../world/WorldCollision.js";

type InputMessage = {
  left?: unknown;
  right?: unknown;
  up?: unknown;
  down?: unknown;
};

type AttackMessage = {
  monsterId?: unknown;
  MonsterID?: unknown;
  targetId?: unknown;
  TargetID?: unknown;
};

type DropItemMessage = {
  itemID?: unknown;
  itemId?: unknown;
  quantity?: unknown;
  requestId?: unknown;
  RequestID?: unknown;
};

type CollectItemMessage = {
  requestId?: unknown;
  RequestID?: unknown;
  sharedItemID?: unknown;
  sharedItemId?: unknown;
  itemID?: unknown;
  itemId?: unknown;
};

type SetInventoryOrderMessage = {
  inventory?: unknown;
  Inventory?: unknown;
  requestId?: unknown;
  RequestID?: unknown;
};

type SetMaxHealthMessage = {
  maxHealth?: unknown;
  MaxHP?: unknown;
  requestId?: unknown;
  RequestID?: unknown;
};

type PlayerInput = {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
};

type JoinOptions = {
  playerUid?: unknown;
  PlayerUID?: unknown;

  characterId?: unknown;
  CharacterID?: unknown;

  characterName?: unknown;
  CharacterName?: unknown;

  mapId?: unknown;
  MapID?: unknown;

  x?: unknown;
  X?: unknown;

  y?: unknown;
  Y?: unknown;

  direction?: unknown;
  Direction?: unknown;

  appearance?: unknown;
  Appearance?: unknown;

  equipment?: unknown;
  Equipment?: unknown;
};

type SetEquipmentMessage = {
  requestId?: unknown;
  RequestID?: unknown;
  slot?: unknown;
  item?: unknown;
  equipment?: unknown;
  value?: unknown;
};

type PlayerIdentity = {
  playerUid: string;
  characterId: string;
  mapId: string;
};

type AuthenticatedPlayer = {
  uid: string;
  characterId: string;

  location: {
    mapId: string;
    x: number;
    y: number;
    direction: string;
  };

  equipment: Record<EquipmentSlotName, EquipmentSlotData>;

  inventory: InventorySlotData[];

  resources: {
    currentHealth: number;
    maxHealth: number;
  };
};

type EquipmentSlotName =
  | "Head"
  | "Tronco"
  | "Legs"
  | "Foots"
  | "Weapons"
  | "OffHand";

type EquipmentSlotData = {
  id: string;
  type: string;
  sub_type: string;
};

type InventorySlotData = EquipmentSlotData & {
  quantity: number;
};

type Hitbox = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type MonsterDirection = "up" | "down" | "left" | "right";

type MonsterPatrolState = {
  direction: MonsterDirection | null;
  remainingMs: number;
};

type MonsterReactionState =
  | {
      mode: "react";
      targetSessionId: string;
    }
  | {
      mode: "return";
    };

type MonsterTarget = {
  distance: number;
  sessionId: string;
};

type MonsterAttackState = {
  targetSessionId: string;
  remainingMs: number;
};

type CreateWorldItemOptions = {
  createdBy: string;
  itemID: string;
  mapId: string;
  monsterId?: string;
  monsterType?: string;
  quantity?: number;
  rarity?: string;
  source: "inventory_drop" | "mob_drop";
  x: number;
  y: number;
};

type SelectedMonsterDrop = {
  itemID: string;
  quantity: number;
  rarity: string;
};

type MonsterSpawn = {
  monsterId: string;
  monsterType: MonsterType;
  mapId: string;
  regionId: string;
  x: number;
  y: number;
  direction: MonsterDirection;
};

const PLAYER_SPEED = 90;
const DEFAULT_PLAYER_MAX_HEALTH = 50;
const PLAYER_RESPAWN_DELAY_MS = 3_000;
const PLAYER_RESPAWN_HEALTH_RATIO = 0.5;
const PLAYER_RESPAWN_POINTS = [
  { mapId: "MAP_1", x: 728, y: 1362 },
  { mapId: "MAP_1", x: 796, y: 1394 },
  { mapId: "MAP_1", x: 889, y: 1402 },
] as const;
const ITEM_COLLECTION_DISTANCE = 48;
const ITEM_DROP_OFFSET_X = 25;
const ITEM_DROP_OFFSET_Y = 16;
const ITEM_DROP_POSITION_ATTEMPTS = 8;
const MONSTER_DROP_SPACING = 18;
const MONSTER_DROP_MIN_RADIUS = 10;
const MONSTER_DROP_MAX_RADIUS = 36;
const MONSTER_DROP_POSITION_ATTEMPTS = 32;
const MONSTER_DROP_FALLBACK_MAX_RING = 4;
const MAX_ITEM_REQUEST_ID_LENGTH = 128;
const FIXED_TIME_STEP = 1000 / 60;
const MONSTER_PATROL_MIN_DURATION_MS = 2_000;
const MONSTER_PATROL_MAX_DURATION_MS = 10_000;
const MONSTER_PATROL_WALK_CHANCE = 0.8;
const MONSTER_HOME_ARRIVAL_EPSILON = 0.01;
const TIMER_EPSILON_MS = 0.0001;

const MONSTER_PATROL_DIRECTIONS: readonly MonsterDirection[] = [
  "down",
  "left",
  "right",
  "up",
];

const MONSTER_SPAWN_RETRY_DELAY_MS = 1_000;

/*
 * Four frames at 0.08 seconds each:
 * 4 × 0.08 = 0.32 seconds.
 */
const ATTACK_DURATION_MS = 320;

/*
 * The attack hitbox becomes active only
 * on the fourth animation frame:
 * 3 × 0.08 = 0.24 seconds.
 */
const ATTACK_HIT_DELAY_MS = 240;

const ATTACK_HIT_REMAINING_MS = ATTACK_DURATION_MS - ATTACK_HIT_DELAY_MS;

/*
 * Matches the current character.damage
 * value in the GDevelop project.
 */
const PLAYER_ATTACK_DAMAGE = 1;

/*
 * Additional server-side safety limit.
 * The directional hitbox is even smaller.
 */
const MAX_PLAYER_ATTACK_DISTANCE = 40;

function createIdleInput(): PlayerInput {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
  };
}

function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function readSafeString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function readSafeStringFromAliases(
  values: unknown[],
  maxLength: number,
): string {
  for (const value of values) {
    const result = readSafeString(value, maxLength);

    if (result) {
      return result;
    }
  }

  return "";
}

function readAppearanceValue(value: unknown, fallback: string): string {
  const result = readSafeString(value, 64);

  if (!result || !/^[A-Za-z0-9_-]+$/.test(result)) {
    return fallback;
  }

  return result;
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readFirstDefined(
  source: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }

  return undefined;
}

function readFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return value;
}

function readFiniteNumberFromAliases(
  values: unknown[],
  fallback: number,
): number {
  for (const value of values) {
    const result = readFiniteNumber(value, Number.NaN);

    if (Number.isFinite(result)) {
      return result;
    }
  }

  return fallback;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const result = Math.trunc(value);

  return result > 0 ? result : null;
}

function readDirectionFromAliases(values: unknown[]): string {
  for (const value of values) {
    if (
      value === "up" ||
      value === "down" ||
      value === "left" ||
      value === "right"
    ) {
      return value;
    }
  }

  return "down";
}

function getPlayerAttackHitbox(player: PlayerState): Hitbox {
  switch (player.direction) {
    case "right":
      return {
        minX: player.x + 7.5,
        maxX: player.x + 21.5,
        minY: player.y - 22.5,
        maxY: player.y + 9.5,
      };

    case "left":
      return {
        minX: player.x - 20.5,
        maxX: player.x - 6.5,
        minY: player.y - 22.5,
        maxY: player.y + 9.5,
      };

    case "up":
      return {
        minX: player.x - 11.5,
        maxX: player.x + 20.5,
        minY: player.y - 24.5,
        maxY: player.y - 10.5,
      };

    case "down":
    default:
      return {
        minX: player.x - 11.5,
        maxX: player.x + 20.5,
        minY: player.y - 2.5,
        maxY: player.y + 11.5,
      };
  }
}

function getMonsterHitbox(
  monster: MonsterState,
  definition: MonsterDefinition,
): Hitbox {
  const offsets = definition.hitboxOffsets;

  return {
    minX: monster.x + offsets.minX,
    maxX: monster.x + offsets.maxX,
    minY: monster.y + offsets.minY,
    maxY: monster.y + offsets.maxY,
  };
}

function hitboxesIntersect(first: Hitbox, second: Hitbox): boolean {
  return (
    first.minX <= second.maxX &&
    first.maxX >= second.minX &&
    first.minY <= second.maxY &&
    first.maxY >= second.minY
  );
}

function readEquipmentText(value: unknown, fallback: string): string {
  let result = "";

  if (typeof value === "string") {
    result = value.trim();
  } else if (typeof value === "number" && Number.isFinite(value)) {
    result = String(value);
  }

  if (!result || /[\u0000-\u001F\u007F]/.test(result)) {
    return fallback;
  }

  return result.slice(0, 64);
}

function parseEquipmentSlot(value: unknown): EquipmentSlotData | null {
  const source = readObject(value);

  const id = readEquipmentText(source.id ?? source.ID, "");

  if (!id) {
    return null;
  }

  if (id.toLowerCase() === "empty" || id === "0") {
    return {
      id: "empty",
      type: "0",
      sub_type: "0",
    };
  }

  return {
    id,

    type: readEquipmentText(source.type ?? source.Type, "0"),

    sub_type: readEquipmentText(
      source.sub_type ?? source.subType ?? source.SubType,
      "0",
    ),
  };
}

function applyEquipmentSlot(
  target: PlayerEquipmentSlotState,
  value: unknown,
): boolean {
  const parsed = parseEquipmentSlot(value);

  if (!parsed) {
    return false;
  }

  target.id = parsed.id;
  target.type = parsed.type;
  target.sub_type = parsed.sub_type;

  return true;
}

function createEmptyEquipmentSlotData(): EquipmentSlotData {
  return {
    id: "empty",
    type: "0",
    sub_type: "0",
  };
}

function readEquipmentData(value: unknown): Record<EquipmentSlotName, EquipmentSlotData> {
  const source = readObject(value);

  return {
    Head:
      parseEquipmentSlot(readFirstDefined(source, ["Head", "head"])) ??
      createEmptyEquipmentSlotData(),
    Tronco:
      parseEquipmentSlot(
        readFirstDefined(source, ["Tronco", "tronco", "Chest", "chest"]),
      ) ?? createEmptyEquipmentSlotData(),
    Legs:
      parseEquipmentSlot(
        readFirstDefined(source, ["Legs", "legs", "Pants", "pants"]),
      ) ?? createEmptyEquipmentSlotData(),
    Foots:
      parseEquipmentSlot(
        readFirstDefined(source, [
          "Foots",
          "foots",
          "Feet",
          "feet",
          "Boots",
          "boots",
        ]),
      ) ?? createEmptyEquipmentSlotData(),
    Weapons:
      parseEquipmentSlot(
        readFirstDefined(source, ["Weapons", "weapons", "Weapon", "weapon"]),
      ) ?? createEmptyEquipmentSlotData(),
    OffHand:
      parseEquipmentSlot(
        readFirstDefined(source, [
          "OffHand",
          "offHand",
          "offhand",
          "Off_Hand",
          "off_hand",
          "Shield",
          "shield",
        ]),
      ) ?? createEmptyEquipmentSlotData(),
  };
}

function readInventoryData(value: unknown): InventorySlotData[] {
  const source = Array.isArray(value) ? value : [];
  const inventory: InventorySlotData[] = [];

  for (let slotIndex = 0; slotIndex < 20; slotIndex += 1) {
    const slotSource = readObject(source[slotIndex]);
    const id = readEquipmentText(slotSource.id ?? slotSource.ID, "empty");
    const quantityValue = readFiniteNumber(
      slotSource.quantity ?? slotSource.Quantity,
      0,
    );
    const quantity = Math.max(0, Math.trunc(quantityValue));

    if (id === "empty" || id === "0" || quantity === 0) {
      inventory.push({
        id: "empty",
        type: "0",
        sub_type: "0",
        quantity: 0,
      });
      continue;
    }

    inventory.push({
      id,
      type: readEquipmentText(slotSource.type ?? slotSource.Type, "0"),
      sub_type: readEquipmentText(
        slotSource.sub_type ?? slotSource.subType ?? slotSource.SubType,
        "0",
      ),
      quantity,
    });
  }

  return inventory;
}

function readEquipmentSlotName(value: unknown): EquipmentSlotName | null {
  if (typeof value !== "string") {
    return null;
  }

  switch (value.trim().toLowerCase()) {
    case "head":
      return "Head";

    case "tronco":
    case "chest":
      return "Tronco";

    case "legs":
    case "pants":
      return "Legs";

    case "foots":
    case "feet":
    case "boots":
      return "Foots";

    case "weapons":
    case "weapon":
      return "Weapons";

    case "offhand":
    case "off_hand":
    case "shield":
      return "OffHand";

    default:
      return null;
  }
}

function getEquipmentSlot(
  player: PlayerState,
  slot: EquipmentSlotName,
): PlayerEquipmentSlotState {
  switch (slot) {
    case "Head":
      return player.equipment.Head;

    case "Tronco":
      return player.equipment.Tronco;

    case "Legs":
      return player.equipment.Legs;

    case "Foots":
      return player.equipment.Foots;

    case "Weapons":
      return player.equipment.Weapons;

    case "OffHand":
      return player.equipment.OffHand;
  }
}

export class MyRoom extends Room<{
  state: MyRoomState;
}> {
   static async onAuth(
    token: string,
    options: unknown,
    _context: AuthContext,
  ): Promise<AuthenticatedPlayer> {
    const firebaseIdToken =
      typeof token === "string" ? token.trim() : "";

    const joinOptions =
      typeof options === "object" && options !== null
        ? (options as JoinOptions)
        : ({} as JoinOptions);

    const characterId = readSafeStringFromAliases(
      [joinOptions.characterId, joinOptions.CharacterID],
      128,
    );

    if (firebaseIdToken === "") {
      console.warn(
        "[Grandoria] Authentication rejected: Firebase ID token is missing.",
      );

      throw new ServerError(
        ErrorCode.AUTH_FAILED,
        "Authentication failed.",
      );
    }

    if (
      characterId === "" ||
      characterId.includes("/")
    ) {
      console.warn(
        "[Grandoria] Authentication rejected: CharacterID is missing or invalid.",
      );

      throw new ServerError(
        ErrorCode.AUTH_FAILED,
        "Authentication failed.",
      );
    }

    let authenticatedUid = "";

    try {
      const decodedToken =
        await firebaseAdminAuth.verifyIdToken(
          firebaseIdToken,
          true,
        );

      authenticatedUid = decodedToken.uid;
    } catch (error) {
      const errorCode =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "unknown";

      console.warn(
        "[Grandoria] Authentication rejected:",
        errorCode,
      );

      throw new ServerError(
        ErrorCode.AUTH_FAILED,
        "Authentication failed.",
      );
    }

    let authenticatedLocation: AuthenticatedPlayer["location"] | null = null;
    let authenticatedEquipment: AuthenticatedPlayer["equipment"] | null = null;
    let authenticatedInventory: AuthenticatedPlayer["inventory"] | null = null;
    let authenticatedResources: AuthenticatedPlayer["resources"] | null = null;

    try {
  const characterSnapshot =
    await firebaseAdminFirestore
      .collection("users")
      .doc(authenticatedUid)
      .collection("characters")
      .doc(characterId)
      .get();

  if (!characterSnapshot.exists) {
    console.warn(
      "[Grandoria] Authentication rejected: character does not belong to the authenticated user.",
    );

    throw new ServerError(
      ErrorCode.AUTH_FAILED,
      "Authentication failed.",
    );
  }

  const characterData =
    readObject(characterSnapshot.data());

  authenticatedEquipment = readEquipmentData(
    characterData.Equipment ?? characterData.equipment,
  );

  authenticatedInventory = readInventoryData(
    characterData.Inventory ?? characterData.inventory,
  );

  const resourcesData = readObject(
    characterData.Resources ?? characterData.resources,
  );
  const maxHealth = Math.max(
    1,
    Math.trunc(
      readFiniteNumberFromAliases(
        [resourcesData.MaxHP, resourcesData.maxHP, resourcesData.maxHealth],
        DEFAULT_PLAYER_MAX_HEALTH,
      ),
    ),
  );
  const currentHealth = Math.min(
    maxHealth,
    Math.max(
      0,
      Math.trunc(
        readFiniteNumberFromAliases(
          [
            resourcesData.CurrentHP,
            resourcesData.currentHP,
            resourcesData.currentHealth,
          ],
          maxHealth,
        ),
      ),
    ),
  );

  authenticatedResources = {
    currentHealth,
    maxHealth,
  };

  const locationData =
    readObject(
      characterData.Location ??
      characterData.location,
    );

  const mapId =
    normalizeWorldMapId(
      readSafeStringFromAliases(
        [
          locationData.Map,
          locationData.map,
          locationData.MapID,
          locationData.mapId,
        ],
        64,
      ),
    );

  const savedX =
    readFiniteNumberFromAliases(
      [
        locationData.X,
        locationData.x,
      ],
      Number.NaN,
    );

  const savedY =
    readFiniteNumberFromAliases(
      [
        locationData.Y,
        locationData.y,
      ],
      Number.NaN,
    );

  const spawn =
    resolvePlayerSpawn(
      mapId,
      savedX,
      savedY,
    );

  authenticatedLocation = {
    mapId,
    x: spawn.x,
    y: spawn.y,

    direction:
      readDirectionFromAliases([
        locationData.Direction,
        locationData.direction,
      ]),
  };
} catch (error) {
  if (error instanceof ServerError) {
    throw error;
  }

  const errorCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "unknown";

  console.error(
    "[Grandoria] Character data lookup failed:",
    errorCode,
  );

  throw new ServerError(
    ErrorCode.AUTH_FAILED,
    "Authentication failed.",
  );
}

if (
  !authenticatedLocation ||
  !authenticatedEquipment ||
  !authenticatedInventory ||
  !authenticatedResources
) {
  console.warn(
    "[Grandoria] Authentication rejected: persistent character data is missing.",
  );

  throw new ServerError(
    ErrorCode.AUTH_FAILED,
    "Authentication failed.",
  );
}

    return {
      uid: authenticatedUid,
      characterId,
      location: authenticatedLocation,
      equipment: authenticatedEquipment,
      inventory: authenticatedInventory,
      resources: authenticatedResources,
    };
  }

  maxClients = 50;

  maxMessagesPerSecond = 120;

  state = new MyRoomState();

  private readonly playerInputs = new Map<string, PlayerInput>();

  private readonly playerCollisionBlocks = new Set<string>();

  private readonly playerIdentities = new Map<string, PlayerIdentity>();

  /*
   * Stores the remaining attack time
   * independently for each session.
   */
  private readonly playerAttackRemaining = new Map<string, number>();

  /*
   * Stores the requested target for the
   * current attack. The server still
   * validates it when the hit frame occurs.
   */
  private readonly playerAttackTargets = new Map<string, string>();

  private readonly playerRespawnRemaining = new Map<string, number>();

  private readonly monsterHurtRemaining = new Map<string, number>();

  private readonly monsterDeathRemaining = new Map<string, number>();

  private readonly monsterRespawnRemaining = new Map<string, number>();

  private readonly monsterPatrolStates = new Map<
    string,
    MonsterPatrolState
  >();

  private readonly monsterReactionStates = new Map<
    string,
    MonsterReactionState
  >();

  private readonly monsterAttackStates = new Map<
    string,
    MonsterAttackState
  >();

  private readonly monsterAttackCooldownRemaining = new Map<string, number>();

  private readonly monstersPendingRespawnIdleTick = new Set<string>();

  private readonly completedDropRequests = new Map<
    string,
    Map<string, Record<string, unknown>>
  >();

  private readonly playerInventoryOperations = new Set<string>();

  private readonly monsterSpawnsById = new Map<string, MonsterSpawn>();

  private readonly monsterRegionsByMonsterId = new Map<
    string,
    MonsterSpawnRegion
  >();

  private monsterRandom: () => number = Math.random;

  private worldItemRandom: () => number = Math.random;

  private worldItemSequence = 0;

  messages = {
    input: (client: Client, message: InputMessage) => {
      if (
        !message ||
        typeof message.left !== "boolean" ||
        typeof message.right !== "boolean" ||
        typeof message.up !== "boolean" ||
        typeof message.down !== "boolean"
      ) {
        return;
      }

      const player = this.state.players.get(client.sessionId);

      if (!player || !player.isAlive || player.currentHealth <= 0) {
        return;
      }

      this.playerInputs.set(client.sessionId, {
        left: message.left,
        right: message.right,
        up: message.up,
        down: message.down,
      });
    },

    attack: (client: Client, message?: AttackMessage) => {
      const player = this.state.players.get(client.sessionId);

      if (!player || !player.isAlive || player.currentHealth <= 0) {
        return;
      }

      console.log(`Attack received: ${client.sessionId}`);
      /*
       * Prevents repeated messages from
       * restarting or speeding up the attack.
       */
      if (this.playerAttackRemaining.has(client.sessionId)) {
        return;
      }

      this.playerAttackRemaining.set(client.sessionId, ATTACK_DURATION_MS);

      const attackData = readObject(message);

      const monsterId = readSafeStringFromAliases(
        [
          attackData.monsterId,
          attackData.MonsterID,
          attackData.targetId,
          attackData.TargetID,
        ],
        128,
      );

      if (monsterId) {
        this.playerAttackTargets.set(client.sessionId, monsterId);
      } else {
        this.playerAttackTargets.delete(client.sessionId);
      }

      /*
       * Clears the last input immediately.
       * New inputs may arrive, but movement is
       * ignored until the attack has finished.
       */
      this.playerInputs.set(client.sessionId, createIdleInput());

      this.playerCollisionBlocks.delete(client.sessionId);

      player.animation = "attack";
    },

    set_equipment: async (client: Client, message: SetEquipmentMessage) => {
      await this.handleSetEquipmentRequest(client, message);
    },

    drop_item: async (client: Client, message?: DropItemMessage) => {
      await this.handleDropItemRequest(client, message);
    },

    collect_item: async (client: Client, message?: CollectItemMessage) => {
      await this.handleCollectItemRequest(client, message);
    },

    set_inventory_order: async (
      client: Client,
      message?: SetInventoryOrderMessage,
    ) => {
      await this.handleSetInventoryOrderRequest(client, message);
    },

    set_max_health: async (client: Client, message?: SetMaxHealthMessage) => {
      await this.handleSetMaxHealthRequest(client, message);
    },
  };

  onCreate() {
    this.initializeMonsterSpawnRegions();

    let elapsedTime = 0;

    this.setSimulationInterval((deltaTime) => {
      elapsedTime += deltaTime;

      while (elapsedTime >= FIXED_TIME_STEP) {
        elapsedTime -= FIXED_TIME_STEP;

        this.fixedTick(FIXED_TIME_STEP);
      }
    });
  }

  private createWorldItem(options: CreateWorldItemOptions): string | null {
    const definition = getItemDefinition(options.itemID);
    const quantity = options.quantity ?? 1;

    if (
      !definition ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      return null;
    }

    this.worldItemSequence += 1;

    const sourcePrefix = options.source === "mob_drop" ? "mob_drop" : "drop";
    const safeOrigin = (options.monsterId || "item").replace(
      /[^A-Za-z0-9_-]/g,
      "_",
    );
    const sharedItemID = [
      sourcePrefix,
      safeOrigin,
      Date.now().toString(36),
      this.worldItemSequence.toString(36),
    ].join("_");

    const item = new WorldItemState();

    item.itemID = options.itemID;
    item.type = definition.type;
    item.subType = definition.subType;
    item.quantity = quantity;
    item.x = Math.round(options.x);
    item.y = Math.round(options.y);
    item.zOrder = 300;
    item.mapId = normalizeWorldMapId(options.mapId);
    item.source = options.source;
    item.createdBy = options.createdBy;
    item.createdAt = Date.now();
    item.monsterType = options.monsterType ?? "";
    item.monsterId = options.monsterId ?? "";
    item.rarity = options.rarity ?? "";

    this.state.items.set(sharedItemID, item);

    return sharedItemID;
  }

  private findInventoryDropPosition(player: PlayerState): {
    x: number;
    y: number;
  } {
    for (
      let attempt = 0;
      attempt < ITEM_DROP_POSITION_ATTEMPTS;
      attempt += 1
    ) {
      const offsetX =
        Math.floor(
          clampUnitInterval(this.worldItemRandom()) *
            (ITEM_DROP_OFFSET_X * 2 + 1),
        ) - ITEM_DROP_OFFSET_X;
      const offsetY =
        Math.floor(
          clampUnitInterval(this.worldItemRandom()) *
            (ITEM_DROP_OFFSET_Y * 2 + 1),
        ) - ITEM_DROP_OFFSET_Y;
      const candidateX = Math.round(player.x + offsetX);
      const candidateY = Math.round(player.y + offsetY);
      const resolved = resolvePlayerSpawn(
        player.mapId,
        candidateX,
        candidateY,
      );

      if (!resolved.recovered) {
        return {
          x: candidateX,
          y: candidateY,
        };
      }
    }

    return {
      x: Math.round(player.x),
      y: Math.round(player.y),
    };
  }

  private readPlayerInventory(player: PlayerState): InventorySlotData[] {
    return Array.from(player.inventory).map((slot) => ({
      id: slot.id,
      type: slot.type,
      sub_type: slot.sub_type,
      quantity: slot.quantity,
    }));
  }

  private restorePlayerInventory(
    player: PlayerState,
    inventory: InventorySlotData[],
  ) {
    player.inventory.clear();

    for (const slotData of inventory) {
      const slot = new PlayerInventorySlotState();
      slot.id = slotData.id;
      slot.type = slotData.type;
      slot.sub_type = slotData.sub_type;
      slot.quantity = slotData.quantity;
      player.inventory.push(slot);
    }
  }

  private async persistPlayerInventory(
    client: Client,
    player: PlayerState,
  ) {
    const identity = this.playerIdentities.get(client.sessionId);

    if (!identity) {
      throw new Error("PLAYER_IDENTITY_MISSING");
    }

    await firebaseAdminFirestore
      .collection("users")
      .doc(identity.playerUid)
      .collection("characters")
      .doc(identity.characterId)
      .update({
        Inventory: this.readPlayerInventory(player),
      });
  }

  private readPlayerEquipment(
    player: PlayerState,
  ): Record<EquipmentSlotName, EquipmentSlotData> {
    return {
      Head: parseEquipmentSlot(player.equipment.Head) ?? createEmptyEquipmentSlotData(),
      Tronco:
        parseEquipmentSlot(player.equipment.Tronco) ?? createEmptyEquipmentSlotData(),
      Legs: parseEquipmentSlot(player.equipment.Legs) ?? createEmptyEquipmentSlotData(),
      Foots:
        parseEquipmentSlot(player.equipment.Foots) ?? createEmptyEquipmentSlotData(),
      Weapons:
        parseEquipmentSlot(player.equipment.Weapons) ?? createEmptyEquipmentSlotData(),
      OffHand:
        parseEquipmentSlot(player.equipment.OffHand) ?? createEmptyEquipmentSlotData(),
    };
  }

  private restorePlayerEquipment(
    player: PlayerState,
    equipment: Record<EquipmentSlotName, EquipmentSlotData>,
  ) {
    for (const slotName of Object.keys(equipment) as EquipmentSlotName[]) {
      applyEquipmentSlot(getEquipmentSlot(player, slotName), equipment[slotName]);
    }
  }

  private async persistPlayerInventoryAndEquipment(
    client: Client,
    player: PlayerState,
  ) {
    const identity = this.playerIdentities.get(client.sessionId);

    if (!identity) {
      throw new Error("PLAYER_IDENTITY_MISSING");
    }

    await firebaseAdminFirestore
      .collection("users")
      .doc(identity.playerUid)
      .collection("characters")
      .doc(identity.characterId)
      .update({
        Inventory: this.readPlayerInventory(player),
        Equipment: this.readPlayerEquipment(player),
      });
  }

  private async handleSetEquipmentRequest(
    client: Client,
    message: SetEquipmentMessage,
  ) {
    const player = this.state.players.get(client.sessionId);
    const messageData = readObject(message);
    const requestId = readSafeStringFromAliases(
      [messageData.requestId, messageData.RequestID],
      MAX_ITEM_REQUEST_ID_LENGTH,
    );
    const slotName = readEquipmentSlotName(messageData.slot);

    if (!player || !slotName) {
      client.send("set_equipment_result", {
        code: "INVALID_REQUEST",
        ok: false,
        requestId,
      });
      return;
    }

    if (this.playerInventoryOperations.has(client.sessionId)) {
      client.send("set_equipment_result", {
        code: "INVENTORY_BUSY",
        ok: false,
        requestId,
        slot: slotName,
      });
      return;
    }

    const equipmentData =
      messageData.item ??
      messageData.equipment ??
      messageData.value ??
      messageData;
    const requestedEquipment = parseEquipmentSlot(equipmentData);

    if (!requestedEquipment) {
      client.send("set_equipment_result", {
        code: "INVALID_EQUIPMENT",
        ok: false,
        requestId,
        slot: slotName,
      });
      return;
    }

    const currentSlot = getEquipmentSlot(player, slotName);
    const currentEquipment =
      parseEquipmentSlot(currentSlot) ?? createEmptyEquipmentSlotData();

    if (currentEquipment.id === requestedEquipment.id) {
      client.send("set_equipment_result", {
        code: "NO_CHANGE",
        equipment: currentEquipment,
        ok: true,
        requestId,
        slot: slotName,
      });
      return;
    }

    const requestedDefinition =
      requestedEquipment.id === "empty"
        ? undefined
        : getItemDefinition(requestedEquipment.id);

    if (
      requestedEquipment.id !== "empty" &&
      (!requestedDefinition || requestedDefinition.type !== slotName)
    ) {
      client.send("set_equipment_result", {
        code: "WRONG_EQUIPMENT_SLOT",
        ok: false,
        requestId,
        slot: slotName,
      });
      return;
    }

    this.playerInventoryOperations.add(client.sessionId);
    const inventoryBefore = this.readPlayerInventory(player);
    const equipmentBefore = this.readPlayerEquipment(player);

    if (
      requestedEquipment.id !== "empty" &&
      !this.removeInventoryItem(player, requestedEquipment.id, 1)
    ) {
      this.playerInventoryOperations.delete(client.sessionId);
      client.send("set_equipment_result", {
        code: "ITEM_NOT_IN_INVENTORY",
        ok: false,
        requestId,
        slot: slotName,
      });
      return;
    }

    if (
      currentEquipment.id !== "empty" &&
      !this.addInventoryItem(player, currentEquipment.id, 1)
    ) {
      this.restorePlayerInventory(player, inventoryBefore);
      this.playerInventoryOperations.delete(client.sessionId);
      client.send("set_equipment_result", {
        code: "INVENTORY_FULL",
        ok: false,
        requestId,
        slot: slotName,
      });
      return;
    }

    applyEquipmentSlot(
      currentSlot,
      requestedEquipment.id === "empty"
        ? createEmptyEquipmentSlotData()
        : {
            id: requestedEquipment.id,
            type: requestedDefinition!.type,
            sub_type: requestedDefinition!.subType,
          },
    );

    try {
      await this.persistPlayerInventoryAndEquipment(client, player);
    } catch (error) {
      this.restorePlayerInventory(player, inventoryBefore);
      this.restorePlayerEquipment(player, equipmentBefore);
      this.playerInventoryOperations.delete(client.sessionId);

      client.send("set_equipment_result", {
        code: "EQUIPMENT_SAVE_FAILED",
        ok: false,
        requestId,
        slot: slotName,
      });

      console.error("[Grandoria] Equipment save failed:", error);
      return;
    }

    this.playerInventoryOperations.delete(client.sessionId);

    const savedEquipment =
      parseEquipmentSlot(currentSlot) ?? createEmptyEquipmentSlotData();

    client.send("set_equipment_result", {
      code: "EQUIPMENT_UPDATED",
      equipment: savedEquipment,
      inventory: this.readPlayerInventory(player),
      ok: true,
      requestId,
      slot: slotName,
    });

    console.log(`[Grandoria] Equipment updated and persisted: ${client.sessionId}`, {
      slot: slotName,
      id: savedEquipment.id,
      type: savedEquipment.type,
      sub_type: savedEquipment.sub_type,
    });
  }

  private removeInventoryItem(
    player: PlayerState,
    itemID: string,
    quantity: number,
  ): boolean {
    const availableQuantity = Array.from(player.inventory)
      .filter((slot) => slot.id === itemID)
      .reduce((total, slot) => total + Math.max(0, slot.quantity), 0);

    if (availableQuantity < quantity) {
      return false;
    }

    let remaining = quantity;

    for (const slot of player.inventory) {
      if (slot.id !== itemID || remaining <= 0) {
        continue;
      }

      const removed = Math.min(slot.quantity, remaining);
      slot.quantity -= removed;
      remaining -= removed;

      if (slot.quantity <= 0) {
        slot.id = "empty";
        slot.type = "0";
        slot.sub_type = "0";
        slot.quantity = 0;
      }
    }

    return remaining === 0;
  }

  private addInventoryItem(
    player: PlayerState,
    itemID: string,
    quantity: number,
  ): boolean {
    const definition = getItemDefinition(itemID);

    if (!definition) {
      return false;
    }

    let remaining = quantity;

    for (const slot of player.inventory) {
      if (slot.id !== itemID || slot.quantity >= definition.maxStack) {
        continue;
      }

      const added = Math.min(definition.maxStack - slot.quantity, remaining);
      slot.quantity += added;
      remaining -= added;

      if (remaining === 0) {
        return true;
      }
    }

    for (const slot of player.inventory) {
      if (slot.id !== "empty" && slot.id !== "0" && slot.id !== "") {
        continue;
      }

      const added = Math.min(definition.maxStack, remaining);
      slot.id = itemID;
      slot.type = definition.type;
      slot.sub_type = definition.subType;
      slot.quantity = added;
      remaining -= added;

      if (remaining === 0) {
        return true;
      }
    }

    return false;
  }

  private createInventoryTotals(
    inventory: InventorySlotData[],
  ): Map<string, number> {
    const totals = new Map<string, number>();

    for (const slot of inventory) {
      if (slot.id === "empty" || slot.quantity <= 0) {
        continue;
      }

      totals.set(slot.id, (totals.get(slot.id) ?? 0) + slot.quantity);
    }

    return totals;
  }

  private inventoryTotalsMatch(
    first: InventorySlotData[],
    second: InventorySlotData[],
  ): boolean {
    const firstTotals = this.createInventoryTotals(first);
    const secondTotals = this.createInventoryTotals(second);

    if (firstTotals.size !== secondTotals.size) {
      return false;
    }

    for (const [itemID, quantity] of firstTotals) {
      if (secondTotals.get(itemID) !== quantity) {
        return false;
      }
    }

    return true;
  }

  private async handleSetInventoryOrderRequest(
    client: Client,
    message?: SetInventoryOrderMessage,
  ) {
    const player = this.state.players.get(client.sessionId);
    const messageData = readObject(message);
    const requestId = readSafeStringFromAliases(
      [messageData.requestId, messageData.RequestID],
      MAX_ITEM_REQUEST_ID_LENGTH,
    );

    if (!player || !requestId) {
      client.send("set_inventory_order_result", {
        code: "INVALID_REQUEST",
        ok: false,
        requestId,
      });
      return;
    }

    if (this.playerInventoryOperations.has(client.sessionId)) {
      client.send("set_inventory_order_result", {
        code: "INVENTORY_BUSY",
        inventory: this.readPlayerInventory(player),
        ok: false,
        requestId,
      });
      return;
    }

    const requestedInventory = readInventoryData(
      messageData.inventory ?? messageData.Inventory,
    );
    const currentInventory = this.readPlayerInventory(player);

    if (
      requestedInventory.length !== currentInventory.length ||
      !this.inventoryTotalsMatch(currentInventory, requestedInventory)
    ) {
      client.send("set_inventory_order_result", {
        code: "INVENTORY_CONTENT_MISMATCH",
        inventory: currentInventory,
        ok: false,
        requestId,
      });
      return;
    }

    for (const slot of requestedInventory) {
      if (slot.id === "empty") {
        continue;
      }

      const definition = getItemDefinition(slot.id);

      if (!definition || slot.quantity > definition.maxStack) {
        client.send("set_inventory_order_result", {
          code: "INVALID_INVENTORY_SLOT",
          inventory: currentInventory,
          ok: false,
          requestId,
        });
        return;
      }

      slot.type = definition.type;
      slot.sub_type = definition.subType;
    }

    this.playerInventoryOperations.add(client.sessionId);
    this.restorePlayerInventory(player, requestedInventory);

    try {
      await this.persistPlayerInventory(client, player);
    } catch (error) {
      this.restorePlayerInventory(player, currentInventory);
      this.playerInventoryOperations.delete(client.sessionId);

      client.send("set_inventory_order_result", {
        code: "INVENTORY_SAVE_FAILED",
        inventory: currentInventory,
        ok: false,
        requestId,
      });

      console.error("[Grandoria] Inventory order save failed:", error);
      return;
    }

    this.playerInventoryOperations.delete(client.sessionId);

    client.send("set_inventory_order_result", {
      code: "INVENTORY_ORDER_UPDATED",
      inventory: this.readPlayerInventory(player),
      ok: true,
      requestId,
    });

    console.log(`[Grandoria] Inventory order persisted: ${client.sessionId}`, {
      requestId,
    });
  }

  private async handleSetMaxHealthRequest(
    client: Client,
    message?: SetMaxHealthMessage,
  ) {
    const player = this.state.players.get(client.sessionId);
    const identity = this.playerIdentities.get(client.sessionId);
    const messageData = readObject(message);
    const requestId = readSafeStringFromAliases(
      [messageData.requestId, messageData.RequestID],
      MAX_ITEM_REQUEST_ID_LENGTH,
    );
    const requestedMaxHealth = Math.trunc(
      readFiniteNumberFromAliases(
        [messageData.maxHealth, messageData.MaxHP],
        Number.NaN,
      ),
    );

    if (
      !player ||
      !identity ||
      !requestId ||
      !Number.isFinite(requestedMaxHealth) ||
      requestedMaxHealth < 1 ||
      requestedMaxHealth > 1_000_000
    ) {
      client.send("set_max_health_result", {
        code: "INVALID_MAX_HEALTH",
        ok: false,
        requestId,
      });
      return;
    }

    if (requestedMaxHealth === player.maxHealth) {
      client.send("set_max_health_result", {
        code: "NO_CHANGE",
        currentHealth: player.currentHealth,
        maxHealth: player.maxHealth,
        ok: true,
        requestId,
      });
      return;
    }

    const previousMaxHealth = player.maxHealth;
    const previousCurrentHealth = player.currentHealth;
    player.maxHealth = requestedMaxHealth;
    player.currentHealth = Math.min(player.currentHealth, player.maxHealth);
    player.isAlive = player.currentHealth > 0;

    try {
      await firebaseAdminFirestore
        .collection("users")
        .doc(identity.playerUid)
        .collection("characters")
        .doc(identity.characterId)
        .update({
          "Resources.MaxHP": player.maxHealth,
          "Resources.CurrentHP": player.currentHealth,
        });
    } catch (error) {
      player.maxHealth = previousMaxHealth;
      player.currentHealth = previousCurrentHealth;
      player.isAlive = player.currentHealth > 0;

      client.send("set_max_health_result", {
        code: "MAX_HEALTH_SAVE_FAILED",
        currentHealth: player.currentHealth,
        maxHealth: player.maxHealth,
        ok: false,
        requestId,
      });

      console.error("[Grandoria] Max health save failed:", error);
      return;
    }

    client.send("set_max_health_result", {
      code: "MAX_HEALTH_UPDATED",
      currentHealth: player.currentHealth,
      maxHealth: player.maxHealth,
      ok: true,
      requestId,
    });

    console.log(`[Grandoria] Max health updated: ${client.sessionId}`, {
      currentHealth: player.currentHealth,
      maxHealth: player.maxHealth,
      requestId,
    });
  }

  private async handleDropItemRequest(
    client: Client,
    message?: DropItemMessage,
  ) {
    const messageData = readObject(message);
    const requestId = readSafeStringFromAliases(
      [messageData.requestId, messageData.RequestID],
      MAX_ITEM_REQUEST_ID_LENGTH,
    );
    const itemID = readSafeStringFromAliases(
      [messageData.itemID, messageData.itemId],
      128,
    );
    const quantity = readPositiveInteger(messageData.quantity);
    const player = this.state.players.get(client.sessionId);
    const definition = getItemDefinition(itemID);

    if (!requestId) {
      client.send("drop_item_result", {
        code: "INVALID_REQUEST_ID",
        ok: false,
        requestId: "",
      });
      return;
    }

    const previousResult = this.completedDropRequests
      .get(client.sessionId)
      ?.get(requestId);

    if (previousResult) {
      client.send("drop_item_result", previousResult);
      return;
    }

    if (!player || !player.isAlive || player.currentHealth <= 0) {
      client.send("drop_item_result", {
        code: "PLAYER_UNAVAILABLE",
        ok: false,
        requestId,
      });
      return;
    }

    if (!definition) {
      client.send("drop_item_result", {
        code: "UNKNOWN_ITEM",
        ok: false,
        requestId,
      });
      return;
    }

    if (!quantity || quantity > definition.maxStack) {
      client.send("drop_item_result", {
        code: "INVALID_QUANTITY",
        maxStack: definition.maxStack,
        ok: false,
        requestId,
      });
      return;
    }

    if (this.playerInventoryOperations.has(client.sessionId)) {
      client.send("drop_item_result", {
        code: "INVENTORY_BUSY",
        ok: false,
        requestId,
      });
      return;
    }

    this.playerInventoryOperations.add(client.sessionId);
    const inventoryBefore = this.readPlayerInventory(player);

    if (!this.removeInventoryItem(player, itemID, quantity)) {
      this.playerInventoryOperations.delete(client.sessionId);
      client.send("drop_item_result", {
        code: "INSUFFICIENT_INVENTORY",
        ok: false,
        requestId,
      });
      return;
    }

    const identity = this.playerIdentities.get(client.sessionId);
    const createdBy = identity?.playerUid || client.sessionId;
    const sharedItemIDs: string[] = [];

    for (let itemIndex = 0; itemIndex < quantity; itemIndex += 1) {
      const position = this.findInventoryDropPosition(player);
      const sharedItemID = this.createWorldItem({
        createdBy,
        itemID,
        mapId: player.mapId,
        source: "inventory_drop",
        x: position.x,
        y: position.y,
      });

      if (sharedItemID) {
        sharedItemIDs.push(sharedItemID);
      }
    }

    if (sharedItemIDs.length !== quantity) {
      for (const sharedItemID of sharedItemIDs) {
        this.state.items.delete(sharedItemID);
      }

      this.restorePlayerInventory(player, inventoryBefore);
      this.playerInventoryOperations.delete(client.sessionId);

      client.send("drop_item_result", {
        code: "DROP_CREATION_FAILED",
        ok: false,
        requestId,
      });
      return;
    }

    try {
      await this.persistPlayerInventory(client, player);
    } catch (error) {
      for (const sharedItemID of sharedItemIDs) {
        this.state.items.delete(sharedItemID);
      }

      this.restorePlayerInventory(player, inventoryBefore);
      this.playerInventoryOperations.delete(client.sessionId);

      client.send("drop_item_result", {
        code: "INVENTORY_SAVE_FAILED",
        ok: false,
        requestId,
      });

      console.error("[Grandoria] Inventory drop save failed:", error);
      return;
    }

    this.playerInventoryOperations.delete(client.sessionId);

    const result: Record<string, unknown> = {
      code: "DROP_CREATED",
      itemID,
      ok: true,
      quantity,
      requestId,
      sharedItemIDs,
      subType: definition.subType,
      type: definition.type,
    };
    let sessionRequests = this.completedDropRequests.get(client.sessionId);

    if (!sessionRequests) {
      sessionRequests = new Map();
      this.completedDropRequests.set(client.sessionId, sessionRequests);
    }

    sessionRequests.set(requestId, result);

    while (sessionRequests.size > 64) {
      const oldestRequestId = sessionRequests.keys().next().value;

      if (typeof oldestRequestId !== "string") {
        break;
      }

      sessionRequests.delete(oldestRequestId);
    }

    client.send("drop_item_result", result);

    console.log("[Grandoria] Inventory drop created:", {
      itemID,
      quantity,
      requestId,
      sessionId: client.sessionId,
      sharedItemIDs,
      inventoryPersisted: true,
    });
  }

  private async handleCollectItemRequest(
    client: Client,
    message?: CollectItemMessage,
  ) {
    const messageData = readObject(message);
    const requestId = readSafeStringFromAliases(
      [messageData.requestId, messageData.RequestID],
      MAX_ITEM_REQUEST_ID_LENGTH,
    );
    const sharedItemID = readSafeStringFromAliases(
      [
        messageData.sharedItemID,
        messageData.sharedItemId,
        messageData.itemID,
        messageData.itemId,
      ],
      192,
    );
    const player = this.state.players.get(client.sessionId);

    if (!requestId || !sharedItemID) {
      client.send("collect_item_result", {
        code: "INVALID_REQUEST",
        ok: false,
        requestId,
        sharedItemID,
      });
      return;
    }

    if (!player || !player.isAlive || player.currentHealth <= 0) {
      client.send("collect_item_result", {
        code: "PLAYER_UNAVAILABLE",
        ok: false,
        requestId,
        sharedItemID,
      });
      return;
    }

    const item = this.state.items.get(sharedItemID);

    if (!item) {
      client.send("collect_item_result", {
        code: "ITEM_NOT_FOUND",
        ok: false,
        requestId,
        sharedItemID,
      });
      return;
    }

    if (item.mapId !== player.mapId) {
      client.send("collect_item_result", {
        code: "DIFFERENT_MAP",
        ok: false,
        requestId,
        sharedItemID,
      });
      return;
    }

    const distance = Math.hypot(item.x - player.x, item.y - player.y);

    if (distance > ITEM_COLLECTION_DISTANCE) {
      client.send("collect_item_result", {
        code: "OUT_OF_RANGE",
        distance,
        maxDistance: ITEM_COLLECTION_DISTANCE,
        ok: false,
        requestId,
        sharedItemID,
      });
      return;
    }

    if (this.playerInventoryOperations.has(client.sessionId)) {
      client.send("collect_item_result", {
        code: "INVENTORY_BUSY",
        ok: false,
        requestId,
        sharedItemID,
      });
      return;
    }

    this.playerInventoryOperations.add(client.sessionId);
    const inventoryBefore = this.readPlayerInventory(player);

    if (!this.addInventoryItem(player, item.itemID, item.quantity)) {
      this.restorePlayerInventory(player, inventoryBefore);
      this.playerInventoryOperations.delete(client.sessionId);

      client.send("collect_item_result", {
        code: "INVENTORY_FULL",
        ok: false,
        requestId,
        sharedItemID,
      });
      return;
    }

    try {
      await this.persistPlayerInventory(client, player);
    } catch (error) {
      this.restorePlayerInventory(player, inventoryBefore);
      this.playerInventoryOperations.delete(client.sessionId);

      client.send("collect_item_result", {
        code: "INVENTORY_SAVE_FAILED",
        ok: false,
        requestId,
        sharedItemID,
      });

      console.error("[Grandoria] Shared item collect save failed:", error);
      return;
    }

    this.playerInventoryOperations.delete(client.sessionId);

    const result = {
      code: "ITEM_COLLECTED",
      itemID: item.itemID,
      ok: true,
      quantity: item.quantity,
      requestId,
      sharedItemID,
      subType: item.subType,
      type: item.type,
    };

    this.state.items.delete(sharedItemID);

    client.send("collect_item_result", result);

    console.log("[Grandoria] Shared item collected:", {
      itemID: item.itemID,
      requestId,
      sessionId: client.sessionId,
      sharedItemID,
      inventoryPersisted: true,
    });
  }

  private rollMonsterDropQuantity(
    minQuantity: number,
    maxQuantity: number,
  ): number {
    if (maxQuantity <= minQuantity) {
      return minQuantity;
    }

    const range = maxQuantity - minQuantity + 1;
    const offset = Math.min(
      range - 1,
      Math.floor(clampUnitInterval(this.worldItemRandom()) * range),
    );

    return minQuantity + offset;
  }

  private selectMonsterDrop(
    definition: MonsterDropDefinition,
  ): SelectedMonsterDrop | null {
    const dropRoll =
      Math.min(99, Math.floor(clampUnitInterval(this.worldItemRandom()) * 100)) +
      1;

    if (dropRoll > definition.chancePercent) {
      return null;
    }

    const validRarities = definition.rarities
      .map((rarity) => ({
        items: rarity.items.filter(
          (item) =>
            !item.guaranteed &&
            item.weight > 0 &&
            Boolean(getItemDefinition(item.itemID)),
        ),
        name: rarity.name,
        weight: Math.max(0, rarity.weight),
      }))
      .filter((rarity) => rarity.weight > 0 && rarity.items.length > 0);
    const totalRarityWeight = validRarities.reduce(
      (total, rarity) => total + rarity.weight,
      0,
    );

    if (totalRarityWeight <= 0) {
      return null;
    }

    const rarityRoll =
      clampUnitInterval(this.worldItemRandom()) * totalRarityWeight;
    let accumulatedRarityWeight = 0;
    let selectedRarity = validRarities[validRarities.length - 1];

    for (const rarity of validRarities) {
      accumulatedRarityWeight += rarity.weight;

      if (rarityRoll < accumulatedRarityWeight) {
        selectedRarity = rarity;
        break;
      }
    }

    const totalItemWeight = selectedRarity.items.reduce(
      (total, item) => total + item.weight,
      0,
    );

    if (totalItemWeight <= 0) {
      return null;
    }

    const itemRoll =
      clampUnitInterval(this.worldItemRandom()) * totalItemWeight;
    let accumulatedItemWeight = 0;
    let selectedItem =
      selectedRarity.items[selectedRarity.items.length - 1];

    for (const item of selectedRarity.items) {
      accumulatedItemWeight += item.weight;

      if (itemRoll < accumulatedItemWeight) {
        selectedItem = item;
        break;
      }
    }

    return {
      itemID: selectedItem.itemID,
      quantity: this.rollMonsterDropQuantity(
        selectedItem.minQuantity,
        selectedItem.maxQuantity,
      ),
      rarity: selectedRarity.name,
    };
  }

  private isMonsterDropPositionAvailable(
    mapId: string,
    x: number,
    y: number,
  ): boolean {
    let available = true;

    this.state.items.forEach((item) => {
      if (!available || item.mapId !== mapId) {
        return;
      }

      if (Math.hypot(item.x - x, item.y - y) < MONSTER_DROP_SPACING) {
        available = false;
      }
    });

    return available;
  }

  private findMonsterDropPosition(monster: MonsterState): {
    x: number;
    y: number;
  } {
    const originX = Math.round(monster.x);
    const originY = Math.round(monster.y);

    /*
     * Monster drops are scattered randomly around the death position.
     * The server remains authoritative: every candidate is checked against
     * world collision and against other world items before being accepted.
     */
    for (
      let attempt = 0;
      attempt < MONSTER_DROP_POSITION_ATTEMPTS;
      attempt += 1
    ) {
      const angle =
        clampUnitInterval(this.worldItemRandom()) * Math.PI * 2;
      const radiusRandom =
        clampUnitInterval(this.worldItemRandom());
      const radius = Math.sqrt(
        MONSTER_DROP_MIN_RADIUS * MONSTER_DROP_MIN_RADIUS +
          radiusRandom *
            (MONSTER_DROP_MAX_RADIUS * MONSTER_DROP_MAX_RADIUS -
              MONSTER_DROP_MIN_RADIUS * MONSTER_DROP_MIN_RADIUS),
      );
      const candidateX = Math.round(
        originX + Math.cos(angle) * radius,
      );
      const candidateY = Math.round(
        originY + Math.sin(angle) * radius,
      );
      const resolved = resolvePlayerSpawn(
        monster.mapId,
        candidateX,
        candidateY,
      );

      if (resolved.recovered) {
        continue;
      }

      if (
        !this.isMonsterDropPositionAvailable(
          monster.mapId,
          candidateX,
          candidateY,
        )
      ) {
        continue;
      }

      return {
        x: candidateX,
        y: candidateY,
      };
    }

    /*
     * Defensive fallback for crowded or highly obstructed areas.
     * Candidate ring positions are shuffled, so even the fallback does not
     * always place items in the same deterministic order.
     */
    const fallbackCandidates: Array<{ x: number; y: number }> = [];

    for (let ring = 1; ring <= MONSTER_DROP_FALLBACK_MAX_RING; ring += 1) {
      for (let gridY = -ring; gridY <= ring; gridY += 1) {
        for (let gridX = -ring; gridX <= ring; gridX += 1) {
          if (
            Math.abs(gridX) !== ring &&
            Math.abs(gridY) !== ring
          ) {
            continue;
          }

          fallbackCandidates.push({
            x: originX + gridX * MONSTER_DROP_SPACING,
            y: originY + gridY * MONSTER_DROP_SPACING,
          });
        }
      }
    }

    for (
      let index = fallbackCandidates.length - 1;
      index > 0;
      index -= 1
    ) {
      const swapIndex = Math.min(
        index,
        Math.floor(
          clampUnitInterval(this.worldItemRandom()) * (index + 1),
        ),
      );
      const temporary = fallbackCandidates[index];
      fallbackCandidates[index] = fallbackCandidates[swapIndex];
      fallbackCandidates[swapIndex] = temporary;
    }

    for (const candidate of fallbackCandidates) {
      const resolved = resolvePlayerSpawn(
        monster.mapId,
        candidate.x,
        candidate.y,
      );

      if (resolved.recovered) {
        continue;
      }

      if (
        !this.isMonsterDropPositionAvailable(
          monster.mapId,
          candidate.x,
          candidate.y,
        )
      ) {
        continue;
      }

      return candidate;
    }

    /*
     * Extremely defensive last resort. This should only be reached if the
     * nearby area is completely unavailable.
     */
    for (
      let step = MONSTER_DROP_FALLBACK_MAX_RING + 1;
      step <= 64;
      step += 1
    ) {
      const candidateX = originX + step * MONSTER_DROP_SPACING;
      const resolved = resolvePlayerSpawn(
        monster.mapId,
        candidateX,
        originY,
      );

      if (
        !resolved.recovered &&
        this.isMonsterDropPositionAvailable(
          monster.mapId,
          candidateX,
          originY,
        )
      ) {
        return {
          x: candidateX,
          y: originY,
        };
      }
    }

    return {
      x: originX,
      y: originY,
    };
  }

  private createMonsterDropWorldItem(
    selectedDrop: SelectedMonsterDrop,
    monsterId: string,
    monster: MonsterState,
    killerSessionId: string,
  ): string | null {
    const identity = this.playerIdentities.get(killerSessionId);
    const position = this.findMonsterDropPosition(monster);

    return this.createWorldItem({
      createdBy: identity?.playerUid || killerSessionId,
      itemID: selectedDrop.itemID,
      mapId: monster.mapId,
      monsterId,
      monsterType: monster.monsterType,
      quantity: selectedDrop.quantity,
      rarity: selectedDrop.rarity,
      source: "mob_drop",
      x: position.x,
      y: position.y,
    });
  }

  private spawnMonsterDrop(
    monsterId: string,
    monster: MonsterState,
    killerSessionId: string,
  ) {
    const definition = getMonsterDefinition(monster.monsterType)?.drops;

    if (!definition) {
      return;
    }

    const selectedDrops: SelectedMonsterDrop[] = [];

    for (const rarity of definition.rarities) {
      for (const item of rarity.items) {
        if (!item.guaranteed || !getItemDefinition(item.itemID)) {
          continue;
        }

        selectedDrops.push({
          itemID: item.itemID,
          quantity: this.rollMonsterDropQuantity(
            item.minQuantity,
            item.maxQuantity,
          ),
          rarity: rarity.name,
        });
      }
    }

    for (let rollIndex = 0; rollIndex < definition.rolls; rollIndex += 1) {
      const selectedDrop = this.selectMonsterDrop(definition);

      if (selectedDrop) {
        selectedDrops.push(selectedDrop);
      }
    }

    for (const selectedDrop of selectedDrops) {
      const sharedItemID = this.createMonsterDropWorldItem(
        selectedDrop,
        monsterId,
        monster,
        killerSessionId,
      );

      if (!sharedItemID) {
        continue;
      }

      console.log("[Grandoria] Monster drop created:", {
        itemID: selectedDrop.itemID,
        monsterId,
        monsterType: monster.monsterType,
        quantity: selectedDrop.quantity,
        rarity: selectedDrop.rarity,
        sharedItemID,
      });
    }
  }

  private awardMonsterExperience(
    killerSessionId: string,
    monsterId: string,
    monsterType: string,
    amount: number,
  ) {
    const safeAmount = Math.max(0, Math.trunc(amount));

    if (safeAmount === 0) {
      return;
    }

    const killerClient = this.clients.find(
      (client) => client.sessionId === killerSessionId,
    );

    if (!killerClient) {
      console.warn("[Grandoria] XP reward skipped: killer disconnected.", {
        killerSessionId,
        monsterId,
        monsterType,
      });
      return;
    }

    killerClient.send("xp_awarded", {
      amount: safeAmount,
      monsterId,
      monsterType,
    });

    console.log("[Grandoria] Monster XP awarded:", {
      amount: safeAmount,
      killerSessionId,
      monsterId,
      monsterType,
    });
  }

  private fixedTick(deltaTime: number) {
    this.updatePlayerLifecycle(deltaTime);

    this.updateMonsterLifecycle(deltaTime);

    this.updateMonsterHurtAnimations(deltaTime);

    this.updateMonsterAttackCooldowns(deltaTime);

    this.updateMonsterBehavior(deltaTime);

    const distance = PLAYER_SPEED * (deltaTime / 1000);

    this.state.players.forEach((player, sessionId) => {
      if (!player.isAlive || player.currentHealth <= 0) {
        this.playerInputs.set(sessionId, createIdleInput());
        this.playerCollisionBlocks.delete(sessionId);
        this.playerAttackRemaining.delete(sessionId);
        this.playerAttackTargets.delete(sessionId);
        player.animation = "death";
        return;
      }

      const attackRemaining = this.playerAttackRemaining.get(sessionId);

      /*
       * During an attack, the server keeps
       * the player still and preserves direction.
       */
      if (attackRemaining !== undefined) {
        this.playerCollisionBlocks.delete(sessionId);

        const nextAttackRemaining = attackRemaining - deltaTime;

        if (
          attackRemaining > ATTACK_HIT_REMAINING_MS &&
          nextAttackRemaining <= ATTACK_HIT_REMAINING_MS
        ) {
          const monsterId = this.playerAttackTargets.get(sessionId);

          this.playerAttackTargets.delete(sessionId);

          if (monsterId) {
            this.applyPlayerAttackToMonster(sessionId, player, monsterId);
          }
        }

        if (nextAttackRemaining > 0) {
          this.playerAttackRemaining.set(sessionId, nextAttackRemaining);

          player.animation = "attack";
        } else {
          this.playerAttackRemaining.delete(sessionId);

          this.playerAttackTargets.delete(sessionId);

          player.animation = "idle";
        }

        return;
      }

      const input = this.playerInputs.get(sessionId);

      if (!input) {
        this.playerCollisionBlocks.delete(sessionId);

        player.animation = "idle";
        return;
      }

      let moveX = Number(input.right) - Number(input.left);

      let moveY = Number(input.down) - Number(input.up);

      if (moveX === 0 && moveY === 0) {
        this.playerCollisionBlocks.delete(sessionId);

        player.animation = "idle";
        return;
      }

      if (moveX !== 0 && moveY !== 0) {
        moveX *= Math.SQRT1_2;
        moveY *= Math.SQRT1_2;
      }

      const movement = resolvePlayerMovement(
        player.mapId,
        player.x,
        player.y,
        moveX * distance,
        moveY * distance,
      );

      const moved = movement.x !== player.x || movement.y !== player.y;
      const blocked = movement.blockedX || movement.blockedY;

      player.x = movement.x;

      player.y = movement.y;

      player.animation = moved ? "walk" : "idle";

      if (blocked && !this.playerCollisionBlocks.has(sessionId)) {
        this.playerCollisionBlocks.add(sessionId);

        console.log("[Grandoria] Movement blocked by world collision:", {
          sessionId,
          mapId: player.mapId,
          blockedX: movement.blockedX,
          blockedY: movement.blockedY,
          position: {
            x: player.x,
            y: player.y,
          },
        });
      } else if (!blocked) {
        this.playerCollisionBlocks.delete(sessionId);
      }

      if (moveX < 0) {
        player.direction = "left";
      } else if (moveX > 0) {
        player.direction = "right";
      } else if (moveY < 0) {
        player.direction = "up";
      } else if (moveY > 0) {
        player.direction = "down";
      }
    });
  }

  private updatePlayerLifecycle(deltaTime: number) {
    this.playerRespawnRemaining.forEach((remaining, sessionId) => {
      const player = this.state.players.get(sessionId);

      if (!player) {
        this.playerRespawnRemaining.delete(sessionId);
        return;
      }

      if (player.isAlive && player.currentHealth > 0) {
        this.playerRespawnRemaining.delete(sessionId);
        return;
      }

      const nextRemaining = remaining - deltaTime;

      if (nextRemaining > TIMER_EPSILON_MS) {
        this.playerRespawnRemaining.set(sessionId, nextRemaining);
        player.animation = "death";
        return;
      }

      const identity = this.playerIdentities.get(sessionId);

      if (!identity) {
        this.playerRespawnRemaining.delete(sessionId);
        return;
      }

      const requestedSpawn =
        PLAYER_RESPAWN_POINTS[
          Math.floor(Math.random() * PLAYER_RESPAWN_POINTS.length)
        ] ?? PLAYER_RESPAWN_POINTS[0];

      const spawn = resolvePlayerSpawn(
        requestedSpawn.mapId,
        requestedSpawn.x,
        requestedSpawn.y,
      );

      identity.mapId = requestedSpawn.mapId;
      player.mapId = requestedSpawn.mapId;
      player.x = spawn.x;
      player.y = spawn.y;
      player.direction = "down";
      player.currentHealth = Math.max(
        1,
        Math.floor(player.maxHealth * PLAYER_RESPAWN_HEALTH_RATIO),
      );
      player.isAlive = true;
      player.animation = "idle";

      this.playerInputs.set(sessionId, createIdleInput());
      this.playerCollisionBlocks.delete(sessionId);
      this.playerAttackRemaining.delete(sessionId);
      this.playerAttackTargets.delete(sessionId);
      this.playerRespawnRemaining.delete(sessionId);

      console.log(`[Grandoria] Player ${sessionId} respawned.`, {
        mapId: player.mapId,
        position: {
          x: player.x,
          y: player.y,
        },
        health: `${player.currentHealth}/${player.maxHealth}`,
      });
    });
  }

  private initializeMonsterSpawnRegions() {
    const regions = getMonsterSpawnRegions("MAP_1");

    for (const region of regions) {
      if (!region.enabled || region.maxAlive <= 0) {
        console.log("[Grandoria] Spawn region disabled or empty:", {
          regionId: region.id,
          enabled: region.enabled,
          maxAlive: region.maxAlive,
        });
        continue;
      }

      const definition = getMonsterDefinition(region.mobType);

      if (!definition) {
        console.error("[Grandoria] Spawn region references unknown monster type:", {
          regionId: region.id,
          mobType: region.mobType,
        });
        continue;
      }

      for (let slotIndex = 0; slotIndex < region.maxAlive; slotIndex += 1) {
        const monsterId = `${region.id}__${String(slotIndex + 1).padStart(3, "0")}`;

        this.monsterRegionsByMonsterId.set(monsterId, region);

        if (!this.spawnMonsterFromRegion(monsterId, "initial")) {
          this.monsterRespawnRemaining.set(
            monsterId,
            MONSTER_SPAWN_RETRY_DELAY_MS,
          );
        }
      }
    }
  }

  private spawnMonsterFromRegion(
    monsterId: string,
    reason: "initial" | "respawn",
  ): boolean {
    const region = this.monsterRegionsByMonsterId.get(monsterId);

    if (!region || !region.enabled) {
      return false;
    }

    const definition = getMonsterDefinition(region.mobType);

    if (!definition) {
      console.error("[Grandoria] Monster spawn failed: unknown monster type.", {
        monsterId,
        regionId: region.id,
        mobType: region.mobType,
      });
      return false;
    }

    const point = findMonsterSpawnPoint(
      region.mapId,
      definition.bodyProfileId,
      region,
      this.monsterRandom,
    );

    if (!point) {
      console.error("[Grandoria] Monster spawn failed: no valid point in region.", {
        monsterId,
        regionId: region.id,
        mobType: region.mobType,
        bounds: region.bounds,
        spawnPadding: region.spawnPadding,
      });
      return false;
    }

    const spawn: MonsterSpawn = {
      monsterId,
      monsterType: region.mobType as MonsterType,
      mapId: region.mapId,
      regionId: region.id,
      x: point.x,
      y: point.y,
      direction: "down",
    };

    this.monsterSpawnsById.set(monsterId, spawn);
    this.spawnMonster(spawn, reason);

    return this.state.monsters.has(monsterId);
  }

  private spawnMonster(spawn: MonsterSpawn, reason: "initial" | "respawn") {
    if (this.state.monsters.has(spawn.monsterId)) {
      return;
    }

    const definition = getMonsterDefinition(spawn.monsterType);

    if (!definition) {
      console.error("[Grandoria] Monster spawn failed: unknown monster type.", {
        monsterId: spawn.monsterId,
        monsterType: spawn.monsterType,
      });
      return;
    }

    const monster = new MonsterState();

    monster.monsterType = spawn.monsterType;
    monster.mapId = spawn.mapId;
    monster.x = spawn.x;
    monster.y = spawn.y;
    monster.direction = spawn.direction;
    monster.animation = "idle";
    monster.currentHealth = definition.maxHealth;
    monster.maxHealth = definition.maxHealth;
    monster.isAlive = true;
    monster.hitboxMinX = definition.hitboxOffsets.minX;
    monster.hitboxMaxX = definition.hitboxOffsets.maxX;
    monster.hitboxMinY = definition.hitboxOffsets.minY;
    monster.hitboxMaxY = definition.hitboxOffsets.maxY;

    this.monsterPatrolStates.delete(spawn.monsterId);

    this.monsterReactionStates.delete(spawn.monsterId);

    this.monsterAttackStates.delete(spawn.monsterId);

    this.monsterAttackCooldownRemaining.delete(spawn.monsterId);

    if (reason === "respawn") {
      this.monstersPendingRespawnIdleTick.add(spawn.monsterId);
    }

    this.state.monsters.set(spawn.monsterId, monster);

    console.log(`[Grandoria] Monster ${reason}:`, {
      monsterId: spawn.monsterId,
      monsterType: spawn.monsterType,
      mapId: spawn.mapId,
      regionId: spawn.regionId,
      position: {
        x: spawn.x,
        y: spawn.y,
      },
      health: `${monster.currentHealth}/${monster.maxHealth}`,
    });
  }

  private updateMonsterLifecycle(deltaTime: number) {
    this.monsterDeathRemaining.forEach((remaining, monsterId) => {
      const monster = this.state.monsters.get(monsterId);

      if (!monster || monster.isAlive || monster.currentHealth > 0) {
        this.monsterDeathRemaining.delete(monsterId);

        return;
      }

      const nextRemaining = remaining - deltaTime;

      if (nextRemaining > 0) {
        this.monsterDeathRemaining.set(monsterId, nextRemaining);

        monster.animation = "death";
        return;
      }

      this.monsterDeathRemaining.delete(monsterId);

      this.monsterPatrolStates.delete(monsterId);

      this.monsterReactionStates.delete(monsterId);

      this.monsterAttackStates.delete(monsterId);

      this.monsterAttackCooldownRemaining.delete(monsterId);

      this.monstersPendingRespawnIdleTick.delete(monsterId);

      this.state.monsters.delete(monsterId);

      const region = this.monsterRegionsByMonsterId.get(monsterId);

      if (!region) {
        console.error(
          "[Grandoria] Monster removed without a registered spawn region:",
          { monsterId },
        );

        return;
      }

      const respawnDelayMs = Math.max(0, region.respawnSeconds * 1000);

      this.monsterRespawnRemaining.set(monsterId, respawnDelayMs);

      console.log("[Grandoria] Monster removed after death animation:", {
        monsterId,
        regionId: region.id,
        respawnDelayMs,
      });
    });

    this.monsterRespawnRemaining.forEach((remaining, monsterId) => {
      if (this.state.monsters.has(monsterId)) {
        this.monsterRespawnRemaining.delete(monsterId);

        return;
      }

      const nextRemaining = remaining - deltaTime;

      if (nextRemaining > 0) {
        this.monsterRespawnRemaining.set(monsterId, nextRemaining);

        return;
      }

      this.monsterRespawnRemaining.delete(monsterId);

      const region = this.monsterRegionsByMonsterId.get(monsterId);

      if (!region || !region.enabled) {
        console.warn(
          "[Grandoria] Respawn skipped: spawn region is missing or disabled.",
          { monsterId, regionId: region?.id ?? "" },
        );

        return;
      }

      if (!this.spawnMonsterFromRegion(monsterId, "respawn")) {
        this.monsterRespawnRemaining.set(
          monsterId,
          MONSTER_SPAWN_RETRY_DELAY_MS,
        );
      }
    });
  }

  private updateMonsterHurtAnimations(deltaTime: number) {
    this.monsterHurtRemaining.forEach((remaining, monsterId) => {
      const monster = this.state.monsters.get(monsterId);

      if (!monster || !monster.isAlive) {
        this.monsterHurtRemaining.delete(monsterId);

        return;
      }

      const nextRemaining = remaining - deltaTime;

      if (nextRemaining > 0) {
        this.monsterHurtRemaining.set(monsterId, nextRemaining);

        monster.animation = "hurt";
        return;
      }

      this.monsterHurtRemaining.delete(monsterId);

      monster.animation = "idle";
    });
  }

  private updateMonsterAttackCooldowns(deltaTime: number) {
    this.monsterAttackCooldownRemaining.forEach((remaining, monsterId) => {
      const nextRemaining = remaining - deltaTime;

      if (nextRemaining > TIMER_EPSILON_MS) {
        this.monsterAttackCooldownRemaining.set(monsterId, nextRemaining);
        return;
      }

      this.monsterAttackCooldownRemaining.delete(monsterId);
    });
  }

  private startMonsterAttack(
    monsterId: string,
    monster: MonsterState,
    targetSessionId: string,
    target: PlayerState,
    attack: MonsterAttackDefinition,
  ) {
    this.faceMonsterTowardVector(
      monster,
      target.x - monster.x,
      target.y - monster.y,
    );

    this.monsterPatrolStates.delete(monsterId);

    this.monsterAttackStates.set(monsterId, {
      targetSessionId,
      remainingMs: attack.durationMs,
    });

    this.monsterAttackCooldownRemaining.set(monsterId, attack.intervalMs);

    monster.animation = "attack";

    console.log("[Grandoria] Monster attack started:", {
      monsterId,
      targetSessionId,
      distance: Math.hypot(target.x - monster.x, target.y - monster.y),
      range: attack.range,
    });
  }

  private updateMonsterAttack(
    monsterId: string,
    monster: MonsterState,
    attackState: MonsterAttackState,
    attack: MonsterAttackDefinition,
    deltaTime: number,
  ) {
    const target = this.state.players.get(attackState.targetSessionId);

    if (
      target &&
      target.isAlive &&
      target.currentHealth > 0 &&
      target.mapId === monster.mapId
    ) {
      this.faceMonsterTowardVector(
        monster,
        target.x - monster.x,
        target.y - monster.y,
      );
    }

    const nextRemaining = attackState.remainingMs - deltaTime;
    const hitRemaining = Math.max(0, attack.durationMs - attack.hitDelayMs);

    if (
      attackState.remainingMs > hitRemaining &&
      nextRemaining <= hitRemaining
    ) {
      this.applyMonsterAttackToPlayer(
        monsterId,
        monster,
        attackState.targetSessionId,
        attack,
      );
    }

    if (nextRemaining > TIMER_EPSILON_MS) {
      attackState.remainingMs = nextRemaining;
      monster.animation = "attack";
      return;
    }

    this.monsterAttackStates.delete(monsterId);
    monster.animation = "idle";
  }

  private applyMonsterAttackToPlayer(
    monsterId: string,
    monster: MonsterState,
    targetSessionId: string,
    attack: MonsterAttackDefinition,
  ) {
    const player = this.state.players.get(targetSessionId);

    if (
      !player ||
      !player.isAlive ||
      player.currentHealth <= 0 ||
      player.mapId !== monster.mapId
    ) {
      return;
    }

    const distance = Math.hypot(player.x - monster.x, player.y - monster.y);

    if (distance > attack.range) {
      return;
    }

    const previousHealth = player.currentHealth;

    player.currentHealth = Math.max(0, previousHealth - attack.damage);

    if (player.currentHealth === 0) {
      player.isAlive = false;
      player.animation = "death";

      this.playerInputs.set(targetSessionId, createIdleInput());
      this.playerCollisionBlocks.delete(targetSessionId);
      this.playerAttackRemaining.delete(targetSessionId);
      this.playerAttackTargets.delete(targetSessionId);
      this.playerRespawnRemaining.set(
        targetSessionId,
        PLAYER_RESPAWN_DELAY_MS,
      );
    }

    console.log(`[Grandoria] Player ${targetSessionId} took damage.`, {
      monsterId,
      monsterType: monster.monsterType,
      damage: attack.damage,
      previousHealth,
      currentHealth: player.currentHealth,
      isAlive: player.isAlive,
    });
  }

  private createMonsterPatrolState(
    monster: MonsterState,
  ): MonsterPatrolState {
    const durationRandom = clampUnitInterval(this.monsterRandom());

    const remainingMs =
      MONSTER_PATROL_MIN_DURATION_MS +
      durationRandom *
        (MONSTER_PATROL_MAX_DURATION_MS - MONSTER_PATROL_MIN_DURATION_MS);

    const shouldWalk =
      clampUnitInterval(this.monsterRandom()) < MONSTER_PATROL_WALK_CHANCE;

    if (!shouldWalk) {
      return {
        direction: null,
        remainingMs,
      };
    }

    const directionRandom = clampUnitInterval(this.monsterRandom());

    const directionIndex = Math.min(
      MONSTER_PATROL_DIRECTIONS.length - 1,
      Math.floor(directionRandom * MONSTER_PATROL_DIRECTIONS.length),
    );

    const direction = MONSTER_PATROL_DIRECTIONS[directionIndex];

    monster.direction = direction;

    return {
      direction,
      remainingMs,
    };
  }

  private findClosestMonsterTarget(
    monster: MonsterState,
    detectionRadius: number,
  ): MonsterTarget | undefined {
    let closestTarget: MonsterTarget | undefined;

    this.state.players.forEach((player, sessionId) => {
      if (
        !player.isAlive ||
        player.currentHealth <= 0 ||
        player.mapId !== monster.mapId
      ) {
        return;
      }

      const distance = Math.hypot(player.x - monster.x, player.y - monster.y);

      if (
        distance > detectionRadius ||
        (closestTarget && distance >= closestTarget.distance)
      ) {
        return;
      }

      closestTarget = {
        distance,
        sessionId,
      };
    });

    return closestTarget;
  }

  private hasPendingValidAttackOnMonster(
    monsterId: string,
    monster: MonsterState,
    definition: MonsterDefinition,
  ): boolean {
    let hasPendingAttack = false;

    this.playerAttackTargets.forEach((targetMonsterId, sessionId) => {
      if (
        hasPendingAttack ||
        targetMonsterId !== monsterId ||
        !this.playerAttackRemaining.has(sessionId)
      ) {
        return;
      }

      const player = this.state.players.get(sessionId);

      if (!player || player.mapId !== monster.mapId) {
        return;
      }

      const distance = Math.hypot(monster.x - player.x, monster.y - player.y);

      if (distance > MAX_PLAYER_ATTACK_DISTANCE) {
        return;
      }

      hasPendingAttack = hitboxesIntersect(
        getPlayerAttackHitbox(player),
        getMonsterHitbox(monster, definition),
      );
    });

    return hasPendingAttack;
  }

  private faceMonsterTowardVector(
    monster: MonsterState,
    vectorX: number,
    vectorY: number,
  ) {
    if (Math.abs(vectorX) >= Math.abs(vectorY) && vectorX !== 0) {
      monster.direction = vectorX < 0 ? "left" : "right";
    } else if (vectorY !== 0) {
      monster.direction = vectorY < 0 ? "up" : "down";
    }
  }

  private moveMonsterAlongVector(
    monster: MonsterState,
    definition: MonsterDefinition,
    vectorX: number,
    vectorY: number,
    maximumDistance: number,
    movementAnimation: "walk" | "run" = "walk",
  ) {
    const vectorLength = Math.hypot(vectorX, vectorY);

    this.faceMonsterTowardVector(monster, vectorX, vectorY);

    if (vectorLength <= 0 || maximumDistance <= 0) {
      monster.animation = "idle";
      return;
    }

    const deltaX = (vectorX / vectorLength) * maximumDistance;
    const deltaY = (vectorY / vectorLength) * maximumDistance;

    const movement = resolveMonsterMovement(
      monster.mapId,
      definition.bodyProfileId,
      monster.x,
      monster.y,
      deltaX,
      deltaY,
    );

    const moved = movement.x !== monster.x || movement.y !== monster.y;

    monster.x = movement.x;
    monster.y = movement.y;
    monster.animation = moved ? movementAnimation : "idle";
  }

  private updateMonsterReturn(
    monsterId: string,
    monster: MonsterState,
    spawn: MonsterSpawn,
    definition: MonsterDefinition,
    deltaTime: number,
  ) {
    const vectorX = spawn.x - monster.x;
    const vectorY = spawn.y - monster.y;
    const distanceFromSpawn = Math.hypot(vectorX, vectorY);

    if (distanceFromSpawn <= MONSTER_HOME_ARRIVAL_EPSILON) {
      monster.x = spawn.x;
      monster.y = spawn.y;
      monster.direction = spawn.direction;
      monster.animation = "idle";

      this.monsterReactionStates.delete(monsterId);
      this.monsterPatrolStates.delete(monsterId);
      return;
    }

    const movementDistance = Math.min(
      definition.movementSpeed * (deltaTime / 1000),
      distanceFromSpawn,
    );

    this.moveMonsterAlongVector(
      monster,
      definition,
      vectorX,
      vectorY,
      movementDistance,
    );

    if (
      Math.hypot(monster.x - spawn.x, monster.y - spawn.y) <=
      MONSTER_HOME_ARRIVAL_EPSILON
    ) {
      monster.x = spawn.x;
      monster.y = spawn.y;
      monster.direction = spawn.direction;
      monster.animation = "idle";

      this.monsterReactionStates.delete(monsterId);
      this.monsterPatrolStates.delete(monsterId);
    }
  }

  private updateMonsterReaction(
    monsterId: string,
    monster: MonsterState,
    spawn: MonsterSpawn,
    definition: MonsterDefinition,
    reactionState: Extract<MonsterReactionState, { mode: "react" }>,
    deltaTime: number,
  ) {
    const target = this.state.players.get(reactionState.targetSessionId);

    const targetDistance = target
      ? Math.hypot(target.x - monster.x, target.y - monster.y)
      : Number.POSITIVE_INFINITY;

    const distanceFromSpawn = Math.hypot(
      monster.x - spawn.x,
      monster.y - spawn.y,
    );

    if (
      !target ||
      !target.isAlive ||
      target.currentHealth <= 0 ||
      target.mapId !== monster.mapId ||
      targetDistance > definition.disengageRadius ||
      distanceFromSpawn >= definition.disengageRadius
    ) {
      this.monsterReactionStates.set(monsterId, { mode: "return" });

      this.updateMonsterReturn(
        monsterId,
        monster,
        spawn,
        definition,
        deltaTime,
      );
      return;
    }

    if (
      definition.reactionMode === "chase" &&
      definition.attack &&
      targetDistance <= definition.attack.range &&
      !this.monsterAttackCooldownRemaining.has(monsterId)
    ) {
      this.startMonsterAttack(
        monsterId,
        monster,
        reactionState.targetSessionId,
        target,
        definition.attack,
      );
      return;
    }

    let vectorX = target.x - monster.x;
    let vectorY = target.y - monster.y;

    if (definition.reactionMode === "flee") {
      vectorX *= -1;
      vectorY *= -1;

      if (vectorX === 0 && vectorY === 0) {
        switch (monster.direction) {
          case "left":
            vectorX = -1;
            break;

          case "right":
            vectorX = 1;
            break;

          case "up":
            vectorY = -1;
            break;

          case "down":
          default:
            vectorY = 1;
            break;
        }
      }
    }

    const maximumMovementDistance =
      definition.reactionSpeed * (deltaTime / 1000);

    const movementDistance =
      definition.reactionMode === "flee"
        ? maximumMovementDistance
        : Math.min(
            maximumMovementDistance,
            Math.max(0, targetDistance - definition.targetStopDistance),
          );

    const vectorLength = Math.hypot(vectorX, vectorY);
    const requestedX =
      vectorLength > 0
        ? monster.x + (vectorX / vectorLength) * movementDistance
        : monster.x;
    const requestedY =
      vectorLength > 0
        ? monster.y + (vectorY / vectorLength) * movementDistance
        : monster.y;

    if (
      Math.hypot(requestedX - spawn.x, requestedY - spawn.y) >
      definition.disengageRadius
    ) {
      this.monsterReactionStates.set(monsterId, { mode: "return" });

      this.updateMonsterReturn(
        monsterId,
        monster,
        spawn,
        definition,
        deltaTime,
      );
      return;
    }

    this.moveMonsterAlongVector(
      monster,
      definition,
      vectorX,
      vectorY,
      movementDistance,
      "run",
    );
  }

  private updateMonsterPatrolMovement(
    monsterId: string,
    monster: MonsterState,
    spawn: MonsterSpawn,
    definition: MonsterDefinition,
    deltaTime: number,
  ) {
    let patrolState = this.monsterPatrolStates.get(monsterId);

    if (!patrolState || patrolState.remainingMs <= 0) {
      patrolState = this.createMonsterPatrolState(monster);
      this.monsterPatrolStates.set(monsterId, patrolState);
    }

    patrolState.remainingMs -= deltaTime;

    if (!patrolState.direction) {
      monster.animation = "idle";
      return;
    }

    let moveX = 0;
    let moveY = 0;

    switch (patrolState.direction) {
      case "left":
        moveX = -1;
        break;

      case "right":
        moveX = 1;
        break;

      case "up":
        moveY = -1;
        break;

      case "down":
        moveY = 1;
        break;
    }

    const distance = definition.movementSpeed * (deltaTime / 1000);
    const deltaX = moveX * distance;
    const deltaY = moveY * distance;
    const requestedX = monster.x + deltaX;
    const requestedY = monster.y + deltaY;

    if (
      Math.hypot(requestedX - spawn.x, requestedY - spawn.y) >
      definition.patrolRadius
    ) {
      patrolState.remainingMs = 0;
      monster.animation = "idle";
      return;
    }

    const movement = resolveMonsterMovement(
      monster.mapId,
      definition.bodyProfileId,
      monster.x,
      monster.y,
      deltaX,
      deltaY,
    );

    const moved = movement.x !== monster.x || movement.y !== monster.y;

    monster.x = movement.x;
    monster.y = movement.y;
    monster.animation = moved ? "walk" : "idle";

    if (movement.blockedX || movement.blockedY || !moved) {
      patrolState.remainingMs = 0;
    }
  }

  private updateMonsterBehavior(deltaTime: number) {
    this.state.monsters.forEach((monster, monsterId) => {
      if (!monster.isAlive || monster.currentHealth <= 0) {
        this.monsterPatrolStates.delete(monsterId);
        this.monsterReactionStates.delete(monsterId);
        this.monsterAttackStates.delete(monsterId);
        this.monsterAttackCooldownRemaining.delete(monsterId);
        this.monstersPendingRespawnIdleTick.delete(monsterId);
        return;
      }

      if (this.monstersPendingRespawnIdleTick.delete(monsterId)) {
        this.monsterAttackStates.delete(monsterId);
        this.monsterAttackCooldownRemaining.delete(monsterId);
        monster.animation = "idle";
        return;
      }

      if (this.monsterHurtRemaining.has(monsterId)) {
        this.monsterPatrolStates.delete(monsterId);
        this.monsterAttackStates.delete(monsterId);
        monster.animation = "hurt";
        return;
      }

      const spawn = this.monsterSpawnsById.get(monsterId);
      const definition = getMonsterDefinition(monster.monsterType);

      if (!spawn || !definition) {
        this.monsterPatrolStates.delete(monsterId);
        this.monsterReactionStates.delete(monsterId);
        this.monsterAttackStates.delete(monsterId);
        this.monsterAttackCooldownRemaining.delete(monsterId);
        monster.animation = "idle";
        return;
      }

      const attackState = this.monsterAttackStates.get(monsterId);

      if (attackState && definition.attack) {
        this.updateMonsterAttack(
          monsterId,
          monster,
          attackState,
          definition.attack,
          deltaTime,
        );
        return;
      }

      if (attackState) {
        this.monsterAttackStates.delete(monsterId);
      }

      if (
        definition.reactionMode === "flee" &&
        this.hasPendingValidAttackOnMonster(monsterId, monster, definition)
      ) {
        this.monsterPatrolStates.delete(monsterId);
        monster.animation = "idle";
        return;
      }

      let reactionState = this.monsterReactionStates.get(monsterId);
      const canReact =
        definition.behaviors.chaseAndAttack || definition.behaviors.fleeOnHit;

      if (!reactionState && canReact) {
        const target = this.findClosestMonsterTarget(
          monster,
          definition.detectionRadius,
        );

        if (target) {
          reactionState = {
            mode: "react",
            targetSessionId: target.sessionId,
          };

          this.monsterReactionStates.set(monsterId, reactionState);
          this.monsterPatrolStates.delete(monsterId);
        }
      }

      if (reactionState?.mode === "react") {
        this.updateMonsterReaction(
          monsterId,
          monster,
          spawn,
          definition,
          reactionState,
          deltaTime,
        );
        return;
      }

      if (reactionState?.mode === "return") {
        this.updateMonsterReturn(
          monsterId,
          monster,
          spawn,
          definition,
          deltaTime,
        );
        return;
      }

      if (!definition.behaviors.randomDirection) {
        this.monsterPatrolStates.delete(monsterId);
        monster.animation = "idle";
        return;
      }

      this.updateMonsterPatrolMovement(
        monsterId,
        monster,
        spawn,
        definition,
        deltaTime,
      );
    });
  }

  private applyPlayerAttackToMonster(
    sessionId: string,
    player: PlayerState,
    monsterId: string,
  ) {
    const monster = this.state.monsters.get(monsterId);

    if (!monster) {
      console.log("[Grandoria] Attack missed:", {
        sessionId,
        monsterId,
        reason: "monster_not_found",
      });

      return;
    }

    if (!monster.isAlive || monster.currentHealth <= 0) {
      console.log("[Grandoria] Attack missed:", {
        sessionId,
        monsterId,
        reason: "monster_dead",
      });

      return;
    }

    if (!player.mapId || player.mapId !== monster.mapId) {
      console.log("[Grandoria] Attack missed:", {
        sessionId,
        monsterId,
        reason: "different_map",
        playerMapId: player.mapId,
        monsterMapId: monster.mapId,
      });

      return;
    }

    const distance = Math.hypot(monster.x - player.x, monster.y - player.y);

    if (distance > MAX_PLAYER_ATTACK_DISTANCE) {
      console.log("[Grandoria] Attack missed:", {
        sessionId,
        monsterId,
        reason: "out_of_range",
        distance,
        maxDistance: MAX_PLAYER_ATTACK_DISTANCE,
      });

      return;
    }

    const attackHitbox = getPlayerAttackHitbox(player);

    const monsterDefinition = getMonsterDefinition(monster.monsterType);

    if (!monsterDefinition) {
      console.error("[Grandoria] Attack rejected:", {
        sessionId,
        monsterId,
        monsterType: monster.monsterType,
        reason: "monster_definition_not_found",
      });

      return;
    }

    const monsterHitbox = getMonsterHitbox(monster, monsterDefinition);

    if (!hitboxesIntersect(attackHitbox, monsterHitbox)) {
      console.log("[Grandoria] Attack missed:", {
        sessionId,
        monsterId,
        reason: "outside_directional_hitbox",
        direction: player.direction,
      });

      return;
    }

    const damage = PLAYER_ATTACK_DAMAGE;

    const previousHealth = monster.currentHealth;

    monster.currentHealth = Math.max(0, previousHealth - damage);

    this.monsterAttackStates.delete(monsterId);

    if (monster.currentHealth === 0) {
      monster.isAlive = false;
      monster.animation = "death";

      this.spawnMonsterDrop(monsterId, monster, sessionId);

      this.awardMonsterExperience(
        sessionId,
        monsterId,
        monster.monsterType,
        monsterDefinition.xpReward,
      );

      this.monsterHurtRemaining.delete(monsterId);

      this.monsterPatrolStates.delete(monsterId);

      this.monsterReactionStates.delete(monsterId);

      this.monsterAttackCooldownRemaining.delete(monsterId);

      this.monstersPendingRespawnIdleTick.delete(monsterId);

      const deathDurationMs = monsterDefinition.deathDurationMs;

      this.monsterDeathRemaining.set(monsterId, deathDurationMs);
    } else {
      monster.animation = "hurt";

      this.monsterPatrolStates.delete(monsterId);

      this.monsterHurtRemaining.set(
        monsterId,
        monsterDefinition.hurtDurationMs,
      );
    }

    console.log(`[Grandoria] Monster ${monsterId} took damage.`, {
      attackerSessionId: sessionId,
      damage,
      previousHealth,
      currentHealth: monster.currentHealth,
      isAlive: monster.isAlive,
    });
  }

    onJoin(client: Client, options: JoinOptions) {
    const joinOptions = options ?? {};

    const authenticatedPlayer =
      client.auth as AuthenticatedPlayer | undefined;

    const authenticatedUid =
      readSafeStringFromAliases(
        [authenticatedPlayer?.uid],
        128,
      );

    const authenticatedCharacterId =
      readSafeStringFromAliases(
        [authenticatedPlayer?.characterId],
        128,
      );

    if (
      authenticatedUid === "" ||
      authenticatedCharacterId === ""
    ) {
      console.warn(
        "[Grandoria] Join rejected: authenticated identity is missing.",
      );

      throw new ServerError(
        ErrorCode.AUTH_FAILED,
        "Authentication failed.",
      );
    }

    const identity: PlayerIdentity = {
      playerUid: authenticatedUid,

      characterId: authenticatedCharacterId,

      mapId: readSafeStringFromAliases(
        [joinOptions.mapId, joinOptions.MapID],
        64,
      ),
    };

    identity.mapId =
  normalizeWorldMapId(
    authenticatedPlayer.location.mapId,
  );

    const appearanceOptions = readObject(
      joinOptions.appearance ?? joinOptions.Appearance,
    );

    const equipmentOptions = authenticatedPlayer.equipment;

    const player = new PlayerState();

    const spawn = resolvePlayerSpawn(
  identity.mapId,
  authenticatedPlayer.location.x,
  authenticatedPlayer.location.y,
);
    

    player.x = spawn.x;

    player.y = spawn.y;

    player.direction =
  readDirectionFromAliases([
    authenticatedPlayer.location.direction,
  ]);

    player.animation = "idle";

    player.displayName = readSafeStringFromAliases(
      [joinOptions.characterName, joinOptions.CharacterName],
      32,
    );

    player.characterId = identity.characterId;

    player.mapId = identity.mapId;

    player.currentHealth = authenticatedPlayer.resources.currentHealth;

    player.maxHealth = authenticatedPlayer.resources.maxHealth;

    player.isAlive = player.currentHealth > 0;

    player.appearance.Sex = readAppearanceValue(
      appearanceOptions.Sex ?? appearanceOptions.sex,
      "Male",
    );

    player.appearance.SkinTone = readAppearanceValue(
      appearanceOptions.SkinTone ?? appearanceOptions.skinTone,
      "Tone_01",
    );

    player.appearance.EyeColor = readAppearanceValue(
      appearanceOptions.EyeColor ?? appearanceOptions.eyeColor,
      "EyeColor_01",
    );

    player.appearance.HairStyle = readAppearanceValue(
      appearanceOptions.HairStyle ?? appearanceOptions.hairStyle,
      "HairStyle_01",
    );

    player.appearance.HairColor = readAppearanceValue(
      appearanceOptions.HairColor ?? appearanceOptions.hairColor,
      "HairColor_01",
    );

    applyEquipmentSlot(
      player.equipment.Head,
      readFirstDefined(equipmentOptions, ["Head", "head"]),
    );

    applyEquipmentSlot(
      player.equipment.Tronco,
      readFirstDefined(equipmentOptions, [
        "Tronco",
        "tronco",
        "Chest",
        "chest",
      ]),
    );

    applyEquipmentSlot(
      player.equipment.Legs,
      readFirstDefined(equipmentOptions, ["Legs", "legs", "Pants", "pants"]),
    );

    applyEquipmentSlot(
      player.equipment.Foots,
      readFirstDefined(equipmentOptions, [
        "Foots",
        "foots",
        "Feet",
        "feet",
        "Boots",
        "boots",
      ]),
    );

    applyEquipmentSlot(
      player.equipment.Weapons,
      readFirstDefined(equipmentOptions, [
        "Weapons",
        "weapons",
        "Weapon",
        "weapon",
      ]),
    );

    applyEquipmentSlot(
      player.equipment.OffHand,
      readFirstDefined(equipmentOptions, [
        "OffHand",
        "offHand",
        "offhand",
        "Off_Hand",
        "off_hand",
        "Shield",
        "shield",
      ]),
    );

    for (const inventorySlotData of authenticatedPlayer.inventory) {
      const inventorySlot = new PlayerInventorySlotState();

      inventorySlot.id = inventorySlotData.id;
      inventorySlot.type = inventorySlotData.type;
      inventorySlot.sub_type = inventorySlotData.sub_type;
      inventorySlot.quantity = inventorySlotData.quantity;

      player.inventory.push(inventorySlot);
    }

    this.playerIdentities.set(client.sessionId, identity);

    this.state.players.set(client.sessionId, player);

    this.playerInputs.set(client.sessionId, createIdleInput());

    console.log(
      `[Grandoria] Player ${client.sessionId} joined.`,
      `Character: ${player.displayName || "not provided"}.`,
      `Map: ${player.mapId || "not provided"}.`,
      "Equipment:",
      {
        Head: {
          id: player.equipment.Head.id,
          type: player.equipment.Head.type,
          sub_type: player.equipment.Head.sub_type,
        },

        Tronco: {
          id: player.equipment.Tronco.id,
          type: player.equipment.Tronco.type,
          sub_type: player.equipment.Tronco.sub_type,
        },

        Legs: {
          id: player.equipment.Legs.id,
          type: player.equipment.Legs.type,
          sub_type: player.equipment.Legs.sub_type,
        },

        Foots: {
          id: player.equipment.Foots.id,
          type: player.equipment.Foots.type,
          sub_type: player.equipment.Foots.sub_type,
        },

        Weapons: {
          id: player.equipment.Weapons.id,
          type: player.equipment.Weapons.type,
          sub_type: player.equipment.Weapons.sub_type,
        },

        OffHand: {
          id: player.equipment.OffHand.id,
          type: player.equipment.OffHand.type,
          sub_type: player.equipment.OffHand.sub_type,
        },
      },
      `Position: (${player.x}, ${player.y}).`,
      `Total: ${this.state.players.size}`,
    );
  }

  async onLeave(
  client: Client,
  code: CloseCode,
) {
  const player =
    this.state.players.get(client.sessionId);

  const identity =
    this.playerIdentities.get(client.sessionId);

  this.playerInputs.delete(client.sessionId);
  this.playerCollisionBlocks.delete(client.sessionId);
  this.playerIdentities.delete(client.sessionId);
  this.playerAttackRemaining.delete(client.sessionId);
  this.playerAttackTargets.delete(client.sessionId);
  this.playerRespawnRemaining.delete(client.sessionId);
  this.completedDropRequests.delete(client.sessionId);
  this.playerInventoryOperations.delete(client.sessionId);

  this.state.players.delete(client.sessionId);

  this.monsterAttackStates.forEach(
    (attackState, monsterId) => {
      if (
        attackState.targetSessionId ===
        client.sessionId
      ) {
        this.monsterAttackStates.delete(monsterId);
      }
    },
  );

  if (player && identity) {
    try {
      await firebaseAdminFirestore
        .collection("users")
        .doc(identity.playerUid)
        .collection("characters")
        .doc(identity.characterId)
        .update({
          "Location.Map":
            normalizeWorldMapId(player.mapId),

          "Location.X":
            player.x,

          "Location.Y":
            player.y,

          "Location.Direction":
            readDirectionFromAliases([
              player.direction,
            ]),

          "Resources.CurrentHP":
            Math.max(0, Math.min(player.currentHealth, player.maxHealth)),
        });

      console.log(
        `[Grandoria] Player location saved: ${client.sessionId}.`,
        {
          characterId:
            identity.characterId,

          mapId:
            normalizeWorldMapId(player.mapId),

          x:
            player.x,

          y:
            player.y,

          direction:
            player.direction,

          currentHealth:
            player.currentHealth,

          maxHealth:
            player.maxHealth,
        },
      );
    } catch (error) {
      const errorCode =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "unknown";

      console.error(
        `[Grandoria] Failed to save player location: ${client.sessionId}.`,
        errorCode,
      );
    }
  } else {
    console.warn(
      `[Grandoria] Player location was not saved because session data is missing: ${client.sessionId}.`,
    );
  }

  console.log(
    `[Grandoria] Player ${client.sessionId} left.`,
    `Code: ${code}.`,
    `Total: ${this.state.players.size}`,
  );
}

  onDispose() {
    this.playerInputs.clear();

    this.playerCollisionBlocks.clear();
    this.playerIdentities.clear();
    this.playerAttackRemaining.clear();
    this.playerAttackTargets.clear();
    this.playerRespawnRemaining.clear();
    this.monsterHurtRemaining.clear();
    this.monsterDeathRemaining.clear();
    this.monsterRespawnRemaining.clear();
    this.monsterPatrolStates.clear();
    this.monsterReactionStates.clear();
    this.monsterAttackStates.clear();
    this.monsterAttackCooldownRemaining.clear();
    this.monstersPendingRespawnIdleTick.clear();
    this.monsterSpawnsById.clear();
    this.monsterRegionsByMonsterId.clear();

    console.log(`[Grandoria] Room ${this.roomId} disposed.`);
  }
}