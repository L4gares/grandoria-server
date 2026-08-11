import { Room, Client, CloseCode } from "colyseus";

import {
  MyRoomState,
  MonsterState,
  PlayerState,
  PlayerEquipmentSlotState,
  WorldItemState,
} from "./schema/MyRoomState.js";

import {
  getItemDefinition,
  getMonsterDropDefinition,
} from "../items/ItemCatalog.js";

import {
  normalizeWorldMapId,
  resolveMonsterMovement,
  resolvePlayerMovement,
  resolvePlayerSpawn,
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

type Hitbox = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type HitboxOffsets = Hitbox;

type MonsterAttackDefinition = {
  damage: number;
  range: number;
  hitDelayMs: number;
  durationMs: number;
  intervalMs: number;
};

type MonsterDefinition = {
  bodyProfileId: string;
  maxHealth: number;
  movementSpeed: number;
  reactionSpeed: number;
  patrolRadius: number;
  reactionMode: "flee" | "chase";
  detectionRadius: number;
  disengageRadius: number;
  targetStopDistance: number;
  hurtDurationMs: number;
  deathDurationMs: number;
  respawnDelayMs: number;
  hitboxOffsets: HitboxOffsets;
  attack?: MonsterAttackDefinition;
};

const MONSTER_DEFINITIONS = {
  mob_hare: {
    bodyProfileId: "mob_hare",
    maxHealth: 2,
    movementSpeed: 25,
    reactionSpeed: 45,
    patrolRadius: 96,
    reactionMode: "flee",
    detectionRadius: 128,
    disengageRadius: 192,
    targetStopDistance: 0,
    hurtDurationMs: 320,
    deathDurationMs: 480,
    respawnDelayMs: 10_000,
    hitboxOffsets: {
      minX: -6.5,
      maxX: 7,
      minY: -9.5,
      maxY: 2.5,
    },
  },
  mob_boar: {
    bodyProfileId: "mob_boar",
    maxHealth: 10,
    movementSpeed: 15,
    reactionSpeed: 50,
    patrolRadius: 96,
    reactionMode: "chase",
    detectionRadius: 128,
    disengageRadius: 192,
    targetStopDistance: 16,
    hurtDurationMs: 320,
    deathDurationMs: 480,
    respawnDelayMs: 10_000,
    hitboxOffsets: {
      minX: -6.5,
      maxX: 5.5,
      minY: -15,
      maxY: -3.5,
    },
    attack: {
      damage: 7,
      range: 32,
      hitDelayMs: 240,
      durationMs: 400,
      intervalMs: 2_000,
    },
  },
} satisfies Record<string, MonsterDefinition>;

type MonsterType = keyof typeof MONSTER_DEFINITIONS;

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
  rarity?: string;
  source: "inventory_drop" | "mob_drop";
  x: number;
  y: number;
};

type SelectedMonsterDrop = {
  itemID: string;
  rarity: string;
};

function getMonsterDefinition(
  monsterType: string,
): MonsterDefinition | undefined {
  if (!Object.prototype.hasOwnProperty.call(MONSTER_DEFINITIONS, monsterType)) {
    return undefined;
  }

  return MONSTER_DEFINITIONS[monsterType as MonsterType];
}

type MonsterSpawn = {
  monsterId: string;
  monsterType: MonsterType;
  mapId: string;
  x: number;
  y: number;
  direction: MonsterDirection;
};

const PLAYER_SPEED = 90;
const PLAYER_MAX_HEALTH = 50;
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

const MONSTER_SPAWNS: readonly MonsterSpawn[] = [
  {
    monsterId: "map1_hare_001",
    monsterType: "mob_hare",
    mapId: "MAP_1",
    x: 168,
    y: 968,
    direction: "down",
  },
  {
    monsterId: "map1_boar_001",
    monsterType: "mob_boar",
    mapId: "MAP_1",
    x: 144,
    y: 1056,
    direction: "down",
  },
];

