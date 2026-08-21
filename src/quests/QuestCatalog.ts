import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getItemIDs } from "../items/ItemCatalog.js";
import { getMonsterTypes } from "../config/MonsterCatalog.js";
import {
  getWorldQuestNpcIds,
  getWorldQuestRegionIds,
} from "../world/WorldQuestContext.js";
import {
  QUEST_CATALOG_SCHEMA_VERSION,
  QUEST_OBJECTIVE_TYPES,
  type QuestDefinition,
  type QuestDialogue,
  type QuestObjectiveDefinition,
  type QuestObjectiveType,
  type QuestRewards,
} from "./QuestTypes.js";

type UnknownRecord = Record<string, unknown>;

export type QuestCatalogValidationContext = {
  itemIds: ReadonlySet<string>;
  monsterIds: ReadonlySet<string>;
  npcIds: ReadonlySet<string>;
  regionIds: ReadonlySet<string>;
};

function fail(message: string): never {
  throw new Error(`[Grandoria] ${message}`);
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) {
    fail(`${label} must be an object.`);
  }

  return value;
}

function requireString(
  value: unknown,
  label: string,
  allowEmpty = false,
): string {
  if (typeof value !== "string") {
    fail(`${label} must be a string.`);
  }

  const result = value.trim();

  if ((!allowEmpty && result === "") || /[\u0000-\u001F\u007F]/.test(result)) {
    fail(`${label} must be ${allowEmpty ? "a valid" : "a non-empty"} string.`);
  }

  return result;
}

function requireId(value: unknown, label: string, allowEmpty = false): string {
  const result = requireString(value, label, allowEmpty);

  if (result === "" && allowEmpty) {
    return result;
  }

  if (!/^[A-Za-z0-9_-]+$/.test(result)) {
    fail(`${label} must contain only letters, numbers, underscores, and hyphens.`);
  }

  return result;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${label} must be boolean.`);
  }

  return value;
}

function requireInteger(value: unknown, label: string, minimum = 0): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    fail(`${label} must be an integer >= ${minimum}.`);
  }

  return value;
}

function readIdArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array.`);
  }

  const seen = new Set<string>();
  const result: string[] = [];

  value.forEach((entry, index) => {
    const id = requireId(entry, `${label}[${index}]`);

    if (seen.has(id)) {
      fail(`${label} contains duplicate ID ${id}.`);
    }

    seen.add(id);
    result.push(id);
  });

  return Object.freeze(result);
}

function readDialogue(value: unknown, questId: string): QuestDialogue {
  const source = requireRecord(value, `${questId}.dialogue`);

  return Object.freeze({
    offer: requireString(source.offer, `${questId}.dialogue.offer`, true),
    active: requireString(source.active, `${questId}.dialogue.active`, true),
    ready: requireString(source.ready, `${questId}.dialogue.ready`, true),
    completed: requireString(
      source.completed,
      `${questId}.dialogue.completed`,
      true,
    ),
  });
}

