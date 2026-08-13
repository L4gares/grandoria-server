import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type HitboxOffsets = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type MonsterAttackDefinition = {
  damage: number;
  range: number;
  hitDelayMs: number;
  durationMs: number;
  intervalMs: number;
};

export type MonsterBehaviors = {
  chaseAndAttack: boolean;
  fleeOnHit: boolean;
  randomDirection: boolean;
};

export type DropItemDefinition = {
  guaranteed: boolean;
  itemID: string;
  maxQuantity: number;
  minQuantity: number;
  weight: number;
};

export type DropRarityDefinition = {
  items: readonly DropItemDefinition[];
  name: string;
  weight: number;
};

export type MonsterDropDefinition = {
  chancePercent: number;
  rarities: readonly DropRarityDefinition[];
  rolls: number;
};

export type MonsterDefinition = {
  bodyProfileId: string;
  maxHealth: number;
  movementSpeed: number;
  reactionSpeed: number;
  patrolRadius: number;
  reactionMode: "flee" | "chase" | "none";
  detectionRadius: number;
  disengageRadius: number;
  targetStopDistance: number;
  hurtDurationMs: number;
  deathDurationMs: number;
  xpReward: number;
  behaviors: MonsterBehaviors;
  hitboxOffsets: HitboxOffsets;
  attack?: MonsterAttackDefinition;
  drops?: MonsterDropDefinition;
};

export type MonsterType = string;

type Point = {
  x: number;
  y: number;
};

type WorldArtifact = {
  artifactSchemaVersion: number;
  bodyProfiles: Array<{
    id: string;
    movementBody: {
      originRelativePolygons: Point[][];
    };
  }>;
};

const MONSTER_CATALOG_SCHEMA_VERSION = 2;
const WORLD_ARTIFACT_SCHEMA_VERSION = 1;
const WORLD_FILE_NAME = "MAP_1.world.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`[Grandoria] ${message}`);
}

