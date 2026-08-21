import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type WorldQuestNpc = {
  id: string;
  displayName: string;
  mapId: string;
  objectName: string;
  x: number;
  y: number;
  interactionRadius: number;
};

export type WorldQuestRegion = {
  id: string;
  displayName: string;
  regionType: "safe" | "hostile";
  accessQuestId: string;
  associatedQuestId: string;
  musicKey: string;
  pointOfInterestIds: readonly string[];
  mapId: string;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  sourceObjectName: string;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findArtifactPath(): string {
  const candidates = [
    fileURLToPath(new URL("./maps/MAP_1.world.json", import.meta.url)),
    resolve(process.cwd(), "src", "world", "maps", "MAP_1.world.json"),
  ];
  const path = candidates.find(existsSync);

  if (!path) {
    throw new Error(
      "[Grandoria] World quest context missing: src/world/maps/MAP_1.world.json.",
    );
  }

  return path;
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`[Grandoria] ${label} must be a finite number.`);
  }

  return value;
}

function readId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`[Grandoria] ${label} must be a canonical ID.`);
  }

  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`[Grandoria] ${label} must be a non-empty string.`);
  }

  return value.trim();
}

function readOptionalString(value: unknown, label: string): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (typeof value !== "string" || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`[Grandoria] ${label} must be a valid string.`);
  }

  return value.trim();
}

function readIdList(value: unknown, label: string): readonly string[] {
  if (value === undefined || value === null) {
    return Object.freeze([]);
  }

  if (!Array.isArray(value)) {
    throw new Error(`[Grandoria] ${label} must be an array.`);
  }

  const seen = new Set<string>();
  const result = value.map((entry, index) => {
    const id = readId(entry, `${label}[${index}]`);

    if (seen.has(id)) {
      throw new Error(`[Grandoria] ${label} contains duplicate ID ${id}.`);
    }

    seen.add(id);
    return id;
  });

  return Object.freeze(result);
}

function readRegionType(value: unknown, label: string): "safe" | "hostile" {
  const type = value === undefined || value === null || value === ""
    ? "hostile"
    : readString(value, label);

  if (type !== "safe" && type !== "hostile") {
    throw new Error(`[Grandoria] ${label} must be safe or hostile.`);
  }

  return type;
}

function readBounds(value: unknown, label: string): WorldQuestRegion["bounds"] {
  if (!isRecord(value)) {
    throw new Error(`[Grandoria] ${label} must be an object.`);
  }

  const bounds = {
    minX: readFiniteNumber(value.minX, `${label}.minX`),
    maxX: readFiniteNumber(value.maxX, `${label}.maxX`),
    minY: readFiniteNumber(value.minY, `${label}.minY`),
    maxY: readFiniteNumber(value.maxY, `${label}.maxY`),
  };

  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
    throw new Error(`[Grandoria] ${label} has inverted bounds.`);
  }

  return bounds;
}

