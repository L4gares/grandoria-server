import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Point = {
  x: number;
  y: number;
};

type Aabb = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type Polygon = Point[];

type WorldCollider = {
  collisionChannels: string[];
  geometry: {
    aabb: Aabb;
    worldPolygons: Polygon[];
  };
  id: string;
};

type WorldArtifact = {
  anchors: {
    recoveryEntries: Array<{
      mapId: string;
      x: number;
      y: number;
    }>;
  };
  artifactSchemaVersion: number;
  bodyProfiles: Array<{
    id: string;
    movementBody: {
      originRelativePolygons: Polygon[];
    };
  }>;
  colliders: WorldCollider[];
  mapId: string;
};

type WorldBody = {
  aabb: Aabb;
  polygons: Polygon[];
};

type CollisionBodyProfile = {
  localAabb: Aabb;
  localPolygons: Polygon[];
};

type CollisionWorld = {
  bodyProfiles: Map<string, CollisionBodyProfile>;
  collidersByChannel: Map<string, Map<string, WorldCollider[]>>;
  mapId: string;
  recovery: Point;
};

export type MovementResolution = {
  blockedX: boolean;
  blockedY: boolean;
  x: number;
  y: number;
};

export type PlayerMovementResolution = MovementResolution;

export type MonsterMovementResolution = MovementResolution;

export type PlayerSpawnResolution = {
  recovered: boolean;
  x: number;
  y: number;
};

const ARTIFACT_SCHEMA_VERSION = 1;
const DEFAULT_MAP_ID = "MAP_1";
const GEOMETRY_EPSILON = 1e-9;
const MAX_MOVEMENT_SUBSTEP = 0.5;
const MONSTER_COLLISION_CHANNEL = "monster";
const PLAYER_BODY_PROFILE_ID = "character";
const PLAYER_COLLISION_CHANNEL = "player";
const SPATIAL_CELL_SIZE = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function isFiniteAabb(value: unknown): value is Aabb {
  return (
    isRecord(value) &&
    typeof value.minX === "number" &&
    Number.isFinite(value.minX) &&
    typeof value.maxX === "number" &&
    Number.isFinite(value.maxX) &&
    typeof value.minY === "number" &&
    Number.isFinite(value.minY) &&
    typeof value.maxY === "number" &&
    Number.isFinite(value.maxY) &&
    value.minX <= value.maxX &&
    value.minY <= value.maxY
  );
}

function assertPolygon(value: unknown, label: string): asserts value is Polygon {
  if (!Array.isArray(value) || value.length < 3 || !value.every(isFinitePoint)) {
    throw new Error(`[Grandoria] Invalid polygon in ${label}.`);
  }
}

function calculateAabb(polygons: Polygon[]): Aabb {
  const points = polygons.flat();

  if (points.length === 0) {
    throw new Error("[Grandoria] Cannot calculate an empty collision body.");
  }

  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function cellRange(minimum: number, maximum: number): [number, number] {
  return [
    Math.floor(minimum / SPATIAL_CELL_SIZE),
    Math.floor(maximum / SPATIAL_CELL_SIZE),
  ];
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function indexColliders(colliders: WorldCollider[]): Map<string, WorldCollider[]> {
  const index = new Map<string, WorldCollider[]>();

  for (const collider of colliders) {
    const [minCellX, maxCellX] = cellRange(
      collider.geometry.aabb.minX,
      collider.geometry.aabb.maxX,
    );
    const [minCellY, maxCellY] = cellRange(
      collider.geometry.aabb.minY,
      collider.geometry.aabb.maxY,
    );

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const key = cellKey(cellX, cellY);
        const entries = index.get(key);

        if (entries) {
          entries.push(collider);
        } else {
          index.set(key, [collider]);
        }
      }
    }
  }

  return index;
}

function findMapArtifactPath(fileName: string): string {
  const candidates = [
    fileURLToPath(new URL(`./maps/${fileName}`, import.meta.url)),
    resolve(process.cwd(), "src", "world", "maps", fileName),
  ];

  const artifactPath = candidates.find(existsSync);

  if (!artifactPath) {
    throw new Error(
      `[Grandoria] World artifact not found: src/world/maps/${fileName}.`,
    );
  }

  return artifactPath;
}

