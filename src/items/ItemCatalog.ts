import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ItemAttributes = Readonly<Record<string, unknown>>;

export type ItemDefinition = {
  id: string;
  maxStack: number;
  subType: string;
  type: string;
  nameDisplay: string;
  rarity: string;
  sellPrice: number;
  goldPrice?: number;
  gemPrice?: number;
  visualKey: string;
  attributes: ItemAttributes;
};

const ITEM_CATALOG_SCHEMA_VERSION = 1;

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

function findItemCatalogPath(): string {
  const candidates = [
    fileURLToPath(new URL("./items.json", import.meta.url)),
    resolve(process.cwd(), "src", "items", "items.json"),
  ];

  const catalogPath = candidates.find(existsSync);

  if (!catalogPath) {
    fail(
      "Item catalog not found: src/items/items.json. Run scripts/export-gdevelop-world.mjs.",
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

function readAttributeValue(
  value: unknown,
  label: string,
): unknown {
  if (typeof value === "string" || typeof value === "boolean") {
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
      readAttributeValue(entry, `${label}[${index}]`),
    );
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(value).sort()) {
      if (!key || /[\u0000-\u001F\u007F]/.test(key)) {
        fail(`${label} contains an invalid attribute name.`);
      }

      result[key] = readAttributeValue(value[key], `${label}.${key}`);
    }

    return result;
  }

  fail(`${label} contains an unsupported attribute value.`);
}

function readAttributes(
  value: unknown,
  itemID: string,
): ItemAttributes {
  const source = requireRecord(value, `${itemID}.attributes`);
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(source).sort()) {
    if (!key || /[\u0000-\u001F\u007F]/.test(key)) {
      fail(`${itemID}.attributes contains an invalid attribute name.`);
    }

    result[key] = readAttributeValue(
      source[key],
      `${itemID}.attributes.${key}`,
    );
  }

  return result;
}

function readOptionalPrice(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireFiniteNumber(value, label);
}

function readItemDefinition(
  itemID: string,
  value: unknown,
): ItemDefinition {
  if (!/^[A-Za-z0-9_-]+$/.test(itemID)) {
    fail(`Item ID is invalid: ${itemID}.`);
  }

  const source = requireRecord(value, `Item ${itemID}`);
  const exportedID = requireString(source.id, `${itemID}.id`);

  if (exportedID !== itemID) {
    fail(`${itemID}.id must match its catalog key.`);
  }

  const goldPrice = readOptionalPrice(
    source.goldPrice,
    `${itemID}.goldPrice`,
  );
  const gemPrice = readOptionalPrice(
    source.gemPrice,
    `${itemID}.gemPrice`,
  );

  return {
    id: itemID,
    maxStack: requireInteger(source.maxStack, `${itemID}.maxStack`, 1),
    subType: requireString(source.subType, `${itemID}.subType`),
    type: requireString(source.type, `${itemID}.type`),
    nameDisplay: requireString(source.nameDisplay, `${itemID}.nameDisplay`),
    rarity: requireString(source.rarity, `${itemID}.rarity`),
    sellPrice: requireFiniteNumber(source.sellPrice, `${itemID}.sellPrice`),
    ...(goldPrice !== undefined ? { goldPrice } : {}),
    ...(gemPrice !== undefined ? { gemPrice } : {}),
    visualKey: requireString(source.visualKey, `${itemID}.visualKey`),
    attributes: readAttributes(source.attributes, itemID),
  };
}

function loadItemDefinitions(): Readonly<Record<string, ItemDefinition>> {
  const parsed = parseJsonFile(findItemCatalogPath(), "Item catalog");
  const catalog = requireRecord(parsed, "Item catalog");

  if (catalog.catalogSchemaVersion !== ITEM_CATALOG_SCHEMA_VERSION) {
    fail(
      `Unsupported item catalog schema version: ${String(
        catalog.catalogSchemaVersion,
      )}.`,
    );
  }

  const definitionsSource = requireRecord(
    catalog.definitions,
    "Item catalog definitions",
  );
  const definitions: Record<string, ItemDefinition> = {};

  for (const itemID of Object.keys(definitionsSource).sort()) {
    definitions[itemID] = readItemDefinition(
      itemID,
      definitionsSource[itemID],
    );
  }

  if (Object.keys(definitions).length === 0) {
    fail("Item catalog contains no definitions.");
  }

  console.log("[Grandoria] Item catalog loaded:", Object.keys(definitions));

  return definitions;
}

export const ITEM_DEFINITIONS = loadItemDefinitions();

export function getItemDefinition(itemID: string): ItemDefinition | undefined {
  if (!Object.prototype.hasOwnProperty.call(ITEM_DEFINITIONS, itemID)) {
    return undefined;
  }

  return ITEM_DEFINITIONS[itemID];
}

export function getItemIDs(): readonly string[] {
  return Object.keys(ITEM_DEFINITIONS);
}