function loadWorldQuestContext(): {
  npcs: ReadonlyMap<string, WorldQuestNpc>;
  regions: ReadonlyMap<string, WorldQuestRegion>;
} {
  const parsed: unknown = JSON.parse(readFileSync(findArtifactPath(), "utf8"));

  if (!isRecord(parsed)) {
    throw new Error("[Grandoria] World artifact must be an object.");
  }

  const mapId = readString(parsed.mapId, "World artifact mapId");
  const npcs = new Map<string, WorldQuestNpc>();
  const regions = new Map<string, WorldQuestRegion>();
  const rawNpcs = Array.isArray(parsed.npcs) ? parsed.npcs : [];

  for (const [index, rawNpc] of rawNpcs.entries()) {
    if (!isRecord(rawNpc)) {
      throw new Error(`[Grandoria] World NPC ${index} must be an object.`);
    }

    const id = readId(rawNpc.id, `World NPC ${index}.id`);

    if (npcs.has(id)) {
      throw new Error(`[Grandoria] Duplicate world NPC ID: ${id}.`);
    }

    npcs.set(id, {
      id,
      displayName: readString(rawNpc.displayName ?? id, `${id}.displayName`),
      mapId: readString(rawNpc.mapId ?? mapId, `${id}.mapId`),
      objectName: readString(rawNpc.objectName, `${id}.objectName`),
      x: readFiniteNumber(rawNpc.x, `${id}.x`),
      y: readFiniteNumber(rawNpc.y, `${id}.y`),
      interactionRadius: Math.max(
        1,
        readFiniteNumber(rawNpc.interactionRadius, `${id}.interactionRadius`),
      ),
    });
  }

  const rawQuestRegions = Array.isArray(parsed.questRegions)
    ? parsed.questRegions
    : [];

  for (const [index, rawRegion] of rawQuestRegions.entries()) {
    if (!isRecord(rawRegion)) {
      throw new Error(`[Grandoria] Quest region ${index} must be an object.`);
    }

    const id = readId(rawRegion.id, `Quest region ${index}.id`);

    if (regions.has(id)) {
      throw new Error(`[Grandoria] Duplicate quest region ID: ${id}.`);
    }

    regions.set(id, {
      id,
      displayName: readString(rawRegion.displayName ?? id, `${id}.displayName`),
      regionType: readRegionType(rawRegion.regionType, `${id}.regionType`),
      accessQuestId: readOptionalString(rawRegion.accessQuestId, `${id}.accessQuestId`),
      associatedQuestId: readOptionalString(
        rawRegion.associatedQuestId,
        `${id}.associatedQuestId`,
      ),
      musicKey: readOptionalString(rawRegion.musicKey, `${id}.musicKey`),
      pointOfInterestIds: readIdList(
        rawRegion.pointOfInterestIds,
        `${id}.pointOfInterestIds`,
      ),
      mapId: readString(rawRegion.mapId ?? mapId, `${id}.mapId`),
      bounds: readBounds(rawRegion.bounds, `${id}.bounds`),
      sourceObjectName: readString(
        rawRegion.sourceObjectName ?? "QuestRegion",
        `${id}.sourceObjectName`,
      ),
    });
  }

  const rawSpawnRegions = Array.isArray(parsed.spawnRegions)
    ? parsed.spawnRegions
    : [];

  for (const [index, rawRegion] of rawSpawnRegions.entries()) {
    if (!isRecord(rawRegion)) {
      continue;
    }

    const id = readId(rawRegion.id, `Spawn region ${index}.id`);

    if (regions.has(id)) {
      continue;
    }

    regions.set(id, {
      id,
      displayName: id,
      regionType: "hostile",
      accessQuestId: "",
      associatedQuestId: "",
      musicKey: "",
      pointOfInterestIds: Object.freeze([]),
      mapId: readString(rawRegion.mapId ?? mapId, `${id}.mapId`),
      bounds: readBounds(rawRegion.bounds, `${id}.bounds`),
      sourceObjectName: readString(
        isRecord(rawRegion.source) ? rawRegion.source.objectName : "spawn_region",
        `${id}.sourceObjectName`,
      ),
    });
  }

  console.log("[Grandoria] World quest context loaded:", {
    npcCount: npcs.size,
    regionCount: regions.size,
  });

  return { npcs, regions };
}

const WORLD_QUEST_CONTEXT = loadWorldQuestContext();

export function getWorldQuestNpc(npcId: string): WorldQuestNpc | undefined {
  return WORLD_QUEST_CONTEXT.npcs.get(npcId);
}

export function getWorldQuestRegion(
  regionId: string,
): WorldQuestRegion | undefined {
  return WORLD_QUEST_CONTEXT.regions.get(regionId);
}

export function getWorldQuestNpcIds(): readonly string[] {
  return [...WORLD_QUEST_CONTEXT.npcs.keys()].sort();
}

export function getWorldQuestRegionIds(): readonly string[] {
  return [...WORLD_QUEST_CONTEXT.regions.keys()].sort();
}

export function isPointInsideWorldQuestRegion(
  region: WorldQuestRegion,
  mapId: string,
  x: number,
  y: number,
): boolean {
  return (
    region.mapId === mapId &&
    x >= region.bounds.minX &&
    x <= region.bounds.maxX &&
    y >= region.bounds.minY &&
    y <= region.bounds.maxY
  );
}