function loadCollisionWorld(fileName: string): CollisionWorld {
  const artifactPath = findMapArtifactPath(fileName);
  const parsed: unknown = JSON.parse(readFileSync(artifactPath, "utf8"));

  if (!isRecord(parsed)) {
    throw new Error(`[Grandoria] Invalid world artifact: ${fileName}.`);
  }

  const artifact = parsed as unknown as WorldArtifact;

  if (
    artifact.artifactSchemaVersion !== ARTIFACT_SCHEMA_VERSION ||
    typeof artifact.mapId !== "string" ||
    !Array.isArray(artifact.bodyProfiles) ||
    !Array.isArray(artifact.colliders) ||
    !isRecord(artifact.anchors) ||
    !Array.isArray(artifact.anchors.recoveryEntries)
  ) {
    throw new Error(`[Grandoria] Unsupported world artifact: ${fileName}.`);
  }

  const bodyProfiles = new Map<string, CollisionBodyProfile>();

  artifact.bodyProfiles.forEach((profile, profileIndex) => {
    if (
      !isRecord(profile) ||
      typeof profile.id !== "string" ||
      !isRecord(profile.movementBody) ||
      !Array.isArray(profile.movementBody.originRelativePolygons)
    ) {
      throw new Error(
        `[Grandoria] Invalid body profile ${profileIndex} in ${fileName}.`,
      );
    }

    const localPolygons = profile.movementBody.originRelativePolygons;

    localPolygons.forEach((polygon, polygonIndex) => {
      assertPolygon(
        polygon,
        `${fileName} body profile ${profile.id}:${polygonIndex}`,
      );
    });

    bodyProfiles.set(profile.id, {
      localAabb: calculateAabb(localPolygons),
      localPolygons,
    });
  });

  if (!bodyProfiles.has(PLAYER_BODY_PROFILE_ID)) {
    throw new Error(
      `[Grandoria] Player body profile is missing from ${fileName}.`,
    );
  }

  const colliders = artifact.colliders.filter((collider, index) => {
    if (
      !isRecord(collider) ||
      typeof collider.id !== "string" ||
      !Array.isArray(collider.collisionChannels) ||
      !isRecord(collider.geometry) ||
      !isFiniteAabb(collider.geometry.aabb) ||
      !Array.isArray(collider.geometry.worldPolygons)
    ) {
      throw new Error(`[Grandoria] Invalid collider ${index} in ${fileName}.`);
    }

    collider.geometry.worldPolygons.forEach((polygon, polygonIndex) => {
      assertPolygon(polygon, `${fileName} collider ${index}:${polygonIndex}`);
    });

    return true;
  });

  const collidersByChannel = new Map<
    string,
    Map<string, WorldCollider[]>
  >();

  const collisionChannels = new Set(
    colliders.flatMap((collider) => collider.collisionChannels),
  );

  for (const collisionChannel of collisionChannels) {
    collidersByChannel.set(
      collisionChannel,
      indexColliders(
        colliders.filter((collider) =>
          collider.collisionChannels.includes(collisionChannel),
        ),
      ),
    );
  }

  if (!collidersByChannel.has(PLAYER_COLLISION_CHANNEL)) {
    throw new Error(
      `[Grandoria] Player collision channel is missing from ${fileName}.`,
    );
  }

  const recoveryEntry = artifact.anchors.recoveryEntries.find(
    (entry) =>
      entry.mapId === artifact.mapId &&
      Number.isFinite(entry.x) &&
      Number.isFinite(entry.y),
  );

  if (!recoveryEntry) {
    throw new Error(`[Grandoria] Recovery entry is missing from ${fileName}.`);
  }

  return {
    bodyProfiles,
    collidersByChannel,
    mapId: artifact.mapId,
    recovery: {
      x: recoveryEntry.x,
      y: recoveryEntry.y,
    },
  };
}