function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(`${label} must be an object.`);
  }

  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${label} must be boolean.`);
  }

  return value;
}

function requireFiniteNumber(
  value: unknown,
  label: string,
  minimum = 0,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum
  ) {
    fail(`${label} must be a finite number >= ${minimum}.`);
  }

  return Object.is(value, -0) ? 0 : value;
}

function requireInteger(
  value: unknown,
  label: string,
  minimum = 0,
): number {
  const result = requireFiniteNumber(value, label, minimum);

  if (!Number.isInteger(result)) {
    fail(`${label} must be an integer.`);
  }

  return result;
}

function findMonsterCatalogPath(): string {
  const candidates = [
    fileURLToPath(new URL("./monsters.json", import.meta.url)),
    resolve(process.cwd(), "src", "config", "monsters.json"),
  ];

  const catalogPath = candidates.find(existsSync);

  if (!catalogPath) {
    fail("Monster catalog not found: src/config/monsters.json.");
  }

  return catalogPath;
}

function findWorldArtifactPath(): string {
  const candidates = [
    fileURLToPath(
      new URL(`../world/maps/${WORLD_FILE_NAME}`, import.meta.url),
    ),
    resolve(process.cwd(), "src", "world", "maps", WORLD_FILE_NAME),
  ];

  const artifactPath = candidates.find(existsSync);

  if (!artifactPath) {
    fail(`World artifact not found: src/world/maps/${WORLD_FILE_NAME}.`);
  }

  return artifactPath;
}

function parseJsonFile(filePath: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    fail(`${label} is invalid JSON: ${message}`);
  }
}

function isFinitePoint(value: unknown): value is Point {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y)
  );
}

function calculateHitboxOffsets(polygons: Point[][]): HitboxOffsets {
  const points = polygons.flat();

  if (points.length === 0) {
    fail("Cannot derive a monster hitbox from empty body geometry.");
  }

  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function loadBodyProfileHitboxes(): Map<string, HitboxOffsets> {
  const parsed = parseJsonFile(findWorldArtifactPath(), "World artifact");
  const artifactRecord = requireRecord(parsed, "World artifact");

  if (artifactRecord.artifactSchemaVersion !== WORLD_ARTIFACT_SCHEMA_VERSION) {
    fail(
      `Unsupported world artifact schema version: ${String(
        artifactRecord.artifactSchemaVersion,
      )}.`,
    );
  }

  if (!Array.isArray(artifactRecord.bodyProfiles)) {
    fail("World artifact bodyProfiles are missing.");
  }

  const hitboxes = new Map<string, HitboxOffsets>();

  artifactRecord.bodyProfiles.forEach((profileValue, profileIndex) => {
    const profile = requireRecord(
      profileValue,
      `World body profile ${profileIndex}`,
    );
    const profileId = requireString(
      profile.id,
      `World body profile ${profileIndex}.id`,
    );
    const movementBody = requireRecord(
      profile.movementBody,
      `World body profile ${profileId}.movementBody`,
    );

    if (!Array.isArray(movementBody.originRelativePolygons)) {
      fail(
        `World body profile ${profileId}.movementBody.originRelativePolygons is missing.`,
      );
    }

    const polygons = movementBody.originRelativePolygons.map(
      (polygonValue, polygonIndex) => {
        if (
          !Array.isArray(polygonValue) ||
          polygonValue.length < 3 ||
          !polygonValue.every(isFinitePoint)
        ) {
          fail(
            `World body profile ${profileId} polygon ${polygonIndex} is invalid.`,
          );
        }

        return polygonValue;
      },
    );

    if (hitboxes.has(profileId)) {
      fail(`Duplicate world body profile: ${profileId}.`);
    }

    hitboxes.set(profileId, calculateHitboxOffsets(polygons));
  });

  return hitboxes;
}

function readBehaviors(
  value: unknown,
  monsterType: string,
): MonsterBehaviors {
  const source = requireRecord(value, `${monsterType}.behaviors`);

  return {
    chaseAndAttack: requireBoolean(
      source.chaseAndAttack,
      `${monsterType}.behaviors.chaseAndAttack`,
    ),
    fleeOnHit: requireBoolean(
      source.fleeOnHit,
      `${monsterType}.behaviors.fleeOnHit`,
    ),
    randomDirection: requireBoolean(
      source.randomDirection,
      `${monsterType}.behaviors.randomDirection`,
    ),
  };
}

function readAttack(
  value: unknown,
  monsterType: string,
): MonsterAttackDefinition | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const source = requireRecord(value, `${monsterType}.attack`);
  const durationMs = requireFiniteNumber(
    source.durationMs,
    `${monsterType}.attack.durationMs`,
  );
  const hitDelayMs = requireFiniteNumber(
    source.hitDelayMs,
    `${monsterType}.attack.hitDelayMs`,
  );
  const intervalMs = requireFiniteNumber(
    source.intervalMs,
    `${monsterType}.attack.intervalMs`,
  );

  if (durationMs <= 0) {
    fail(`${monsterType}.attack.durationMs must be greater than 0.`);
  }

  if (intervalMs <= 0) {
    fail(`${monsterType}.attack.intervalMs must be greater than 0.`);
  }

  if (hitDelayMs > durationMs) {
    fail(`${monsterType}.attack.hitDelayMs cannot exceed durationMs.`);
  }

  const damage = requireFiniteNumber(
    source.damage,
    `${monsterType}.attack.damage`,
  );
  const range = requireFiniteNumber(
    source.range,
    `${monsterType}.attack.range`,
  );

  if (damage <= 0) {
    fail(`${monsterType}.attack.damage must be greater than 0.`);
  }

  if (range <= 0) {
    fail(`${monsterType}.attack.range must be greater than 0.`);
  }

  return {
    damage,
    range,
    hitDelayMs,
    durationMs,
    intervalMs,
  };
}

function readDrops(
  value: unknown,
  monsterType: string,
): MonsterDropDefinition | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const source = requireRecord(value, `${monsterType}.drops`);
  const chancePercent = requireFiniteNumber(
    source.chancePercent,
    `${monsterType}.drops.chancePercent`,
  );
  const rolls = requireInteger(
    source.rolls,
    `${monsterType}.drops.rolls`,
  );

  if (chancePercent > 100) {
    fail(`${monsterType}.drops.chancePercent cannot exceed 100.`);
  }

  if (!Array.isArray(source.rarities) || source.rarities.length === 0) {
    fail(`${monsterType}.drops.rarities must contain at least one rarity.`);
  }

  const seenRarityNames = new Set<string>();
  const rarities = source.rarities.map((rarityValue, rarityIndex) => {
    const rarity = requireRecord(
      rarityValue,
      `${monsterType}.drops.rarities[${rarityIndex}]`,
    );
    const name = requireString(
      rarity.name,
      `${monsterType}.drops.rarities[${rarityIndex}].name`,
    );

    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      fail(
        `${monsterType}.drops.rarities[${rarityIndex}].name contains unsupported characters.`,
      );
    }

    if (seenRarityNames.has(name)) {
      fail(`${monsterType}.drops contains duplicate rarity name ${name}.`);
    }
    seenRarityNames.add(name);

    const weight = requireFiniteNumber(
      rarity.weight,
      `${monsterType}.drops.rarities[${rarityIndex}].weight`,
    );

    if (!Array.isArray(rarity.items) || rarity.items.length === 0) {
      fail(
        `${monsterType}.drops.rarities[${rarityIndex}].items must contain at least one item.`,
      );
    }

    const seenItemIDs = new Set<string>();
    const items = rarity.items.map((itemValue, itemIndex) => {
      const item = requireRecord(
        itemValue,
        `${monsterType}.drops.rarities[${rarityIndex}].items[${itemIndex}]`,
      );
      const itemID = requireString(
        item.itemID,
        `${monsterType}.drops.rarities[${rarityIndex}].items[${itemIndex}].itemID`,
      );

      if (!/^[A-Za-z0-9_-]+$/.test(itemID)) {
        fail(
          `${monsterType}.drops.rarities[${rarityIndex}].items[${itemIndex}].itemID contains unsupported characters.`,
        );
      }

      if (seenItemIDs.has(itemID)) {
        fail(
          `${monsterType}.drops.rarities[${rarityIndex}] contains duplicate item ${itemID}.`,
        );
      }
      seenItemIDs.add(itemID);

      const itemWeight = requireFiniteNumber(
        item.weight,
        `${monsterType}.drops.rarities[${rarityIndex}].items[${itemIndex}].weight`,
      );
      const minQuantity = requireInteger(
        item.minQuantity,
        `${monsterType}.drops.rarities[${rarityIndex}].items[${itemIndex}].minQuantity`,
        1,
      );
      const maxQuantity = requireInteger(
        item.maxQuantity,
        `${monsterType}.drops.rarities[${rarityIndex}].items[${itemIndex}].maxQuantity`,
        1,
      );
      const guaranteed = requireBoolean(
        item.guaranteed,
        `${monsterType}.drops.rarities[${rarityIndex}].items[${itemIndex}].guaranteed`,
      );

      if (maxQuantity < minQuantity) {
        fail(
          `${monsterType}.drops.rarities[${rarityIndex}].items[${itemIndex}].maxQuantity cannot be smaller than minQuantity.`,
        );
      }

      if (!guaranteed && itemWeight <= 0) {
        fail(
          `${monsterType}.drops.rarities[${rarityIndex}].items[${itemIndex}].weight must be greater than 0 when guaranteed is false.`,
        );
      }

      return {
        guaranteed,
        itemID,
        maxQuantity,
        minQuantity,
        weight: itemWeight,
      };
    });

    return {
      items,
      name,
      weight,
    };
  });

  if (
    rolls > 0 &&
    chancePercent > 0 &&
    !rarities.some(
      (rarity) =>
        rarity.weight > 0 &&
        rarity.items.some((item) => !item.guaranteed && item.weight > 0),
    )
  ) {
    fail(
      `${monsterType}.drops needs at least one positive-weight rarity with a non-guaranteed positive-weight item when rolls and chancePercent are greater than 0.`,
    );
  }

  return {
    chancePercent,
    rarities,
    rolls,
  };
}

function readMonsterDefinition(
  monsterType: string,
  value: unknown,
  bodyProfileHitboxes: Map<string, HitboxOffsets>,
): MonsterDefinition {
  if (!/^[A-Za-z0-9_-]+$/.test(monsterType)) {
    fail(`Monster type is invalid: ${monsterType}.`);
  }

  const source = requireRecord(value, `Monster ${monsterType}`);
  const bodyProfileId = requireString(
    source.bodyProfileId,
    `${monsterType}.bodyProfileId`,
  );
  const behaviors = readBehaviors(source.behaviors, monsterType);
  const attack = readAttack(source.attack, monsterType);
  const drops = readDrops(source.drops, monsterType);
  const reactionMode = source.reactionMode;

  if (
    reactionMode !== "flee" &&
    reactionMode !== "chase" &&
    reactionMode !== "none"
  ) {
    fail(`${monsterType}.reactionMode is invalid.`);
  }

  if (behaviors.chaseAndAttack && behaviors.fleeOnHit) {
    fail(
      `${monsterType} cannot chase-and-attack and flee-on-hit at the same time.`,
    );
  }

  const expectedReactionMode = behaviors.fleeOnHit
    ? "flee"
    : behaviors.chaseAndAttack
      ? "chase"
      : "none";

  if (reactionMode !== expectedReactionMode) {
    fail(
      `${monsterType}.reactionMode does not match its exported behavior groups.`,
    );
  }

  if (Boolean(attack) !== behaviors.chaseAndAttack) {
    fail(
      `${monsterType}.attack does not match the chase-and-attack behavior group.`,
    );
  }

  const detectionRadius = requireFiniteNumber(
    source.detectionRadius,
    `${monsterType}.detectionRadius`,
  );
  const disengageRadius = requireFiniteNumber(
    source.disengageRadius,
    `${monsterType}.disengageRadius`,
  );

  if (disengageRadius < detectionRadius) {
    fail(`${monsterType}.disengageRadius cannot be smaller than detectionRadius.`);
  }

  const hitboxOffsets = bodyProfileHitboxes.get(bodyProfileId);

  if (!hitboxOffsets) {
    fail(
      `Monster ${monsterType} references missing body profile ${bodyProfileId}. Re-run the GDevelop world exporter.`,
    );
  }

  return {
    bodyProfileId,
    maxHealth: requireInteger(source.maxHealth, `${monsterType}.maxHealth`, 1),
    movementSpeed: requireFiniteNumber(
      source.movementSpeed,
      `${monsterType}.movementSpeed`,
    ),
    reactionSpeed: requireFiniteNumber(
      source.reactionSpeed,
      `${monsterType}.reactionSpeed`,
    ),
    patrolRadius: requireFiniteNumber(
      source.patrolRadius,
      `${monsterType}.patrolRadius`,
    ),
    reactionMode,
    detectionRadius,
    disengageRadius,
    targetStopDistance: requireFiniteNumber(
      source.targetStopDistance,
      `${monsterType}.targetStopDistance`,
    ),
    hurtDurationMs: requireFiniteNumber(
      source.hurtDurationMs,
      `${monsterType}.hurtDurationMs`,
    ),
    deathDurationMs: requireFiniteNumber(
      source.deathDurationMs,
      `${monsterType}.deathDurationMs`,
    ),
    xpReward: requireInteger(source.xpReward, `${monsterType}.xpReward`),
    behaviors,
    hitboxOffsets: { ...hitboxOffsets },
    ...(attack ? { attack } : {}),
    ...(drops ? { drops } : {}),
  };
}

function loadMonsterDefinitions(): Map<string, MonsterDefinition> {
  const parsed = parseJsonFile(findMonsterCatalogPath(), "Monster catalog");
  const catalog = requireRecord(parsed, "Monster catalog");

  if (catalog.catalogSchemaVersion !== MONSTER_CATALOG_SCHEMA_VERSION) {
    fail(
      `Unsupported monster catalog schema version: ${String(
        catalog.catalogSchemaVersion,
      )}.`,
    );
  }

  const definitionsSource = requireRecord(
    catalog.definitions,
    "Monster catalog definitions",
  );
  const bodyProfileHitboxes = loadBodyProfileHitboxes();
  const definitions = new Map<string, MonsterDefinition>();

  for (const monsterType of Object.keys(definitionsSource).sort()) {
    definitions.set(
      monsterType,
      readMonsterDefinition(
        monsterType,
        definitionsSource[monsterType],
        bodyProfileHitboxes,
      ),
    );
  }

  if (definitions.size === 0) {
    fail("Monster catalog contains no definitions.");
  }

  console.log("[Grandoria] Monster catalog loaded:", [
    ...definitions.keys(),
  ]);

  return definitions;
}

const MONSTER_DEFINITIONS = loadMonsterDefinitions();

export function getMonsterDefinition(
  monsterType: string,
): MonsterDefinition | undefined {
  return MONSTER_DEFINITIONS.get(monsterType);
}

export function getMonsterTypes(): readonly string[] {
  return [...MONSTER_DEFINITIONS.keys()];
}