function readObjectives(
  value: unknown,
  questId: string,
  context: QuestCatalogValidationContext,
): readonly QuestObjectiveDefinition[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${questId}.objectives must contain at least one objective.`);
  }

  const seenIds = new Set<string>();
  const result = value.map((entry, index) => {
    const source = requireRecord(entry, `${questId}.objectives[${index}]`);
    const id = requireId(source.id, `${questId}.objectives[${index}].id`);

    if (seenIds.has(id)) {
      fail(`${questId}.objectives contains duplicate objective ID ${id}.`);
    }

    seenIds.add(id);

    const type = requireString(
      source.type,
      `${questId}.objectives.${id}.type`,
    ) as QuestObjectiveType;

    if (!QUEST_OBJECTIVE_TYPES.includes(type)) {
      fail(`${questId}.objectives.${id}.type is unknown: ${type}.`);
    }

    const targetId = requireId(
      source.targetId,
      `${questId}.objectives.${id}.targetId`,
    );
    const quantity = requireInteger(
      source.quantity,
      `${questId}.objectives.${id}.quantity`,
      1,
    );
    const order = requireInteger(
      source.order,
      `${questId}.objectives.${id}.order`,
      0,
    );

    if (type === "talk" && !context.npcIds.has(targetId)) {
      fail(`${questId}.objectives.${id} references unknown NPC ${targetId}.`);
    }
    if (type === "kill" && !context.monsterIds.has(targetId)) {
      fail(`${questId}.objectives.${id} references unknown monster ${targetId}.`);
    }
    if ((type === "collect" || type === "deliver") && !context.itemIds.has(targetId)) {
      fail(`${questId}.objectives.${id} references unknown item ${targetId}.`);
    }
    if (type === "explore" && !context.regionIds.has(targetId)) {
      fail(`${questId}.objectives.${id} references unknown region ${targetId}.`);
    }

    return Object.freeze({ id, type, targetId, quantity, order });
  });

  result.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  return Object.freeze(result);
}

function readRewards(
  value: unknown,
  questId: string,
  context: QuestCatalogValidationContext,
): QuestRewards {
  const source = requireRecord(value, `${questId}.rewards`);
  const rawItems = source.items;

  if (!Array.isArray(rawItems)) {
    fail(`${questId}.rewards.items must be an array.`);
  }

  const items = rawItems.map((entry, index) => {
    const item = requireRecord(entry, `${questId}.rewards.items[${index}]`);
    const itemId = requireId(
      item.itemId,
      `${questId}.rewards.items[${index}].itemId`,
    );

    if (!context.itemIds.has(itemId)) {
      fail(`${questId}.rewards.items references unknown item ${itemId}.`);
    }

    return Object.freeze({
      itemId,
      quantity: requireInteger(
        item.quantity,
        `${questId}.rewards.items[${index}].quantity`,
        1,
      ),
    });
  });

  return Object.freeze({
    xp: requireInteger(source.xp, `${questId}.rewards.xp`, 0),
    gold: requireInteger(source.gold, `${questId}.rewards.gold`, 0),
    gem: requireInteger(source.gem, `${questId}.rewards.gem`, 0),
    items: Object.freeze(items),
  });
}

function readDefinition(
  catalogKey: string,
  value: unknown,
  context: QuestCatalogValidationContext,
): QuestDefinition {
  const source = requireRecord(value, `Quest ${catalogKey}`);
  const questId = requireId(source.questId, `${catalogKey}.questId`);

  if (questId !== catalogKey) {
    fail(`Quest catalog key ${catalogKey} does not match questId ${questId}.`);
  }

  const offerNpcId = requireId(source.offerNpcId, `${questId}.offerNpcId`);

  if (!context.npcIds.has(offerNpcId)) {
    fail(`${questId}.offerNpcId references unknown NPC ${offerNpcId}.`);
  }

  const turnInSource = requireRecord(source.turnIn, `${questId}.turnIn`);
  const turnInType = requireString(turnInSource.type, `${questId}.turnIn.type`);

  if (turnInType !== "npc" && turnInType !== "auto") {
    fail(`${questId}.turnIn.type must be npc or auto.`);
  }

  const turnInTargetId = requireId(
    turnInSource.targetId,
    `${questId}.turnIn.targetId`,
    turnInType === "auto",
  );

  if (turnInType === "npc" && !context.npcIds.has(turnInTargetId)) {
    fail(`${questId}.turnIn.targetId references unknown NPC ${turnInTargetId}.`);
  }

  const initialState = requireString(
    source.initialState,
    `${questId}.initialState`,
  );

  if (initialState !== "locked" && initialState !== "available") {
    fail(`${questId}.initialState must be locked or available.`);
  }

  const creditSource = requireRecord(source.credit, `${questId}.credit`);
  const creditMode = requireString(creditSource.mode, `${questId}.credit.mode`);

  if (creditMode !== "solo") {
    fail(`${questId}.credit.mode currently supports only solo.`);
  }

  return Object.freeze({
    questId,
    title: requireString(source.title, `${questId}.title`),
    description: requireString(source.description, `${questId}.description`),
    offerNpcId,
    turnIn: Object.freeze({
      type: turnInType,
      targetId: turnInTargetId,
    }),
    prerequisites: readIdArray(source.prerequisites, `${questId}.prerequisites`),
    objectives: readObjectives(source.objectives, questId, context),
    rewards: readRewards(source.rewards, questId, context),
    nextQuestId: requireId(source.nextQuestId, `${questId}.nextQuestId`, true),
    repeatable: requireBoolean(source.repeatable, `${questId}.repeatable`),
    initialState,
    dialogue: readDialogue(source.dialogue, questId),
    trackingAllowed: requireBoolean(
      source.trackingAllowed,
      `${questId}.trackingAllowed`,
    ),
    credit: Object.freeze({ mode: "solo" as const }),
  });
}

function assertReferencesAndCycles(definitions: ReadonlyMap<string, QuestDefinition>) {
  for (const definition of definitions.values()) {
    for (const prerequisite of definition.prerequisites) {
      if (!definitions.has(prerequisite)) {
        fail(`${definition.questId} references missing prerequisite ${prerequisite}.`);
      }
      if (prerequisite === definition.questId) {
        fail(`${definition.questId} cannot require itself.`);
      }
    }

    if (definition.nextQuestId) {
      if (!definitions.has(definition.nextQuestId)) {
        fail(`${definition.questId} references missing nextQuestId ${definition.nextQuestId}.`);
      }
      if (definition.nextQuestId === definition.questId) {
        fail(`${definition.questId} cannot point to itself as nextQuestId.`);
      }
    }
  }

  const visitGraph = (
    graphName: string,
    edgesFor: (definition: QuestDefinition) => readonly string[],
  ) => {
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (questId: string) => {
      if (visited.has(questId)) return;
      if (visiting.has(questId)) {
        fail(`Quest ${graphName} contains a cycle involving ${questId}.`);
      }

      visiting.add(questId);
      const definition = definitions.get(questId);

      if (definition) {
        for (const nextId of edgesFor(definition)) {
          visit(nextId);
        }
      }

      visiting.delete(questId);
      visited.add(questId);
    };

    for (const questId of definitions.keys()) {
      visit(questId);
    }
  };

  visitGraph("prerequisites", (definition) => definition.prerequisites);
  visitGraph("chain", (definition) =>
    definition.nextQuestId ? [definition.nextQuestId] : [],
  );
}

export function parseQuestCatalog(
  value: unknown,
  context: QuestCatalogValidationContext,
): ReadonlyMap<string, QuestDefinition> {
  const document = requireRecord(value, "Quest catalog");

  if (document.catalogSchemaVersion !== QUEST_CATALOG_SCHEMA_VERSION) {
    fail(
      `Unsupported quest catalog schema version: ${String(
        document.catalogSchemaVersion,
      )}.`,
    );
  }

  const source = requireRecord(document.definitions, "Quest catalog definitions");
  const definitions = new Map<string, QuestDefinition>();

  for (const questId of Object.keys(source).sort()) {
    if (!/^[A-Za-z0-9_-]+$/.test(questId)) {
      fail(`Quest ID is invalid: ${questId}.`);
    }

    if (definitions.has(questId)) {
      fail(`Duplicate quest ID: ${questId}.`);
    }

    definitions.set(questId, readDefinition(questId, source[questId], context));
  }

  assertReferencesAndCycles(definitions);
  return definitions;
}

function findQuestCatalogPath(): string {
  const candidates = [
    fileURLToPath(new URL("./quests.json", import.meta.url)),
    resolve(process.cwd(), "src", "quests", "quests.json"),
  ];
  const path = candidates.find(existsSync);

  if (!path) {
    fail("Quest catalog not found: src/quests/quests.json. Run the exporter.");
  }

  return path;
}

function loadQuestDefinitions(): ReadonlyMap<string, QuestDefinition> {
  const catalogPath = findQuestCatalogPath();
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(catalogPath, "utf8"));
  } catch (error) {
    fail(
      `Quest catalog is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const definitions = parseQuestCatalog(parsed, {
    itemIds: new Set(getItemIDs()),
    monsterIds: new Set(getMonsterTypes()),
    npcIds: new Set(getWorldQuestNpcIds()),
    regionIds: new Set(getWorldQuestRegionIds()),
  });

  console.log("[Grandoria] Quest catalog loaded:", [...definitions.keys()]);
  return definitions;
}

export const QUEST_DEFINITIONS = loadQuestDefinitions();

export function getQuestDefinition(questId: string): QuestDefinition | undefined {
  return QUEST_DEFINITIONS.get(questId);
}

export function getQuestDefinitions(): readonly QuestDefinition[] {
  return [...QUEST_DEFINITIONS.values()];
}