function translateBody(
  bodyProfile: CollisionBodyProfile,
  x: number,
  y: number,
): WorldBody {
  return {
    aabb: {
      minX: x + bodyProfile.localAabb.minX,
      maxX: x + bodyProfile.localAabb.maxX,
      minY: y + bodyProfile.localAabb.minY,
      maxY: y + bodyProfile.localAabb.maxY,
    },
    polygons: bodyProfile.localPolygons.map((polygon) =>
      polygon.map((point) => ({
        x: x + point.x,
        y: y + point.y,
      })),
    ),
  };
}

function orientation(first: Point, second: Point, third: Point): number {
  const value =
    (second.y - first.y) * (third.x - second.x) -
    (second.x - first.x) * (third.y - second.y);

  if (Math.abs(value) <= GEOMETRY_EPSILON) {
    return 0;
  }

  return value > 0 ? 1 : 2;
}

function pointOnSegment(first: Point, point: Point, second: Point): boolean {
  return (
    point.x <= Math.max(first.x, second.x) + GEOMETRY_EPSILON &&
    point.x >= Math.min(first.x, second.x) - GEOMETRY_EPSILON &&
    point.y <= Math.max(first.y, second.y) + GEOMETRY_EPSILON &&
    point.y >= Math.min(first.y, second.y) - GEOMETRY_EPSILON &&
    orientation(first, point, second) === 0
  );
}

function segmentsIntersect(
  firstA: Point,
  firstB: Point,
  secondA: Point,
  secondB: Point,
): boolean {
  const firstOrientation = orientation(firstA, firstB, secondA);
  const secondOrientation = orientation(firstA, firstB, secondB);
  const thirdOrientation = orientation(secondA, secondB, firstA);
  const fourthOrientation = orientation(secondA, secondB, firstB);

  if (
    firstOrientation !== secondOrientation &&
    thirdOrientation !== fourthOrientation
  ) {
    return true;
  }

  return (
    (firstOrientation === 0 && pointOnSegment(firstA, secondA, firstB)) ||
    (secondOrientation === 0 && pointOnSegment(firstA, secondB, firstB)) ||
    (thirdOrientation === 0 && pointOnSegment(secondA, firstA, secondB)) ||
    (fourthOrientation === 0 && pointOnSegment(secondA, firstB, secondB))
  );
}

function pointInPolygon(point: Point, polygon: Polygon): boolean {
  let inside = false;

  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];

    if (pointOnSegment(previousPoint, point, currentPoint)) {
      return true;
    }

    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;

    if (crosses) {
      inside = !inside;
    }
  }

  return inside;
}

function polygonsIntersect(first: Polygon, second: Polygon): boolean {
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstA = first[firstIndex];
    const firstB = first[(firstIndex + 1) % first.length];

    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const secondA = second[secondIndex];
      const secondB = second[(secondIndex + 1) % second.length];

      if (segmentsIntersect(firstA, firstB, secondA, secondB)) {
        return true;
      }
    }
  }

  return pointInPolygon(first[0], second) || pointInPolygon(second[0], first);
}

function aabbsIntersect(first: Aabb, second: Aabb): boolean {
  return !(
    first.maxX < second.minX ||
    first.minX > second.maxX ||
    first.maxY < second.minY ||
    first.minY > second.maxY
  );
}

function nearbyColliders(
  collidersByCell: Map<string, WorldCollider[]>,
  aabb: Aabb,
): WorldCollider[] {
  const [minCellX, maxCellX] = cellRange(aabb.minX, aabb.maxX);
  const [minCellY, maxCellY] = cellRange(aabb.minY, aabb.maxY);
  const result = new Map<string, WorldCollider>();

  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      const entries = collidersByCell.get(cellKey(cellX, cellY));

      if (!entries) {
        continue;
      }

      for (const collider of entries) {
        result.set(collider.id, collider);
      }
    }
  }

  return [...result.values()];
}

function bodyOverlapsWorld(
  world: CollisionWorld,
  bodyProfileId: string,
  collisionChannel: string,
  x: number,
  y: number,
): boolean {
  const bodyProfile = world.bodyProfiles.get(bodyProfileId);
  const collidersByCell = world.collidersByChannel.get(collisionChannel);

  if (!bodyProfile || !collidersByCell) {
    return true;
  }

  const body = translateBody(bodyProfile, x, y);

  return nearbyColliders(collidersByCell, body.aabb).some((collider) => {
    if (!aabbsIntersect(body.aabb, collider.geometry.aabb)) {
      return false;
    }

    return body.polygons.some((bodyPolygon) =>
      collider.geometry.worldPolygons.some((colliderPolygon) =>
        polygonsIntersect(bodyPolygon, colliderPolygon),
      ),
    );
  });
}

