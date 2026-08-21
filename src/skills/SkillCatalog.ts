import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type SkillEffectValue = unknown;

export type SkillDefinition = {
  id: string;
  nameDisplay: string;
  enabled: boolean;
  availableToAll: boolean;
  loadoutEligible: boolean;
  type: string;
  target: string;
  cooldownMs: number;
  castTimeMs: number;
  resourceType: string;
  resourceCost: number;
  effects: Readonly<Record<string, SkillEffectValue>>;
  scaling: {
    attribute: string;
    perPoint: number;
  };
};

const SKILL_CATALOG_SCHEMA_VERSION = 1;

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
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    /[\u0000-\u001F\u007F]/.test(value)
  ) {
    fail(`${label} must be a non-empty string without control characters.`);
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

function readEffectValue(
  value: unknown,
  label: string,
): SkillEffectValue {
  if (
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(`${label} must be a finite number.`);
    }

    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      readEffectValue(entry, `${label}[${index}]`),
    );
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(value).sort()) {
      if (!key || /[\u0000-\u001F\u007F]/.test(key)) {
        fail(`${label} contains an invalid effect field name.`);
      }

      result[key] = readEffectValue(
        value[key],
        `${label}.${key}`,
      );
    }

    return result;
  }

  fail(`${label} contains an unsupported effect value.`);
}

function readEffects(
  value: unknown,
  skillID: string,
): Readonly<Record<string, SkillEffectValue>> {
  const source = requireRecord(value, `${skillID}.effects`);
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(source).sort()) {
    if (!key || /[\u0000-\u001F\u007F]/.test(key)) {
      fail(`${skillID}.effects contains an invalid effect field name.`);
    }

    result[key] = readEffectValue(
      source[key],
      `${skillID}.effects.${key}`,
    );
  }

  if (Object.keys(result).length === 0) {
    fail(`${skillID}.effects must not be empty.`);
  }

  return result;
}

function findSkillCatalogPath(): string {
  const candidates = [
    fileURLToPath(new URL("./skills.json", import.meta.url)),
    resolve(process.cwd(), "src", "skills", "skills.json"),
  ];

  const catalogPath = candidates.find(existsSync);

  if (!catalogPath) {
    fail(
      "Skill catalog not found: src/skills/skills.json. Run scripts/export-gdevelop-world.mjs.",
    );
  }

  return catalogPath;
}

function parseJsonFile(filePath: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    fail(`${label} is invalid JSON: ${message}`);
  }
}

function readSkillDefinition(
  skillID: string,
  value: unknown,
): SkillDefinition {
  if (!/^[A-Za-z0-9_-]+$/.test(skillID)) {
    fail(`Skill ID is invalid: ${skillID}.`);
  }

  const source = requireRecord(value, `Skill ${skillID}`);
  const exportedID = requireString(source.id, `${skillID}.id`);

  if (exportedID !== skillID) {
    fail(`${skillID}.id must match its catalog key.`);
  }

  const type = requireString(source.type, `${skillID}.type`).toLowerCase();
  const target = requireString(source.target, `${skillID}.target`).toLowerCase();
  const resourceType = requireString(
    source.resourceType,
    `${skillID}.resourceType`,
  ).toLowerCase();
  const scalingSource = requireRecord(
    source.scaling,
    `${skillID}.scaling`,
  );
  const scalingAttribute = requireString(
    scalingSource.attribute,
    `${skillID}.scaling.attribute`,
  );
  const scalingPerPoint = requireFiniteNumber(
    scalingSource.perPoint,
    `${skillID}.scaling.perPoint`,
  );
  const resourceCost = requireFiniteNumber(
    source.resourceCost,
    `${skillID}.resourceCost`,
  );
  const effects = readEffects(source.effects, skillID);

  if (type === "healing") {
    const healPercentMaxHP = effects.heal_percent_max_hp;

    if (
      typeof healPercentMaxHP !== "number" ||
      healPercentMaxHP <= 0 ||
      healPercentMaxHP > 100
    ) {
      fail(
        `${skillID}.effects.heal_percent_max_hp must be a number greater than 0 and at most 100.`,
      );
    }
  }

  if (resourceType === "none" && resourceCost !== 0) {
    fail(`${skillID}.resourceCost must be 0 when resourceType is none.`);
  }

  if (
    scalingAttribute.toLowerCase() === "none" &&
    scalingPerPoint !== 0
  ) {
    fail(
      `${skillID}.scaling.perPoint must be 0 when scaling.attribute is none.`,
    );
  }

  return {
    availableToAll: requireBoolean(
      source.availableToAll,
      `${skillID}.availableToAll`,
    ),
    castTimeMs: requireInteger(
      source.castTimeMs,
      `${skillID}.castTimeMs`,
    ),
    cooldownMs: requireInteger(
      source.cooldownMs,
      `${skillID}.cooldownMs`,
    ),
    effects,
    enabled: requireBoolean(source.enabled, `${skillID}.enabled`),
    id: skillID,
    loadoutEligible: requireBoolean(
      source.loadoutEligible,
      `${skillID}.loadoutEligible`,
    ),
    nameDisplay: requireString(
      source.nameDisplay,
      `${skillID}.nameDisplay`,
    ),
    resourceCost,
    resourceType,
    scaling: {
      attribute: scalingAttribute,
      perPoint: scalingPerPoint,
    },
    target,
    type,
  };
}

function loadSkillDefinitions(): Readonly<Record<string, SkillDefinition>> {
  const parsed = parseJsonFile(findSkillCatalogPath(), "Skill catalog");
  const catalog = requireRecord(parsed, "Skill catalog");

  if (catalog.catalogSchemaVersion !== SKILL_CATALOG_SCHEMA_VERSION) {
    fail(
      `Unsupported skill catalog schema version: ${String(
        catalog.catalogSchemaVersion,
      )}.`,
    );
  }

  const definitionsSource = requireRecord(
    catalog.definitions,
    "Skill catalog definitions",
  );
  const definitions: Record<string, SkillDefinition> = {};

  for (const skillID of Object.keys(definitionsSource).sort()) {
    definitions[skillID] = readSkillDefinition(
      skillID,
      definitionsSource[skillID],
    );
  }

  const basicHeal = definitions.skill_heal_basic;

  if (
    !basicHeal ||
    !basicHeal.enabled ||
    !basicHeal.availableToAll ||
    basicHeal.loadoutEligible ||
    basicHeal.type !== "healing" ||
    basicHeal.target !== "self"
  ) {
    fail(
      "skill_heal_basic must exist as an enabled universal self-healing skill outside SkillLoadout.",
    );
  }

  if (
    basicHeal.resourceType !== "none" ||
    basicHeal.resourceCost !== 0 ||
    basicHeal.scaling.attribute.toLowerCase() !== "none" ||
    basicHeal.scaling.perPoint !== 0
  ) {
    fail(
      "skill_heal_basic must not use resources or attribute scaling.",
    );
  }

  return Object.freeze(definitions);
}

const skillDefinitions = loadSkillDefinitions();

console.log(
  "[Grandoria] Skill catalog loaded:",
  Object.keys(skillDefinitions),
);

export function getSkillDefinition(
  skillID: string,
): SkillDefinition | undefined {
  return skillDefinitions[skillID];
}

export function getSkillEffectNumber(
  definition: SkillDefinition,
  effectName: string,
): number | undefined {
  const value = definition.effects[effectName];

  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function getSkillDefinitions(): Readonly<Record<string, SkillDefinition>> {
  return skillDefinitions;
}
