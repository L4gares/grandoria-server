import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PLAYER_ATTRIBUTE_NAMES = [
  "AttackPower",
  "MagicPower",
  "HealingPower",
  "Agility",
  "Vitality",
  "Regeneration",
  "Armor",
  "CriticalChance",
] as const;

export type PlayerAttributeName =
  (typeof PLAYER_ATTRIBUTE_NAMES)[number];

export type ClassBaseAttributes = Record<PlayerAttributeName, number>;

export type ClassDefinition = {
  classId: string;
  displayName: string;
  baseAttributes: ClassBaseAttributes;
  skillIds: readonly string[];
};

type UnknownRecord = Record<string, unknown>;

const CLASS_CATALOG_SCHEMA_VERSION = 2;

const CLASS_CATALOG_PATH = resolve(
  process.cwd(),
  "src",
  "classes",
  "classes.json",
);

function readRecord(
  value: unknown,
  context: string,
): UnknownRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      `[Grandoria] ${context} must be an object.`,
    );
  }

  return value as UnknownRecord;
}

function readNonEmptyString(
  value: unknown,
  context: string,
): string {
  if (typeof value !== "string") {
    throw new Error(
      `[Grandoria] ${context} must be a string.`,
    );
  }

  const result = value.trim();

  if (result === "") {
    throw new Error(
      `[Grandoria] ${context} cannot be empty.`,
    );
  }

  return result;
}

function readClassId(
  value: unknown,
  context: string,
): string {
  const result = readNonEmptyString(value, context);

  if (!/^[a-z0-9_]+$/.test(result)) {
    throw new Error(
      `[Grandoria] ${context} must use only lowercase letters, numbers, and underscores.`,
    );
  }

  return result;
}

function readNonNegativeInteger(
  value: unknown,
  context: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(
      `[Grandoria] ${context} must be a non-negative integer.`,
    );
  }

  return value;
}

function readSkillIds(
  value: unknown,
  classId: string,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `[Grandoria] Class "${classId}".skillIds must be an array.`,
    );
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawSkillId of value) {
    const skillId = readNonEmptyString(
      rawSkillId,
      `Class "${classId}".skillIds entry`,
    );

    if (!/^[A-Za-z0-9_-]+$/.test(skillId)) {
      throw new Error(
        `[Grandoria] Class "${classId}".skillIds contains invalid SkillID "${skillId}".`,
      );
    }

    if (seen.has(skillId)) {
      throw new Error(
        `[Grandoria] Class "${classId}".skillIds contains duplicate SkillID "${skillId}".`,
      );
    }

    seen.add(skillId);
    result.push(skillId);
  }

  return Object.freeze(result.sort());
}

function readBaseAttributes(
  value: unknown,
  classId: string,
): ClassBaseAttributes {
  const source = readRecord(
    value,
    `Class "${classId}".baseAttributes`,
  );

  const result = {} as ClassBaseAttributes;

  for (const attributeName of PLAYER_ATTRIBUTE_NAMES) {
    result[attributeName] = readNonNegativeInteger(
      source[attributeName],
      `Class "${classId}".baseAttributes.${attributeName}`,
    );
  }

  return Object.freeze(result);
}

function readClassDefinition(
  catalogKey: string,
  value: unknown,
): ClassDefinition {
  const source = readRecord(
    value,
    `Class "${catalogKey}"`,
  );

  const classId = readClassId(
    source.classId,
    `Class "${catalogKey}".classId`,
  );

  if (classId !== catalogKey) {
    throw new Error(
      `[Grandoria] Class catalog key "${catalogKey}" does not match classId "${classId}".`,
    );
  }

  const definition: ClassDefinition = {
    classId,
    displayName: readNonEmptyString(
      source.displayName,
      `Class "${classId}".displayName`,
    ),
    baseAttributes: readBaseAttributes(
      source.baseAttributes,
      classId,
    ),
    skillIds: readSkillIds(
      source.skillIds,
      classId,
    ),
  };

  return Object.freeze(definition);
}

export function parseClassCatalog(
  value: unknown,
): ReadonlyMap<string, ClassDefinition> {
  const document = readRecord(
    value,
    "Class catalog",
  );

  if (
    document.schemaVersion !==
    CLASS_CATALOG_SCHEMA_VERSION
  ) {
    throw new Error(
      `[Grandoria] Unsupported class catalog schemaVersion "${String(
        document.schemaVersion,
      )}". Expected ${CLASS_CATALOG_SCHEMA_VERSION}.`,
    );
  }

  const classes = readRecord(
    document.classes,
    "Class catalog.classes",
  );

  const entries = Object.entries(classes).sort(
    ([left], [right]) => left.localeCompare(right),
  );

  if (entries.length === 0) {
    throw new Error(
      "[Grandoria] Class catalog must contain at least one class.",
    );
  }

  const catalog = new Map<string, ClassDefinition>();

  for (const [rawClassId, rawDefinition] of entries) {
    const classId = readClassId(
      rawClassId,
      "Class catalog key",
    );

    if (catalog.has(classId)) {
      throw new Error(
        `[Grandoria] Duplicate classId "${classId}".`,
      );
    }

    catalog.set(
      classId,
      readClassDefinition(
        classId,
        rawDefinition,
      ),
    );
  }

  return catalog;
}

function loadClassCatalog(): ReadonlyMap<
  string,
  ClassDefinition
> {
  let rawText = "";

  try {
    rawText = readFileSync(
      CLASS_CATALOG_PATH,
      "utf8",
    );
  } catch (error) {
    throw new Error(
      `[Grandoria] Failed to read class catalog at ${CLASS_CATALOG_PATH}.`,
      { cause: error },
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `[Grandoria] Class catalog contains invalid JSON at ${CLASS_CATALOG_PATH}.`,
      { cause: error },
    );
  }

  return parseClassCatalog(parsed);
}

const CLASS_CATALOG = loadClassCatalog();

console.log(
  "[Grandoria] Class catalog loaded:",
  Array.from(CLASS_CATALOG.keys()),
);

export function getClassDefinition(
  classId: string,
): ClassDefinition | undefined {
  const normalizedClassId =
    typeof classId === "string"
      ? classId.trim().toLowerCase()
      : "";

  if (normalizedClassId === "") {
    return undefined;
  }

  return CLASS_CATALOG.get(normalizedClassId);
}

export function getClassDefinitions(): readonly ClassDefinition[] {
  return Array.from(CLASS_CATALOG.values());
}

export function hasClassDefinition(
  classId: string,
): boolean {
  return getClassDefinition(classId) !== undefined;
}