function resolveBodyMovement(
  mapId: string,
  bodyProfileId: string,
  collisionChannel: string,
  currentX: number,
  currentY: number,
  deltaX: number,
  deltaY: number,
): MovementResolution {
  const world = collisionWorlds.get(mapId);

  if (!world) {
    return {
      blockedX: deltaX !== 0,
      blockedY: deltaY !== 0,
      x: currentX,
      y: currentY,
    };
  }

  const substepCount = Math.max(
    1,
    Math.ceil(
      Math.max(Math.abs(deltaX), Math.abs(deltaY)) / MAX_MOVEMENT_SUBSTEP,
    ),
  );
  const stepX = deltaX / substepCount;
  const stepY = deltaY / substepCount;
  let x = currentX;
  let y = currentY;
  let blockedX = false;
  let blockedY = false;

  for (let step = 0; step < substepCount; step += 1) {
    if (stepX !== 0) {
      const nextX = x + stepX;

      if (
        bodyOverlapsWorld(
          world,
          bodyProfileId,
          collisionChannel,
          nextX,
          y,
        )
      ) {
        blockedX = true;
      } else {
        x = nextX;
      }
    }

    if (stepY !== 0) {
      const nextY = y + stepY;

      if (
        bodyOverlapsWorld(
          world,
          bodyProfileId,
          collisionChannel,
          x,
          nextY,
        )
      ) {
        blockedY = true;
      } else {
        y = nextY;
      }
    }
  }

  return {
    blockedX,
    blockedY,
    x,
    y,
  };
}

const collisionWorlds = new Map<string, CollisionWorld>();
const map1World = loadCollisionWorld("MAP_1.world.json");

collisionWorlds.set(map1World.mapId, map1World);

export function normalizeWorldMapId(mapId: string): string {
  return collisionWorlds.has(mapId) ? mapId : DEFAULT_MAP_ID;
}

export function resolvePlayerSpawn(
  mapId: string,
  requestedX: number,
  requestedY: number,
): PlayerSpawnResolution {
  const world = collisionWorlds.get(mapId);

  if (!world) {
    throw new Error(`[Grandoria] Collision world is not loaded for ${mapId}.`);
  }

  if (
    Number.isFinite(requestedX) &&
    Number.isFinite(requestedY) &&
    !bodyOverlapsWorld(
      world,
      PLAYER_BODY_PROFILE_ID,
      PLAYER_COLLISION_CHANNEL,
      requestedX,
      requestedY,
    )
  ) {
    return {
      recovered: false,
      x: requestedX,
      y: requestedY,
    };
  }

  if (
    bodyOverlapsWorld(
      world,
      PLAYER_BODY_PROFILE_ID,
      PLAYER_COLLISION_CHANNEL,
      world.recovery.x,
      world.recovery.y,
    )
  ) {
    throw new Error(`[Grandoria] Invalid recovery entry for ${mapId}.`);
  }

  return {
    recovered: true,
    x: world.recovery.x,
    y: world.recovery.y,
  };
}

export function resolvePlayerMovement(
  mapId: string,
  currentX: number,
  currentY: number,
  deltaX: number,
  deltaY: number,
): PlayerMovementResolution {
  return resolveBodyMovement(
    mapId,
    PLAYER_BODY_PROFILE_ID,
    PLAYER_COLLISION_CHANNEL,
    currentX,
    currentY,
    deltaX,
    deltaY,
  );
}

export function resolveMonsterMovement(
  mapId: string,
  bodyProfileId: string,
  currentX: number,
  currentY: number,
  deltaX: number,
  deltaY: number,
): MonsterMovementResolution {
  return resolveBodyMovement(
    mapId,
    bodyProfileId,
    MONSTER_COLLISION_CHANNEL,
    currentX,
    currentY,
    deltaX,
    deltaY,
  );
}