const MONSTER_SPAWNS_BY_ID = new Map<string, MonsterSpawn>(
  MONSTER_SPAWNS.map((spawn) => [spawn.monsterId, spawn]),
);

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

    set_equipment: (client: Client, message: SetEquipmentMessage) => {
      const player = this.state.players.get(client.sessionId);

      if (!player) {
        return;
      }

      const messageData = readObject(message);

      const slotName = readEquipmentSlotName(messageData.slot);

      if (!slotName) {
        return;
      }

      const equipmentData =
        messageData.item ??
        messageData.equipment ??
        messageData.value ??
        messageData;

      const targetSlot = getEquipmentSlot(player, slotName);

      if (!applyEquipmentSlot(targetSlot, equipmentData)) {
        return;
      }

      console.log(`Equipment updated: ${client.sessionId}`, {
        slot: slotName,
        id: targetSlot.id,
        type: targetSlot.type,
        sub_type: targetSlot.sub_type,
      });
    },

    drop_item: (client: Client, message?: DropItemMessage) => {
      this.handleDropItemRequest(client, message);
    },

    collect_item: (client: Client, message?: CollectItemMessage) => {
      this.handleCollectItemRequest(client, message);
    },
  };

  onCreate() {
    for (const spawn of MONSTER_SPAWNS) {
      this.spawnMonster(spawn, "initial");
    }

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

    if (!definition) {
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
    item.quantity = 1;
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

  private handleDropItemRequest(
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

      client.send("drop_item_result", {
        code: "DROP_CREATION_FAILED",
        ok: false,
        requestId,
      });
      return;
    }

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
    });
  }

  private handleCollectItemRequest(
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
    });
  }

  private selectMonsterDrop(monsterType: string): SelectedMonsterDrop | null {
    const definition = getMonsterDropDefinition(monsterType);

    if (!definition) {
      return null;
    }

    const dropRoll =
      Math.min(99, Math.floor(clampUnitInterval(this.worldItemRandom()) * 100)) +
      1;

    if (dropRoll > definition.chancePercent) {
      return null;
    }

    const validRarities = definition.rarities
      .map((rarity) => ({
        itemIDs: rarity.itemIDs.filter((itemID) => getItemDefinition(itemID)),
        name: rarity.name,
        weight: Math.max(0, rarity.weight),
      }))
      .filter((rarity) => rarity.weight > 0 && rarity.itemIDs.length > 0);
    const totalWeight = validRarities.reduce(
      (total, rarity) => total + rarity.weight,
      0,
    );

    if (totalWeight <= 0) {
      return null;
    }

    const rarityRoll =
      clampUnitInterval(this.worldItemRandom()) * totalWeight;
    let accumulatedWeight = 0;
    let selectedRarity = validRarities[validRarities.length - 1];

    for (const rarity of validRarities) {
      accumulatedWeight += rarity.weight;

      if (rarityRoll < accumulatedWeight) {
        selectedRarity = rarity;
        break;
      }
    }

    const itemIndex = Math.min(
      selectedRarity.itemIDs.length - 1,
      Math.floor(
        clampUnitInterval(this.worldItemRandom()) *
          selectedRarity.itemIDs.length,
      ),
    );

    return {
      itemID: selectedRarity.itemIDs[itemIndex],
      rarity: selectedRarity.name,
    };
  }

  private spawnMonsterDrop(
    monsterId: string,
    monster: MonsterState,
    killerSessionId: string,
  ) {
    const selectedDrop = this.selectMonsterDrop(monster.monsterType);

    if (!selectedDrop) {
      return;
    }

    const identity = this.playerIdentities.get(killerSessionId);
    const sharedItemID = this.createWorldItem({
      createdBy: identity?.playerUid || killerSessionId,
      itemID: selectedDrop.itemID,
      mapId: monster.mapId,
      monsterId,
      monsterType: monster.monsterType,
      rarity: selectedDrop.rarity,
      source: "mob_drop",
      x: monster.x,
      y: monster.y,
    });

    if (!sharedItemID) {
      return;
    }

    console.log("[Grandoria] Monster drop created:", {
      itemID: selectedDrop.itemID,
      monsterId,
      monsterType: monster.monsterType,
      rarity: selectedDrop.rarity,
      sharedItemID,
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

  private spawnMonster(spawn: MonsterSpawn, reason: "initial" | "respawn") {
    if (this.state.monsters.has(spawn.monsterId)) {
      return;
    }

    const definition = MONSTER_DEFINITIONS[spawn.monsterType];

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

      const spawn = MONSTER_SPAWNS_BY_ID.get(monsterId);

      if (!spawn) {
        console.error(
          "[Grandoria] Monster removed without a registered spawn:",
          { monsterId },
        );

        return;
      }

      const definition = MONSTER_DEFINITIONS[spawn.monsterType];

      this.monsterRespawnRemaining.set(monsterId, definition.respawnDelayMs);

      console.log("[Grandoria] Monster removed after death animation:", {
        monsterId,
        respawnDelayMs: definition.respawnDelayMs,
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

      const spawn = MONSTER_SPAWNS_BY_ID.get(monsterId);

      if (!spawn) {
        console.error(
          "[Grandoria] Respawn failed: spawn configuration not found.",
          { monsterId },
        );

        return;
      }

      this.spawnMonster(spawn, "respawn");
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

      const spawn = MONSTER_SPAWNS_BY_ID.get(monsterId);
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

      if (!reactionState) {
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

      this.monsterHurtRemaining.delete(monsterId);

      this.monsterPatrolStates.delete(monsterId);

      this.monsterReactionStates.delete(monsterId);

      this.monsterAttackCooldownRemaining.delete(monsterId);

      this.monstersPendingRespawnIdleTick.delete(monsterId);

      const spawn = MONSTER_SPAWNS_BY_ID.get(monsterId);

      const deathDurationMs = spawn
        ? MONSTER_DEFINITIONS[spawn.monsterType].deathDurationMs
        : 480;

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

    const identity: PlayerIdentity = {
      playerUid: readSafeStringFromAliases(
        [joinOptions.playerUid, joinOptions.PlayerUID],
        128,
      ),

      characterId: readSafeStringFromAliases(
        [joinOptions.characterId, joinOptions.CharacterID],
        128,
      ),

      mapId: readSafeStringFromAliases(
        [joinOptions.mapId, joinOptions.MapID],
        64,
      ),
    };

    identity.mapId = normalizeWorldMapId(identity.mapId);

    const appearanceOptions = readObject(
      joinOptions.appearance ?? joinOptions.Appearance,
    );

    const equipmentOptions = readObject(
      joinOptions.equipment ?? joinOptions.Equipment,
    );

    const player = new PlayerState();

    const spawn = resolvePlayerSpawn(
      identity.mapId,
      readFiniteNumberFromAliases([joinOptions.x, joinOptions.X], Number.NaN),
      readFiniteNumberFromAliases([joinOptions.y, joinOptions.Y], Number.NaN),
    );

    player.x = spawn.x;

    player.y = spawn.y;

    player.direction = readDirectionFromAliases([
      joinOptions.direction,
      joinOptions.Direction,
    ]);

    player.animation = "idle";

    player.displayName = readSafeStringFromAliases(
      [joinOptions.characterName, joinOptions.CharacterName],
      32,
    );

    player.characterId = identity.characterId;

    player.mapId = identity.mapId;

    player.currentHealth = PLAYER_MAX_HEALTH;

    player.maxHealth = PLAYER_MAX_HEALTH;

    player.isAlive = true;

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

  onLeave(client: Client, code: CloseCode) {
    this.playerInputs.delete(client.sessionId);

    this.playerCollisionBlocks.delete(client.sessionId);

    this.playerIdentities.delete(client.sessionId);

    this.playerAttackRemaining.delete(client.sessionId);

    this.playerAttackTargets.delete(client.sessionId);

    this.playerRespawnRemaining.delete(client.sessionId);

    this.completedDropRequests.delete(client.sessionId);

    this.state.players.delete(client.sessionId);

    this.monsterAttackStates.forEach((attackState, monsterId) => {
      if (attackState.targetSessionId === client.sessionId) {
        this.monsterAttackStates.delete(monsterId);
      }
    });

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

    console.log(`[Grandoria] Room ${this.roomId} disposed.`);
  }
}
