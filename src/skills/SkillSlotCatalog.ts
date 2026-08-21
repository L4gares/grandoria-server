import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  resolve,
} from "node:path";
import {
  fileURLToPath,
} from "node:url";

export type SkillSlotDefinition = Readonly<{
  slotId: string;
  enabled: boolean;
  inputAction: string;
  order: number;
}>;

type SkillSlotCatalogData = {
  schemaVersion: number;
  slots: Record<string, SkillSlotDefinition>;
};

const SKILL_SLOT_CATALOG_SCHEMA_VERSION = 1;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`[Grandoria] ${message}`);
}

function findSkillSlotCatalogPath(): string {
  const candidates = [
    fileURLToPath(
      new URL("./skill-slots.json", import.meta.url),
    ),
    resolve(
      process.cwd(),
      "src",
      "skills",
      "skill-slots.json",
    ),
  ];

  const catalogPath = candidates.find(existsSync);

  if (!catalogPath) {
    fail(
      "Skill slot catalog not found: src/skills/skill-slots.json. " +
        "Run export-gdevelop-world.mjs first.",
    );
  }

  return catalogPath;
}

function readCatalogFile(): unknown {
  const catalogPath = findSkillSlotCatalogPath();

  try {
    return JSON.parse(readFileSync(catalogPath, "utf8"));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    fail(`Skill slot catalog is malformed JSON: ${message}`);
  }
}

function requireString(
  value: unknown,
  label: string,
): string {
  if (typeof value !== "string") {
    fail(`${label} must be a string.`);
  }

  return value;
}

function requireBoolean(
  value: unknown,
  label: string,
): boolean {
  if (typeof value !== "boolean") {
    fail(`${label} must be boolean.`);
  }

  return value;
}

function requirePositiveInteger(
  value: unknown,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    fail(`${label} must be a positive integer.`);
  }

  return value;
}

function loadSkillSlotCatalog(): SkillSlotCatalogData {
  const rawCatalog = readCatalogFile();

  if (!isRecord(rawCatalog)) {
    fail("Skill slot catalog root must be an object.");
  }

  if (
    rawCatalog.schemaVersion !==
    SKILL_SLOT_CATALOG_SCHEMA_VERSION
  ) {
    fail(
      `Unsupported skill slot catalog schema version: ` +
        `${String(rawCatalog.schemaVersion)}.`,
    );
  }

  if (!isRecord(rawCatalog.slots)) {
    fail("Skill slot catalog slots must be an object.");
  }

  const slots: Record<string, SkillSlotDefinition> = {};
  const seenOrders = new Set<number>();

  for (
    const [slotId, rawDefinition]
    of Object.entries(rawCatalog.slots)
  ) {
    if (!/^[a-z0-9_-]+$/.test(slotId)) {
      fail(
        `Skill slot ID ${slotId} must use only lowercase letters, ` +
          "numbers, _ or -.",
      );
    }

    if (!isRecord(rawDefinition)) {
      fail(`Skill slot ${slotId} must be an object.`);
    }

    const persistedSlotId = requireString(
      rawDefinition.slotId,
      `${slotId}.slotId`,
    );

    if (persistedSlotId !== slotId) {
      fail(
        `${slotId}.slotId must match its catalog key.`,
      );
    }

    const enabled = requireBoolean(
      rawDefinition.enabled,
      `${slotId}.enabled`,
    );

    const inputAction = requireString(
      rawDefinition.inputAction,
      `${slotId}.inputAction`,
    ).trim();

    if (
      inputAction &&
      !/^[A-Za-z][A-Za-z0-9_-]*$/.test(inputAction)
    ) {
      fail(
        `${slotId}.inputAction must be empty or use only letters, ` +
          "numbers, _ or -.",
      );
    }

    const order = requirePositiveInteger(
      rawDefinition.order,
      `${slotId}.order`,
    );

    if (seenOrders.has(order)) {
      fail(`Duplicate skill slot order: ${order}.`);
    }

    seenOrders.add(order);

    slots[slotId] = Object.freeze({
      slotId,
      enabled,
      inputAction,
      order,
    });
  }

  if (Object.keys(slots).length === 0) {
    fail("Skill slot catalog contains no slots.");
  }

  return {
    schemaVersion: SKILL_SLOT_CATALOG_SCHEMA_VERSION,
    slots,
  };
}

const catalog = loadSkillSlotCatalog();

const orderedDefinitions = Object.freeze(
  Object.values(catalog.slots)
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }

      return left.slotId.localeCompare(right.slotId);
    }),
);

console.log(
  "[Grandoria] Skill slot catalog loaded:",
  orderedDefinitions.map((definition) => definition.slotId),
);

export function getSkillSlotDefinitions():
  readonly SkillSlotDefinition[] {
  return orderedDefinitions;
}

export function getSkillSlotDefinition(
  slotId: string,
): SkillSlotDefinition | undefined {
  return catalog.slots[slotId];
}
