import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ARTIFACT_SCHEMA_VERSION = 1;
const EXPORTER_VERSION = 1;
const MAP_ID = "MAP_1";
const EXPECTED_PROJECT_FILE =
  "RPG-2D-project-organized-by-systems-pre-combat-english.json";
const EXPECTED_FIRST_LAYOUT = "Scene_Menu";
const AUTHORING_GRID_SIZE = 16;

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT_PATH = join(
  SERVER_ROOT,
  "src",
  "world",
  "maps",
  "MAP_1.world.json",
);

const PLAYER_BLOCKER_OBJECTS = [
  "Alquimia_table",
  "Blacksmith_table",
  "MagicTreevillage",
  "Marceneiro_table",
  "RIP",
  "cabana1",
  "caixao1",
  "caixao2",
  "collision_floor_1",
  "cruz",
  "estatua",
  "fogueira1",
  "npc_alquimista",
  "npc_ferreiro",
  "npc_marceneiro",
  "npc_tasks",
  "shortLapide",
  "spawn",
  "tent_equipments",
  "tent_merchant",
  "tent_mystic",
].sort(compareStrings);

const MONSTER_BLOCKER_OBJECTS = [
  "MagicTreevillage",
  "cabana1",
  "collision_floor_1",
  "collision_mobs",
  "fogueira1",
].sort(compareStrings);

const DORMANT_BLOCKER_OBJECTS = [
  "RIP",
  "npc_alquimista",
  "npc_ferreiro",
  "npc_marceneiro",
  "npc_tasks",
  "spawn",
].sort(compareStrings);

const REQUIRED_TILE_MAP_OBJECTS = [
  "GroundDetailsMap1",
  "GroundMap1",
  "floor1_Map1",
  "floor2_Map1",
  "pisoDecorationMap1",
  "pisoMap1",
].sort(compareStrings);

const BODY_SOURCE_OBJECTS = [
  "Collision_attack_unarmed",
  "Remote_mob_boar",
  "Remote_mob_hare",
  "character",
  "mob_boar",
  "mob_hare",
];

const AUTHORIZED_RECOVERY_ENTRY = {
  direction: "down",
  id: "MAP_1/default",
  mapId: MAP_ID,
  x: 519,
  y: 626,
};

const AUTHORIZED_MONSTER_SPAWNS = [
  {
    bodyProfileId: "mob_boar",
    direction: "down",
    id: "map1_boar_001",
    mapId: MAP_ID,
    x: 144,
    y: 1056,
  },
  {
    bodyProfileId: "mob_hare",
    direction: "down",
    id: "map1_hare_001",
    mapId: MAP_ID,
    x: 168,
    y: 968,
  },
].sort((left, right) => compareStrings(left.id, right.id));

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message) {
  throw new Error(message);
}

function assertCondition(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function assertFiniteNumber(value, label) {
  assertCondition(
    typeof value === "number" && Number.isFinite(value),
    `${label} must be a finite number.`,
  );

  return Object.is(value, -0) ? 0 : value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${label} is malformed JSON: ${error.message}`);
  }
}

function normalizePortablePath(value) {
  return value.replaceAll("\\", "/");
}

function isPathInside(parentPath, childPath) {
  const pathFromParent = relative(resolve(parentPath), resolve(childPath));

  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== ".." &&
      !isAbsolute(pathFromParent))
  );
}

function pathsEqual(leftPath, rightPath) {
  const normalizedLeft = resolve(leftPath);
  const normalizedRight = resolve(rightPath);

  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function resolveProjectFile(projectRoot, sourcePath, label) {
  assertCondition(
    typeof sourcePath === "string" && sourcePath.length > 0,
    `${label} must be a non-empty project-relative path.`,
  );
  assertCondition(
    !isAbsolute(sourcePath) && !win32.isAbsolute(sourcePath),
    `${label} must not be absolute: ${sourcePath}`,
  );

  const nativeRelativePath = sourcePath.replaceAll("/", sep).replaceAll("\\", sep);
  const absolutePath = resolve(projectRoot, nativeRelativePath);

  assertCondition(
    isPathInside(projectRoot, absolutePath),
    `${label} escapes the canonical project directory: ${sourcePath}`,
  );
  assertCondition(existsSync(absolutePath), `${label} is missing: ${sourcePath}`);

  return {
    absolutePath,
    file: normalizePortablePath(relative(projectRoot, absolutePath)),
  };
}

function readPngDimensions(bytes, label) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  assertCondition(bytes.length >= 24, `${label} is not a complete PNG resource.`);
  assertCondition(
    bytes.subarray(0, 8).equals(pngSignature),
    `${label} is not a supported PNG resource.`,
  );
  assertCondition(
    bytes.toString("ascii", 12, 16) === "IHDR",
    `${label} does not contain a valid PNG IHDR header.`,
  );

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);

  assertCondition(width > 0 && height > 0, `${label} has invalid PNG dimensions.`);

  return { height, width };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareStrings)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }

  return Object.is(value, -0) ? 0 : value;
}

function validateJsonValue(value, path = "artifact") {
  if (typeof value === "number") {
    assertFiniteNumber(value, path);
    return;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (Array.isArray(value)) {
    assertCondition(
      Object.keys(value).length === value.length,
      `${path} must not contain sparse arrays.`,
    );
    value.forEach((entry, index) => validateJsonValue(entry, `${path}[${index}]`));
    return;
  }

  assertCondition(
    value && typeof value === "object",
    `${path} contains a non-JSON value.`,
  );

  for (const [key, entry] of Object.entries(value)) {
    assertCondition(entry !== undefined, `${path}.${key} must not be undefined.`);
    validateJsonValue(entry, `${path}.${key}`);
  }
}

function assertNoAbsolutePaths(value, path = "artifact") {
  if (typeof value === "string") {
    assertCondition(
      !isAbsolute(value) && !win32.isAbsolute(value) && !value.startsWith("file:"),
      `${path} contains an absolute machine-local path: ${value}`,
    );
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoAbsolutePaths(entry, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assertNoAbsolutePaths(entry, `${path}.${key}`);
    }
  }
}

export function serializeWorldArtifact(artifact) {
  validateJsonValue(artifact);
  assertNoAbsolutePaths(artifact);

  return `${JSON.stringify(canonicalize(artifact), null, 2)}\n`;
}

export function assertArtifactCurrent(generatedText, existingText) {
  assertCondition(
    generatedText === existingText,
    "The committed MAP_1 world artifact is stale. Run the exporter and review the diff.",
  );
}

function polygonSignedArea(polygon) {
  let doubledArea = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];

    doubledArea += current.x * next.y - next.x * current.y;
  }

  return doubledArea / 2;
}

function classifyPolygon(polygon) {
  const uniquePoints = new Set(polygon.map((point) => `${point.x},${point.y}`));
  const signedArea = polygonSignedArea(polygon);

  if (polygon.length < 3 || uniquePoints.size < 3 || signedArea === 0) {
    return { classification: "degenerate", signedArea };
  }

  let observedSign = 0;
  let concave = false;

  for (let index = 0; index < polygon.length; index += 1) {
    const previous = polygon[(index - 1 + polygon.length) % polygon.length];
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const cross =
      (current.x - previous.x) * (next.y - current.y) -
      (current.y - previous.y) * (next.x - current.x);

    if (cross === 0) {
      continue;
    }

    const sign = Math.sign(cross);

    if (observedSign === 0) {
      observedSign = sign;
    } else if (observedSign !== sign) {
      concave = true;
      break;
    }
  }

  return {
    classification: concave ? "concave" : "convex",
    signedArea,
  };
}

function pointsEqual(left, right) {
  return left.x === right.x && left.y === right.y;
}

function polygonSetsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function calculateAabb(polygons) {
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let pointCount = 0;

  for (const polygon of polygons) {
    for (const point of polygon) {
      const x = assertFiniteNumber(point?.x, "AABB point.x");
      const y = assertFiniteNumber(point?.y, "AABB point.y");

      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      pointCount += 1;
    }
  }

  assertCondition(pointCount > 0, "Cannot derive an AABB from empty geometry.");

  return { maxX, maxY, minX, minY };
}

function transformPoint(point, transform) {
  const localX = (point.x - transform.origin.x) * transform.scale.x;
  const localY = (point.y - transform.origin.y) * transform.scale.y;

  if (transform.angle === 0) {
    return {
      x: transform.position.x + localX,
      y: transform.position.y + localY,
    };
  }

  fail(
    `Non-zero collider rotation is unsupported in exporter version ${EXPORTER_VERSION}.`,
  );
}

function analyzeGeometry(sourcePolygons, worldPolygons) {
  return sourcePolygons.map((sourcePolygon, index) => {
    const sourceAnalysis = classifyPolygon(sourcePolygon);
    const worldAnalysis = classifyPolygon(worldPolygons[index]);

    assertCondition(
      sourceAnalysis.classification === worldAnalysis.classification,
      "A collider transform changed polygon classification unexpectedly.",
    );

    return {
      classification: sourceAnalysis.classification,
      sourceIndex: index,
      sourceSignedArea: sourceAnalysis.signedArea,
      worldSignedArea: worldAnalysis.signedArea,
    };
  });
}

function createResourceRegistry(project, projectRoot) {
  const resources = project.resources?.resources;

  assertCondition(Array.isArray(resources), "The canonical project resource registry is missing.");

  const byName = new Map();

  for (const resource of resources) {
    assertCondition(
      resource && typeof resource.name === "string" && resource.name.length > 0,
      "A canonical project resource has no stable name.",
    );
    assertCondition(
      !byName.has(resource.name),
      `Duplicate canonical resource name: ${resource.name}`,
    );
    byName.set(resource.name, resource);
  }

  const manifestByFile = new Map();
  const bytesByFile = new Map();

  function addFile(sourcePath, kind, purpose, resourceName = null) {
    const resolvedFile = resolveProjectFile(projectRoot, sourcePath, "Active resource");
    let manifestEntry = manifestByFile.get(resolvedFile.file);

    if (!manifestEntry) {
      const bytes = readFileSync(resolvedFile.absolutePath);

      bytesByFile.set(resolvedFile.file, bytes);
      manifestEntry = {
        file: resolvedFile.file,
        kind,
        names: new Set(),
        purposes: new Set(),
        sha256: sha256(bytes),
        sizeBytes: bytes.length,
      };
      manifestByFile.set(resolvedFile.file, manifestEntry);
    } else {
      assertCondition(
        manifestEntry.kind === kind,
        `Active resource kind mismatch for ${resolvedFile.file}.`,
      );
    }

    manifestEntry.purposes.add(purpose);
    if (resourceName) {
      manifestEntry.names.add(resourceName);
    }

    return {
      bytes: bytesByFile.get(resolvedFile.file),
      file: resolvedFile.file,
    };
  }

  function addNamedImage(resourceName, purpose) {
    const file = addNamedResource(resourceName, "image", "image", purpose);

    return {
      ...file,
      dimensions: readPngDimensions(file.bytes, file.file),
      resourceName,
    };
  }

  function addNamedResource(resourceName, expectedKind, manifestKind, purpose) {
    const resource = byName.get(resourceName);

    assertCondition(resource, `Required active resource is missing: ${resourceName}`);
    assertCondition(
      resource.kind === expectedKind,
      `Required active resource ${resourceName} must have kind ${expectedKind}.`,
    );

    return addFile(resource.file, manifestKind, purpose, resourceName);
  }

  function toManifest() {
    return [...manifestByFile.values()]
      .map((entry) => ({
        file: entry.file,
        kind: entry.kind,
        names: [...entry.names].sort(compareStrings),
        purposes: [...entry.purposes].sort(compareStrings),
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
      }))
      .sort((left, right) => compareStrings(left.file, right.file));
  }

  return {
    addFile,
    addNamedImage,
    addNamedResource,
    byName,
    toManifest,
  };
}

function createObjectRegistry(project, layout) {
  const registry = new Map();

  for (const [scope, objects] of [
    ["global", project.objects],
    ["layout", layout.objects],
  ]) {
    assertCondition(Array.isArray(objects), `The ${scope} object registry is missing.`);

    for (const object of objects) {
      if (!registry.has(object.name)) {
        registry.set(object.name, []);
      }
      registry.get(object.name).push({ object, scope });
    }
  }

  function requireObject(name) {
    const matches = registry.get(name) ?? [];

    assertCondition(matches.length > 0, `Required GDevelop object is missing: ${name}`);
    assertCondition(
      matches.length === 1,
      `GDevelop object name is ambiguous across scopes: ${name}`,
    );

    return matches[0];
  }

  return { requireObject };
}

function collectMapEventTrees(project, layout) {
  assertCondition(Array.isArray(layout.events), `${MAP_ID} events are missing.`);
  assertCondition(
    Array.isArray(project.externalEvents),
    "The canonical External Events registry is missing.",
  );

  const externalEventsByName = new Map();

  for (const externalEvents of project.externalEvents) {
    assertCondition(
      externalEvents &&
        typeof externalEvents.name === "string" &&
        externalEvents.name.length > 0,
      "An External Events sheet has no stable name.",
    );
    assertCondition(
      !externalEventsByName.has(externalEvents.name),
      `Duplicate External Events sheet: ${externalEvents.name}`,
    );
    assertCondition(
      Array.isArray(externalEvents.events),
      `External Events sheet ${externalEvents.name} has no event list.`,
    );
    externalEventsByName.set(externalEvents.name, externalEvents);
  }

  const eventTrees = [];
  const pendingTrees = [{ events: layout.events, source: `layout ${MAP_ID}` }];
  const visitedExternalEvents = new Set();

  function collectActiveLinks(value, targets, disabled = false) {
    if (!value || typeof value !== "object") {
      return;
    }

    const currentDisabled = disabled || value.disabled === true;

    if (!currentDisabled && value.type === "BuiltinCommonInstructions::Link") {
      assertCondition(
        value.include?.includeConfig === 0,
        `External Events link ${value.target ?? "<missing>"} uses an unsupported include configuration.`,
      );
      assertCondition(
        typeof value.target === "string" && value.target.length > 0,
        "An active External Events link has no target.",
      );
      targets.add(value.target);
    }

    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        child.forEach((entry) => collectActiveLinks(entry, targets, currentDisabled));
      } else if (child && typeof child === "object") {
        collectActiveLinks(child, targets, currentDisabled);
      }
    }
  }

  while (pendingTrees.length > 0) {
    const currentTree = pendingTrees.shift();
    const linkedTargets = new Set();

    eventTrees.push(currentTree.events);
    collectActiveLinks(currentTree.events, linkedTargets);

    for (const target of [...linkedTargets].sort(compareStrings)) {
      if (visitedExternalEvents.has(target)) {
        continue;
      }

      const externalEvents = externalEventsByName.get(target);

      assertCondition(
        externalEvents,
        `${currentTree.source} links missing External Events sheet ${target}.`,
      );
      visitedExternalEvents.add(target);
      pendingTrees.push({
        events: externalEvents.events,
        source: `External Events ${target}`,
      });
    }
  }

  return eventTrees;
}

function collectActiveSeparatePairs(eventTrees) {
  const pairs = [];

  function visit(value, disabled = false) {
    if (!value || typeof value !== "object") {
      return;
    }

    const currentDisabled = disabled || value.disabled === true;

    if (!currentDisabled && value.type?.value === "SeparateFromObjects") {
      assertCondition(
        Array.isArray(value.parameters) && value.parameters.length >= 2,
        "An active SeparateFromObjects action is malformed.",
      );
      pairs.push([value.parameters[0], value.parameters[1]]);
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === "parameters" || key === "inlineCode") {
        continue;
      }

      if (Array.isArray(child)) {
        child.forEach((entry) => visit(entry, currentDisabled));
      } else if (child && typeof child === "object") {
        visit(child, currentDisabled);
      }
    }
  }

  eventTrees.forEach((eventTree) => visit(eventTree));

  return pairs;
}

function requireObjectGroupMembers(project, layout, groupName) {
  const matches = [project.objectsGroups, layout.objectsGroups]
    .filter((groups) => groups !== undefined)
    .flatMap((groups) => {
      assertCondition(Array.isArray(groups), "A GDevelop object group registry is malformed.");
      return groups.filter((group) => group.name === groupName);
    });

  assertCondition(matches.length === 1, `Object group ${groupName} is missing or ambiguous.`);
  assertCondition(
    Array.isArray(matches[0].objects) && matches[0].objects.length > 0,
    `Object group ${groupName} has no members.`,
  );

  return matches[0].objects.map((entry, index) => {
    assertCondition(
      entry && typeof entry.name === "string" && entry.name.length > 0,
      `Object group ${groupName} member ${index} is malformed.`,
    );
    return entry.name;
  });
}

function validateCollisionClassifications(project, layout) {
  const playerObjects = new Set();
  const monsterObjects = new Set();
  const playerMovers = new Set(["character"]);
  const monsterMovers = new Set([
    "MOBS_random_direction",
    ...requireObjectGroupMembers(project, layout, "MOBS_random_direction"),
  ]);
  const eventTrees = collectMapEventTrees(project, layout);

  for (const [first, second] of collectActiveSeparatePairs(eventTrees)) {
    assertCondition(
      typeof first === "string" &&
        first.length > 0 &&
        typeof second === "string" &&
        second.length > 0,
      "An active SeparateFromObjects action has invalid object parameters.",
    );

    const firstChannel = playerMovers.has(first)
      ? "player"
      : monsterMovers.has(first)
        ? "monster"
        : null;
    const secondChannel = playerMovers.has(second)
      ? "player"
      : monsterMovers.has(second)
        ? "monster"
        : null;

    assertCondition(
      Boolean(firstChannel) !== Boolean(secondChannel),
      `Active SeparateFromObjects pair has no unambiguous movement classification: ${first} <-> ${second}`,
    );

    const channel = firstChannel ?? secondChannel;
    const blockerObject = firstChannel ? second : first;

    if (channel === "player") {
      playerObjects.add(blockerObject);
    } else {
      monsterObjects.add(blockerObject);
    }
  }

  const discoveredPlayer = [...playerObjects].sort(compareStrings);
  const discoveredMonster = [...monsterObjects].sort(compareStrings);

  assertCondition(
    JSON.stringify(discoveredPlayer) === JSON.stringify(PLAYER_BLOCKER_OBJECTS),
    `Active player collider classification changed. Discovered: ${discoveredPlayer.join(", ")}`,
  );
  assertCondition(
    JSON.stringify(discoveredMonster) === JSON.stringify(MONSTER_BLOCKER_OBJECTS),
    `Active monster collider classification changed. Discovered: ${discoveredMonster.join(", ")}`,
  );

  return {
    monster: discoveredMonster,
    player: discoveredPlayer,
  };
}

function getSelectedAnimationIndex(instance) {
  const animationProperty = instance.numberProperties?.find(
    (property) => property.name === "animation",
  );
  const animationIndex = animationProperty?.value ?? 0;

  assertCondition(
    Number.isInteger(animationIndex) && animationIndex >= 0,
    `Instance ${instance.persistentUuid} has an invalid animation index.`,
  );

  return animationIndex;
}

function requireExplicitFrameMask(sprite, label) {
  assertCondition(sprite?.hasCustomCollisionMask === true, `${label} has no explicit mask.`);
  assertCondition(Array.isArray(sprite.customCollisionMask), `${label} mask is malformed.`);

  return sprite.customCollisionMask.map((polygon, polygonIndex) => {
    assertCondition(Array.isArray(polygon), `${label} polygon ${polygonIndex} is malformed.`);

    return polygon.map((point, pointIndex) => ({
      x: assertFiniteNumber(point?.x, `${label} polygon ${polygonIndex} point ${pointIndex}.x`),
      y: assertFiniteNumber(point?.y, `${label} polygon ${polygonIndex} point ${pointIndex}.y`),
    }));
  });
}

function extractSpriteInstanceGeometry(
  objectRecord,
  instance,
  resourceRegistry,
) {
  const { object } = objectRecord;

  assertCondition(object.type === "Sprite", `${object.name} is not a supported Sprite object.`);
  assertCondition(
    object.adaptCollisionMaskAutomatically === false,
    `${object.name} uses automatic collision masks and cannot be exported exactly.`,
  );

  const animationIndex = getSelectedAnimationIndex(instance);
  const animation = object.animations?.[animationIndex];

  assertCondition(animation, `${object.name} animation ${animationIndex} is missing.`);
  assertCondition(
    Array.isArray(animation.directions) && animation.directions.length === 1,
    `${object.name} selected animation uses unsupported multiple directions.`,
  );

  const sprites = animation.directions[0].sprites;

  assertCondition(Array.isArray(sprites) && sprites.length > 0, `${object.name} has no selected frames.`);

  let reference = null;

  for (let frameIndex = 0; frameIndex < sprites.length; frameIndex += 1) {
    const sprite = sprites[frameIndex];
    const label = `${object.name} animation ${animationIndex} frame ${frameIndex}`;
    const sourcePolygons = requireExplicitFrameMask(sprite, label);
    const origin = {
      x: assertFiniteNumber(sprite.originPoint?.x, `${label} origin.x`),
      y: assertFiniteNumber(sprite.originPoint?.y, `${label} origin.y`),
    };
    let scale = { x: 1, y: 1 };
    let sourceImage = null;

    if (instance.customSize === true) {
      const image = resourceRegistry.addNamedImage(sprite.image, "sprite_scale");
      const width = assertFiniteNumber(instance.width, `${label} instance width`);
      const height = assertFiniteNumber(instance.height, `${label} instance height`);

      assertCondition(width > 0 && height > 0, `${label} has a non-positive custom size.`);
      scale = {
        x: width / image.dimensions.width,
        y: height / image.dimensions.height,
      };
      sourceImage = {
        file: image.file,
        height: image.dimensions.height,
        name: image.resourceName,
        width: image.dimensions.width,
      };
    }

    const transform = {
      angle: assertFiniteNumber(instance.angle, `${label} instance angle`),
      origin,
      position: {
        x: assertFiniteNumber(instance.x, `${label} instance x`),
        y: assertFiniteNumber(instance.y, `${label} instance y`),
      },
      scale: {
        x: assertFiniteNumber(scale.x, `${label} scale.x`),
        y: assertFiniteNumber(scale.y, `${label} scale.y`),
      },
    };

    assertCondition(transform.angle === 0, `${label} has unsupported non-zero rotation.`);

    const worldPolygons = sourcePolygons.map((polygon) =>
      polygon.map((point) => transformPoint(point, transform)),
    );
    const current = { origin, sourceImage, sourcePolygons, transform, worldPolygons };

    if (!reference) {
      reference = current;
    } else {
      assertCondition(
        polygonSetsEqual(reference.sourcePolygons, current.sourcePolygons) &&
          polygonSetsEqual(reference.worldPolygons, current.worldPolygons) &&
          pointsEqual(reference.origin, current.origin),
        `${object.name} selected animation changes collision geometry between frames.`,
      );
    }
  }

  return {
    animation: {
      frameCount: sprites.length,
      index: animationIndex,
      name: animation.name ?? "",
    },
    sourceKind: "custom_collision_mask",
    ...reference,
  };
}

function extractRectangleInstanceGeometry(instance) {
  const width = assertFiniteNumber(instance.width, `${instance.name} instance width`);
  const height = assertFiniteNumber(instance.height, `${instance.name} instance height`);
  const x = assertFiniteNumber(instance.x, `${instance.name} instance x`);
  const y = assertFiniteNumber(instance.y, `${instance.name} instance y`);
  const angle = assertFiniteNumber(instance.angle, `${instance.name} instance angle`);

  assertCondition(instance.customSize === true, `${instance.name} rectangle has no explicit size.`);
  assertCondition(width > 0 && height > 0, `${instance.name} rectangle has a non-positive size.`);
  assertCondition(angle === 0, `${instance.name} rectangle has unsupported non-zero rotation.`);

  const sourcePolygons = [
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
  ];
  const transform = {
    angle,
    origin: { x: 0, y: 0 },
    position: { x, y },
    scale: { x: 1, y: 1 },
  };
  const worldPolygons = sourcePolygons.map((polygon) =>
    polygon.map((point) => transformPoint(point, transform)),
  );

  return {
    animation: null,
    origin: transform.origin,
    sourceImage: null,
    sourceKind: "instance_rectangle",
    sourcePolygons,
    transform,
    worldPolygons,
  };
}

function createColliderSource(objectRecord, instance, animation) {
  return {
    animation,
    instancePersistentUuid: instance.persistentUuid,
    layer: instance.layer ?? "",
    layout: MAP_ID,
    objectName: objectRecord.object.name,
    objectPersistentUuid: objectRecord.object.persistentUuid ?? null,
    objectScope: objectRecord.scope,
    objectType: objectRecord.object.type,
  };
}

function extractColliders(layout, objectRegistry, resourceRegistry, classifications) {
  const allObjects = new Set([...classifications.player, ...classifications.monster]);
  const seenInstanceIds = new Set();
  const colliders = [];
  const degenerateMasks = [];
  const categorySummary = [];

  for (const objectName of [...allObjects].sort(compareStrings)) {
    const objectRecord = objectRegistry.requireObject(objectName);
    const instances = layout.instances
      .filter((instance) => instance.name === objectName)
      .sort((left, right) => compareStrings(left.persistentUuid, right.persistentUuid));
    const channels = [
      ...(classifications.monster.includes(objectName) ? ["monster"] : []),
      ...(classifications.player.includes(objectName) ? ["player"] : []),
    ].sort(compareStrings);
    let effectiveColliderCount = 0;
    let polygonCount = 0;
    let degenerateCount = 0;

    for (const instance of instances) {
      assertCondition(
        typeof instance.persistentUuid === "string" && instance.persistentUuid.length > 0,
        `${objectName} has an instance without persistentUuid.`,
      );
      assertCondition(
        !seenInstanceIds.has(instance.persistentUuid),
        `Duplicate collider instance persistentUuid: ${instance.persistentUuid}`,
      );
      seenInstanceIds.add(instance.persistentUuid);

      let extracted;

      if (objectRecord.object.type === "TiledSpriteObject::TiledSprite") {
        extracted = extractRectangleInstanceGeometry(instance);
      } else if (objectRecord.object.type === "Sprite") {
        extracted = extractSpriteInstanceGeometry(
          objectRecord,
          instance,
          resourceRegistry,
        );
      } else {
        fail(`${objectName} has unsupported active collider type ${objectRecord.object.type}.`);
      }

      const analysis = analyzeGeometry(extracted.sourcePolygons, extracted.worldPolygons);
      const source = createColliderSource(objectRecord, instance, extracted.animation);
      const allDegenerate = analysis.every(
        (polygon) => polygon.classification === "degenerate",
      );
      const anyDegenerate = analysis.some(
        (polygon) => polygon.classification === "degenerate",
      );

      assertCondition(
        !anyDegenerate || allDegenerate,
        `${objectName}/${instance.persistentUuid} mixes degenerate and non-degenerate polygons.`,
      );

      if (allDegenerate) {
        degenerateCount += 1;
        degenerateMasks.push({
          code: "zero_area_selected_mask",
          fallbackApplied: false,
          geometry: {
            polygonAnalysis: analysis,
            sourceKind: extracted.sourceKind,
            sourcePolygons: extracted.sourcePolygons,
            worldPolygons: extracted.worldPolygons,
          },
          source,
          transform: extracted.transform,
        });
        continue;
      }

      effectiveColliderCount += 1;
      polygonCount += extracted.worldPolygons.length;
      colliders.push({
        collisionChannels: channels,
        geometry: {
          aabb: calculateAabb(extracted.worldPolygons),
          polygonAnalysis: analysis,
          sourceKind: extracted.sourceKind,
          sourcePolygons: extracted.sourcePolygons,
          type: "polygon_set",
          worldPolygons: extracted.worldPolygons,
        },
        id: `${MAP_ID}:collider:${instance.persistentUuid}`,
        source,
        transform: extracted.transform,
      });
    }

    categorySummary.push({
      collisionChannels: channels,
      degenerateDiagnosticCount: degenerateCount,
      effectiveColliderCount,
      objectName,
      polygonCount,
      sourceInstanceCount: instances.length,
    });
  }

  colliders.sort((left, right) => compareStrings(left.id, right.id));
  degenerateMasks.sort((left, right) =>
    compareStrings(
      left.source.instancePersistentUuid,
      right.source.instancePersistentUuid,
    ),
  );
  categorySummary.sort((left, right) => compareStrings(left.objectName, right.objectName));

  assertCondition(
    new Set(colliders.map((collider) => collider.id)).size === colliders.length,
    "Collider IDs are not unique.",
  );

  return { categorySummary, colliders, degenerateMasks };
}

function getAllObjectFrames(object, objectName) {
  assertCondition(object.type === "Sprite", `${objectName} must be a Sprite body source.`);
  assertCondition(
    object.adaptCollisionMaskAutomatically === false,
    `${objectName} body uses an automatic collision mask.`,
  );

  const frames = [];

  for (let animationIndex = 0; animationIndex < object.animations.length; animationIndex += 1) {
    const animation = object.animations[animationIndex];

    assertCondition(
      Array.isArray(animation.directions) && animation.directions.length === 1,
      `${objectName} body source uses unsupported multiple directions.`,
    );

    const sprites = animation.directions[0].sprites;

    for (let frameIndex = 0; frameIndex < sprites.length; frameIndex += 1) {
      const sprite = sprites[frameIndex];
      const sourcePolygons = requireExplicitFrameMask(
        sprite,
        `${objectName} animation ${animationIndex} frame ${frameIndex}`,
      );
      const origin = {
        x: assertFiniteNumber(sprite.originPoint?.x, `${objectName} origin.x`),
        y: assertFiniteNumber(sprite.originPoint?.y, `${objectName} origin.y`),
      };
      const originRelativePolygons = sourcePolygons.map((polygon) =>
        polygon.map((point) => ({
          x: point.x - origin.x,
          y: point.y - origin.y,
        })),
      );

      frames.push({
        animationIndex,
        animationName: animation.name ?? "",
        frameIndex,
        origin,
        originRelativePolygons,
        sourcePolygons,
      });
    }
  }

  return frames;
}

function uniqueGeometryGroups(frames) {
  const groups = new Map();

  for (const frame of frames) {
    const key = JSON.stringify({
      origin: frame.origin,
      polygons: frame.originRelativePolygons,
    });

    if (!groups.has(key)) {
      groups.set(key, { frames: [], frame });
    }
    groups.get(key).frames.push(frame);
  }

  return [...groups.values()].sort(
    (left, right) => right.frames.length - left.frames.length,
  );
}

function createBodyProfile(id, aliases, frame, verification) {
  const analysis = frame.originRelativePolygons.map((polygon, sourceIndex) => ({
    ...classifyPolygon(polygon),
    sourceIndex,
  }));

  assertCondition(
    analysis.every((polygon) => polygon.classification !== "degenerate"),
    `${id} movement body is degenerate.`,
  );

  return {
    aliases: [...aliases].sort(compareStrings),
    id,
    movementBody: {
      originRelativePolygons: frame.originRelativePolygons,
      polygonAnalysis: analysis,
      sourceOrigin: frame.origin,
      sourcePolygons: frame.sourcePolygons,
      type: "polygon_set",
    },
    verification,
  };
}

function extractBodyProfiles(objectRegistry) {
  BODY_SOURCE_OBJECTS.forEach((name) => objectRegistry.requireObject(name));

  const characterRecord = objectRegistry.requireObject("character");
  const characterFrames = getAllObjectFrames(characterRecord.object, "character");
  const characterGroups = uniqueGeometryGroups(characterFrames);

  assertCondition(
    characterGroups.length === 1,
    "The character movement body is not stable across its source frames.",
  );

  const hareSources = ["mob_hare", "Remote_mob_hare"].map((name) => {
    const record = objectRegistry.requireObject(name);
    const frames = getAllObjectFrames(record.object, name);
    const groups = uniqueGeometryGroups(frames);

    assertCondition(groups.length === 1, `${name} does not have one stable body.`);
    assertCondition(frames.length === 100, `${name} no longer contains 100 verified frames.`);

    return { frames, name, representative: groups[0].frame };
  });

  assertCondition(
    polygonSetsEqual(
      hareSources[0].representative.originRelativePolygons,
      hareSources[1].representative.originRelativePolygons,
    ) &&
      pointsEqual(hareSources[0].representative.origin, hareSources[1].representative.origin),
    "Local and remote hare bodies differ.",
  );

  const boarSources = ["mob_boar", "Remote_mob_boar"].map((name) => {
    const record = objectRegistry.requireObject(name);
    const frames = getAllObjectFrames(record.object, name);
    const groups = uniqueGeometryGroups(frames);

    assertCondition(frames.length === 120, `${name} no longer contains 120 verified frames.`);
    assertCondition(groups[0].frames.length === 116, `${name} baseline is not present in 116 frames.`);

    const changedFrames = groups
      .slice(1)
      .flatMap((group) => group.frames)
      .sort((left, right) => compareStrings(left.animationName, right.animationName));

    assertCondition(changedFrames.length === 4, `${name} must expose four boar attack masks.`);
    changedFrames.forEach((frame) => {
      assertCondition(
        frame.animationName.startsWith("attack_") && frame.frameIndex === 3,
        `${name} has unexpected non-baseline body geometry.`,
      );
    });

    return {
      baseline: groups[0].frame,
      changedFrames,
      frames,
      name,
    };
  });

  assertCondition(
    polygonSetsEqual(
      boarSources[0].baseline.originRelativePolygons,
      boarSources[1].baseline.originRelativePolygons,
    ) && pointsEqual(boarSources[0].baseline.origin, boarSources[1].baseline.origin),
    "Local and remote boar baseline bodies differ.",
  );

  for (let index = 0; index < boarSources[0].changedFrames.length; index += 1) {
    const localFrame = boarSources[0].changedFrames[index];
    const remoteFrame = boarSources[1].changedFrames[index];

    assertCondition(
      localFrame.animationName === remoteFrame.animationName &&
        polygonSetsEqual(
          localFrame.originRelativePolygons,
          remoteFrame.originRelativePolygons,
        ),
      "Local and remote boar attack masks differ.",
    );
  }

  const attackRecord = objectRegistry.requireObject("Collision_attack_unarmed");
  const playerAttackFrames = getAllObjectFrames(
    attackRecord.object,
    "Collision_attack_unarmed",
  );
  const effectivePlayerAttacks = playerAttackFrames.filter((frame) =>
    frame.originRelativePolygons.some(
      (polygon) => classifyPolygon(polygon).classification !== "degenerate",
    ),
  );
  const degeneratePlayerAttackFrames = playerAttackFrames.length - effectivePlayerAttacks.length;

  assertCondition(
    effectivePlayerAttacks.length === 4 && degeneratePlayerAttackFrames === 13,
    "Collision_attack_unarmed frame geometry changed unexpectedly.",
  );
  effectivePlayerAttacks.forEach((frame) => {
    assertCondition(
      ["down", "left", "right", "up"].includes(frame.animationName) &&
        frame.frameIndex === 3,
      "Collision_attack_unarmed effective frame is unexpected.",
    );
  });

  const bodyProfiles = [
    createBodyProfile("character", ["character"], characterGroups[0].frame, {
      frameCount: characterFrames.length,
      sourceObjects: ["character"],
      stableAcrossAllFrames: true,
    }),
    createBodyProfile(
      "mob_boar",
      ["Remote_mob_boar", "mob_boar"],
      boarSources[0].baseline,
      {
        baselineFrameCountPerSource: 116,
        sourceObjects: ["Remote_mob_boar", "mob_boar"],
        stableMovementBodyDecision: "verified_baseline_rectangle",
        verifiedFrameCountPerSource: 120,
      },
    ),
    createBodyProfile(
      "mob_hare",
      ["Remote_mob_hare", "mob_hare"],
      hareSources[0].representative,
      {
        sourceObjects: ["Remote_mob_hare", "mob_hare"],
        stableAcrossAllFrames: true,
        verifiedFrameCountPerSource: 100,
      },
    ),
  ].sort((left, right) => compareStrings(left.id, right.id));

  const boarAttackMasks = boarSources[0].changedFrames
    .map((frame) => ({
      direction: frame.animationName.slice("attack_".length),
      frameIndex: frame.frameIndex,
      id: `mob_boar:attack:${frame.animationName.slice("attack_".length)}`,
      originRelativePolygons: frame.originRelativePolygons,
      role: "combat_attack_frame_mask",
      sourceAnimation: frame.animationName,
      sourceOrigin: frame.origin,
      sourcePolygons: frame.sourcePolygons,
      verifiedAliases: ["Remote_mob_boar", "mob_boar"],
    }))
    .sort((left, right) => compareStrings(left.id, right.id));

  const playerAttackHitboxes = effectivePlayerAttacks
    .map((frame) => ({
      direction: frame.animationName,
      frameIndex: frame.frameIndex,
      id: `character:unarmed_attack:${frame.animationName}`,
      originRelativePolygons: frame.originRelativePolygons,
      sourceOrigin: frame.origin,
      sourcePolygons: frame.sourcePolygons,
    }))
    .sort((left, right) => compareStrings(left.id, right.id));

  return {
    bodyProfiles,
    combatGeometry: {
      boarAttackMasks,
      playerUnarmedAttackHitboxes: {
        degenerateFrameMaskCount: degeneratePlayerAttackFrames,
        excludedFromMovementBodies: true,
        hitboxes: playerAttackHitboxes,
        role: "combat_attack_hitbox",
        sourceObject: "Collision_attack_unarmed",
      },
    },
  };
}

function readGlobalVariable(project, name) {
  const variable = project.variables?.find((entry) => entry.name === name);

  assertCondition(variable, `Global variable ${name} is missing.`);

  return variable;
}

function childVariable(variable, name) {
  const child = variable.children?.find((entry) => entry.name === name);

  assertCondition(child, `Variable ${variable.name}.${name} is missing.`);

  return child.value;
}

function createAnchorWorldBody(anchor, bodyProfile) {
  const worldPolygons = bodyProfile.movementBody.originRelativePolygons.map((polygon) =>
    polygon.map((point) => ({
      x: anchor.x + point.x,
      y: anchor.y + point.y,
    })),
  );

  return {
    aabb: calculateAabb(worldPolygons),
    polygons: worldPolygons,
  };
}

function orientation(first, second, third) {
  const value =
    (second.y - first.y) * (third.x - second.x) -
    (second.x - first.x) * (third.y - second.y);

  return value === 0 ? 0 : value > 0 ? 1 : 2;
}

function pointOnSegment(first, point, second) {
  return (
    point.x <= Math.max(first.x, second.x) &&
    point.x >= Math.min(first.x, second.x) &&
    point.y <= Math.max(first.y, second.y) &&
    point.y >= Math.min(first.y, second.y) &&
    orientation(first, point, second) === 0
  );
}

function segmentsIntersect(firstA, firstB, secondA, secondB) {
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

function segmentsProperlyIntersect(firstA, firstB, secondA, secondB) {
  const firstOrientation = orientation(firstA, firstB, secondA);
  const secondOrientation = orientation(firstA, firstB, secondB);
  const thirdOrientation = orientation(secondA, secondB, firstA);
  const fourthOrientation = orientation(secondA, secondB, firstB);

  return (
    firstOrientation !== 0 &&
    secondOrientation !== 0 &&
    thirdOrientation !== 0 &&
    fourthOrientation !== 0 &&
    firstOrientation !== secondOrientation &&
    thirdOrientation !== fourthOrientation
  );
}

function pointInPolygon(point, polygon) {
  let inside = false;

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
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

function polygonsIntersect(first, second) {
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

function aabbsIntersect(first, second) {
  return !(
    first.maxX < second.minX ||
    first.minX > second.maxX ||
    first.maxY < second.minY ||
    first.minY > second.maxY
  );
}

function bodyOverlapsColliders(body, colliders, channel) {
  return colliders.some((collider) => {
    if (
      !collider.collisionChannels.includes(channel) ||
      !aabbsIntersect(body.aabb, collider.geometry.aabb)
    ) {
      return false;
    }

    return body.polygons.some((bodyPolygon) =>
      collider.geometry.worldPolygons.some((colliderPolygon) =>
        polygonsIntersect(bodyPolygon, colliderPolygon),
      ),
    );
  });
}

function bodyInsideCandidate(body, candidate) {
  assertCondition(
    candidate.polygonSet.length === 1,
    `Candidate ${candidate.id} uses unsupported multi-region anchor validation.`,
  );
  const regionPolygon = candidate.polygonSet[0];

  assertCondition(
    Array.isArray(regionPolygon.holes) && regionPolygon.holes.length === 0,
    `Candidate ${candidate.id} uses unsupported holes in anchor validation.`,
  );

  return body.polygons.every((bodyPolygon) => {
    if (!bodyPolygon.every((point) => pointInPolygon(point, regionPolygon.outer))) {
      return false;
    }

    for (let bodyIndex = 0; bodyIndex < bodyPolygon.length; bodyIndex += 1) {
      const bodyStart = bodyPolygon[bodyIndex];
      const bodyEnd = bodyPolygon[(bodyIndex + 1) % bodyPolygon.length];

      for (
        let regionIndex = 0;
        regionIndex < regionPolygon.outer.length;
        regionIndex += 1
      ) {
        const regionStart = regionPolygon.outer[regionIndex];
        const regionEnd =
          regionPolygon.outer[(regionIndex + 1) % regionPolygon.outer.length];

        if (
          segmentsProperlyIntersect(
            bodyStart,
            bodyEnd,
            regionStart,
            regionEnd,
          )
        ) {
          return false;
        }
      }
    }

    return true;
  });
}

function extractTileMapContext(layout, objectRegistry, resourceRegistry) {
  const tileMapRecords = REQUIRED_TILE_MAP_OBJECTS.map((name) => ({
    name,
    ...objectRegistry.requireObject(name),
  }));

  const contentSignatures = new Set(
    tileMapRecords.map(({ object }) =>
      JSON.stringify({
        atlas: object.content?.tilemapAtlasImage,
        map: object.content?.tilemapJsonFile,
        tileset: object.content?.tilesetJsonFile,
      }),
    ),
  );

  assertCondition(contentSignatures.size === 1, "MAP_1 TileMap objects do not share one active resource chain.");

  const primaryContent = tileMapRecords[0].object.content;
  const mapResource = resourceRegistry.addNamedResource(
    primaryContent.tilemapJsonFile,
    "tilemap",
    "tiled_map_json",
    "map_structure",
  );
  const tilesetResource = resourceRegistry.addNamedResource(
    primaryContent.tilesetJsonFile,
    "tileset",
    "tiled_tileset_json",
    "tileset_metadata",
  );
  resourceRegistry.addNamedResource(
    primaryContent.tilemapAtlasImage,
    "image",
    "image",
    "visual_context",
  );

  const tiledMap = parseJson(mapResource.bytes, mapResource.file);
  const tiledTileset = parseJson(tilesetResource.bytes, tilesetResource.file);

  assertCondition(tiledMap.infinite === false, "The active Tiled map must remain finite.");
  assertCondition(tiledMap.orientation === "orthogonal", "The active Tiled map must remain orthogonal.");
  assertCondition(
    tiledMap.tilewidth === AUTHORING_GRID_SIZE &&
      tiledMap.tileheight === AUTHORING_GRID_SIZE,
    "The active Tiled map must remain on the verified 16x16 grid.",
  );
  assertCondition(
    Number.isInteger(tiledMap.width) &&
      Number.isInteger(tiledMap.height) &&
      tiledMap.width > 0 &&
      tiledMap.height > 0,
    "The active Tiled map dimensions are invalid.",
  );
  assertCondition(
    Array.isArray(tiledMap.layers) && tiledMap.layers.every((layer) => layer.type === "tilelayer"),
    "The active Tiled map contains unsupported non-tile layers.",
  );
  assertCondition(
    !Array.isArray(tiledTileset.tiles) ||
      tiledTileset.tiles.every((tile) => !tile.objectgroup),
    "The active Tiled tileset gained unsupported collision geometry.",
  );

  const layerById = new Map();

  for (const layer of tiledMap.layers) {
    assertCondition(!layerById.has(layer.id), `Duplicate Tiled layer ID: ${layer.id}`);
    for (const property of ["x", "y", "offsetx", "offsety", "startx", "starty"]) {
      const value = assertFiniteNumber(
        layer[property] ?? 0,
        `Tiled layer ${layer.id} ${property}`,
      );

      assertCondition(
        value === 0,
        `Tiled layer ${layer.id} has unsupported ${property} transform ${value}.`,
      );
    }
    for (const property of ["parallaxx", "parallaxy"]) {
      const value = assertFiniteNumber(
        layer[property] ?? 1,
        `Tiled layer ${layer.id} ${property}`,
      );

      assertCondition(
        value === 1,
        `Tiled layer ${layer.id} has unsupported ${property} transform ${value}.`,
      );
    }
    assertCondition(
      Array.isArray(layer.data) && layer.data.length === layer.width * layer.height,
      `Tiled layer ${layer.id} has inconsistent data dimensions.`,
    );
    layerById.set(layer.id, layer);
  }

  function getNonEmptyCells(layer, instance) {
    const cells = [];

    for (let index = 0; index < layer.data.length; index += 1) {
      const rawGid = layer.data[index];

      assertCondition(Number.isInteger(rawGid), `Tiled layer ${layer.id} contains a non-integer GID.`);
      if ((rawGid & 0x1fffffff) === 0) {
        continue;
      }

      const column = index % layer.width;
      const row = Math.floor(index / layer.width);

      cells.push({
        column,
        row,
        x: instance.x + column * tiledMap.tilewidth,
        y: instance.y + row * tiledMap.tileheight,
      });
    }

    return cells;
  }

  const instances = [];

  for (const record of tileMapRecords) {
    assertCondition(
      record.object.type === "TileMap::TileMap",
      `${record.name} is not a supported TileMap object.`,
    );
    const layer = layerById.get(record.object.content.layerIndex);

    assertCondition(layer, `${record.name} references a missing Tiled layer.`);

    for (const instance of layout.instances.filter((entry) => entry.name === record.name)) {
      assertCondition(
        typeof instance.persistentUuid === "string" &&
          instance.persistentUuid.length > 0,
        `${record.name} TileMap instance has no stable persistent UUID.`,
      );
      assertCondition(
        instance.customSize === false,
        `${record.name} TileMap instance has unsupported custom sizing.`,
      );
      assertFiniteNumber(instance.x, `${record.name} TileMap instance x`);
      assertFiniteNumber(instance.y, `${record.name} TileMap instance y`);
      const angle = assertFiniteNumber(
        instance.angle,
        `${record.name} TileMap instance angle`,
      );

      assertCondition(angle === 0, `${record.name} instance has unsupported rotation.`);
      const cells = getNonEmptyCells(layer, instance);
      const extent = calculateAabb(
        cells.map((cell) => [
          { x: cell.x, y: cell.y },
          { x: cell.x + tiledMap.tilewidth, y: cell.y + tiledMap.tileheight },
        ]),
      );

      instances.push({
        cells,
        layerId: layer.id,
        layerName: layer.name,
        nonEmptyExtent: extent,
        nonEmptyTileCount: cells.length,
        objectName: record.name,
        persistentUuid: instance.persistentUuid,
        position: { x: instance.x, y: instance.y },
      });
    }
  }

  instances.sort((left, right) => compareStrings(left.persistentUuid, right.persistentUuid));

  const groundInstances = instances.filter((instance) => instance.objectName === "GroundMap1");
  assertCondition(groundInstances.length === 1, "MAP_1 must contain one primary GroundMap1 instance.");
  const primaryOrigin = groundInstances[0].position;
  const floorInstances = instances.filter((instance) => instance.objectName === "floor1_Map1");
  const primaryFloor = floorInstances.find(
    (instance) => pointsEqual(instance.position, primaryOrigin),
  );
  const duplicateFloors = floorInstances.filter((instance) => instance !== primaryFloor);

  const pisoInstances = instances.filter((instance) => instance.objectName === "pisoMap1");
  assertCondition(pisoInstances.length === 1, "MAP_1 must contain one pisoMap1 instance.");

  return {
    context: {
      distantFloor1Duplicate: {
        nonEmptyExtent: duplicateFloors[0].nonEmptyExtent,
        persistentUuid: duplicateFloors[0].persistentUuid,
        position: duplicateFloors[0].position,
        reason: "excluded_distant_duplicate",
      },
      fullVisualBackgroundFootprint: groundInstances[0].nonEmptyExtent,
      instances: instances.map(({ cells, ...instance }) => ({
        ...instance,
        candidateRole:
          instance.persistentUuid === duplicateFloors[0].persistentUuid
            ? "excluded_distant_duplicate"
            : ["GroundMap1", "GroundDetailsMap1"].includes(instance.objectName)
              ? "excluded_background"
              : "prepared_content_evidence",
      })),
      tiledCollisionDataPresent: false,
      tiledMap: {
        height: tiledMap.height,
        orientation: tiledMap.orientation,
        renderOrder: tiledMap.renderorder,
        tileHeight: tiledMap.tileheight,
        tileWidth: tiledMap.tilewidth,
        width: tiledMap.width,
      },
    },
    pisoCells: pisoInstances[0].cells,
  };
}

function connectedTileComponents(cells) {
  const cellByKey = new Map(cells.map((cell) => [`${cell.x},${cell.y}`, cell]));
  const remaining = new Set(cellByKey.keys());
  const components = [];

  for (const start of [...remaining].sort(compareStrings)) {
    if (!remaining.has(start)) {
      continue;
    }

    const stack = [start];
    const component = [];
    remaining.delete(start);

    while (stack.length > 0) {
      const key = stack.pop();
      const cell = cellByKey.get(key);

      component.push(cell);
      for (const [nextX, nextY] of [
        [cell.x + AUTHORING_GRID_SIZE, cell.y],
        [cell.x - AUTHORING_GRID_SIZE, cell.y],
        [cell.x, cell.y + AUTHORING_GRID_SIZE],
        [cell.x, cell.y - AUTHORING_GRID_SIZE],
      ]) {
        const nextKey = `${nextX},${nextY}`;

        if (remaining.delete(nextKey)) {
          stack.push(nextKey);
        }
      }
    }

    const extent = calculateAabb(
      component.map((cell) => [
        { x: cell.x, y: cell.y },
        { x: cell.x + AUTHORING_GRID_SIZE, y: cell.y + AUTHORING_GRID_SIZE },
      ]),
    );
    const columns = (extent.maxX - extent.minX) / AUTHORING_GRID_SIZE;
    const rows = (extent.maxY - extent.minY) / AUTHORING_GRID_SIZE;

    components.push({
      extent,
      fullyFilledRectangle: component.length === columns * rows,
      tileCount: component.length,
    });
  }

  return components.sort((left, right) => {
    if (left.extent.minY !== right.extent.minY) {
      return left.extent.minY - right.extent.minY;
    }
    return left.extent.minX - right.extent.minX;
  });
}

function rectanglePolygon(aabb) {
  return [
    { x: aabb.minX, y: aabb.minY },
    { x: aabb.maxX, y: aabb.minY },
    { x: aabb.maxX, y: aabb.maxY },
    { x: aabb.minX, y: aabb.maxY },
  ];
}

function rectangleContains(outer, inner) {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  );
}

function rectanglesOverlap(first, second) {
  return !(
    first.maxX <= second.minX ||
    first.minX >= second.maxX ||
    first.maxY <= second.minY ||
    first.minY >= second.maxY
  );
}

function unionAxisAlignedRectangles(rectangles) {
  const xs = [...new Set(rectangles.flatMap((rect) => [rect.minX, rect.maxX]))].sort(
    (left, right) => left - right,
  );
  const ys = [...new Set(rectangles.flatMap((rect) => [rect.minY, rect.maxY]))].sort(
    (left, right) => left - right,
  );
  const filled = new Set();

  for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) {
    for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
      const center = {
        x: (xs[xIndex] + xs[xIndex + 1]) / 2,
        y: (ys[yIndex] + ys[yIndex + 1]) / 2,
      };

      if (
        rectangles.some(
          (rect) =>
            center.x > rect.minX &&
            center.x < rect.maxX &&
            center.y > rect.minY &&
            center.y < rect.maxY,
        )
      ) {
        filled.add(`${xIndex},${yIndex}`);
      }
    }
  }

  const edges = [];

  for (const key of filled) {
    const [xIndex, yIndex] = key.split(",").map(Number);
    const x0 = xs[xIndex];
    const x1 = xs[xIndex + 1];
    const y0 = ys[yIndex];
    const y1 = ys[yIndex + 1];

    if (!filled.has(`${xIndex},${yIndex - 1}`)) {
      edges.push([{ x: x0, y: y0 }, { x: x1, y: y0 }]);
    }
    if (!filled.has(`${xIndex + 1},${yIndex}`)) {
      edges.push([{ x: x1, y: y0 }, { x: x1, y: y1 }]);
    }
    if (!filled.has(`${xIndex},${yIndex + 1}`)) {
      edges.push([{ x: x1, y: y1 }, { x: x0, y: y1 }]);
    }
    if (!filled.has(`${xIndex - 1},${yIndex}`)) {
      edges.push([{ x: x0, y: y1 }, { x: x0, y: y0 }]);
    }
  }

  const outgoing = new Map();

  for (const edge of edges) {
    const key = `${edge[0].x},${edge[0].y}`;
    assertCondition(!outgoing.has(key), "Rectangle union produced an ambiguous boundary." );
    outgoing.set(key, edge[1]);
  }

  const start = [...outgoing.keys()]
    .map((key) => key.split(",").map(Number))
    .sort((left, right) => left[1] - right[1] || left[0] - right[0])[0];
  const startKey = `${start[0]},${start[1]}`;
  const polygon = [];
  let currentKey = startKey;

  do {
    const [x, y] = currentKey.split(",").map(Number);
    polygon.push({ x, y });
    const next = outgoing.get(currentKey);
    assertCondition(next, "Rectangle union boundary is open.");
    currentKey = `${next.x},${next.y}`;
  } while (currentKey !== startKey && polygon.length <= edges.length);

  assertCondition(currentKey === startKey, "Rectangle union boundary did not close.");
  assertCondition(polygon.length === edges.length, "Rectangle union produced multiple boundaries.");

  const simplified = polygon.filter((current, index) => {
    const previous = polygon[(index - 1 + polygon.length) % polygon.length];
    const next = polygon[(index + 1) % polygon.length];

    return !(
      (previous.x === current.x && current.x === next.x) ||
      (previous.y === current.y && current.y === next.y)
    );
  });

  return simplified;
}

function createCandidatePlayableRegion(colliders, anchorBodies, tileContext) {
  const evidencePoints = [
    ...colliders.flatMap((collider) => collider.geometry.worldPolygons.flat()),
    ...anchorBodies.flatMap((anchor) => anchor.worldBody.polygons.flat()),
  ];
  const rawEnvelope = calculateAabb([evidencePoints]);
  const snappedEnvelope = {
    maxX: Math.ceil(rawEnvelope.maxX / AUTHORING_GRID_SIZE) * AUTHORING_GRID_SIZE,
    maxY: Math.ceil(rawEnvelope.maxY / AUTHORING_GRID_SIZE) * AUTHORING_GRID_SIZE,
    minX: Math.floor(rawEnvelope.minX / AUTHORING_GRID_SIZE) * AUTHORING_GRID_SIZE,
    minY: Math.floor(rawEnvelope.minY / AUTHORING_GRID_SIZE) * AUTHORING_GRID_SIZE,
  };
  const pisoComponents = connectedTileComponents(tileContext.pisoCells);
  const additionalPisoComponents = pisoComponents.filter(
    (component) =>
      component.fullyFilledRectangle &&
      !rectangleContains(snappedEnvelope, component.extent) &&
      rectanglesOverlap(snappedEnvelope, component.extent),
  );

  assertCondition(
    additionalPisoComponents.length > 0,
    "No reproducible complete piso component extends the active evidence envelope.",
  );

  const activeEnvelopeCandidate = {
    derivation: {
      gridSnap: "outward_to_verified_16x16_grid",
      rawEvidenceAabb: rawEnvelope,
      sources: ["active_non_degenerate_blockers", "authorized_anchor_bodies"],
    },
    id: "active-evidence-envelope",
    polygonSet: [{ holes: [], outer: rectanglePolygon(snappedEnvelope) }],
    tradeoff:
      "Contains every active blocker and anchor, but joins spatially separate clusters and does not prove walkability.",
  };
  const unionPolygon = unionAxisAlignedRectangles([
    snappedEnvelope,
    ...additionalPisoComponents.map((component) => component.extent),
  ]);
  const pisoUnionCandidate = {
    derivation: {
      baseCandidateId: activeEnvelopeCandidate.id,
      includedPisoComponents: additionalPisoComponents,
      rule:
        "Exact orthogonal union with complete 4-connected piso components that extend and overlap the active evidence envelope.",
    },
    id: "active-evidence-plus-complete-piso-component",
    polygonSet: [{ holes: [], outer: unionPolygon }],
    tradeoff:
      "Preserves the complete southern piso component without using the full piso AABB, but piso is not authoritative walkability metadata.",
  };

  return {
    candidates: [activeEnvelopeCandidate, pisoUnionCandidate].sort((left, right) =>
      compareStrings(left.id, right.id),
    ),
    decision: "unresolved",
    rejectedRegions: [
      {
        id: "distant-floor1-duplicate",
        polygonSet: [
          {
            holes: [],
            outer: rectanglePolygon(
              tileContext.context.distantFloor1Duplicate.nonEmptyExtent,
            ),
          },
        ],
        reason: "Explicitly excluded distant duplicate floor instance.",
        sourcePersistentUuid:
          tileContext.context.distantFloor1Duplicate.persistentUuid,
      },
      {
        id: "full-visual-background-footprint",
        polygonSet: [
          {
            holes: [],
            outer: rectanglePolygon(
              tileContext.context.fullVisualBackgroundFootprint,
            ),
          },
        ],
        reason:
          "Ground and GroundDetails are visual background and do not define physical walkability.",
      },
    ].sort((left, right) => compareStrings(left.id, right.id)),
    selectedCandidateId: null,
    status: "pending_manual_approval",
  };
}

function validateAnchors(project, bodyProfiles, colliders, candidatePlayableRegion) {
  const worldConfig = readGlobalVariable(project, "WorldConfig");
  const configuredEntry = {
    direction: childVariable(worldConfig, "DefaultDirection"),
    id: AUTHORIZED_RECOVERY_ENTRY.id,
    mapId: childVariable(worldConfig, "DefaultMap"),
    x: childVariable(worldConfig, "DefaultSpawnX"),
    y: childVariable(worldConfig, "DefaultSpawnY"),
  };

  assertCondition(
    JSON.stringify(configuredEntry) === JSON.stringify(AUTHORIZED_RECOVERY_ENTRY),
    "WorldConfig recovery entry no longer matches the authorized MAP_1 anchor.",
  );

  const profileById = new Map(bodyProfiles.map((profile) => [profile.id, profile]));
  const anchors = [
    {
      ...configuredEntry,
      bodyProfileId: "character",
      collisionChannel: "player",
      kind: "player_recovery_entry",
    },
    ...AUTHORIZED_MONSTER_SPAWNS.map((spawn) => ({
      ...spawn,
      collisionChannel: "monster",
      kind: "monster_spawn",
    })),
  ];

  return anchors
    .map((anchor) => {
      [anchor.x, anchor.y].forEach((value, index) =>
        assertFiniteNumber(value, `${anchor.id} coordinate ${index}`),
      );
      const bodyProfile = profileById.get(anchor.bodyProfileId);

      assertCondition(bodyProfile, `${anchor.id} references a missing body profile.`);
      const worldBody = createAnchorWorldBody(anchor, bodyProfile);
      const insideCandidateIds = candidatePlayableRegion.candidates
        .filter((candidate) => bodyInsideCandidate(worldBody, candidate))
        .map((candidate) => candidate.id)
        .sort(compareStrings);

      assertCondition(
        insideCandidateIds.length === candidatePlayableRegion.candidates.length,
        `${anchor.id} is outside at least one candidate playable region.`,
      );
      assertCondition(
        !bodyOverlapsColliders(worldBody, colliders, anchor.collisionChannel),
        `${anchor.id} overlaps an authoritative ${anchor.collisionChannel} blocker.`,
      );

      return {
        ...anchor,
        validation: {
          finiteCoordinates: true,
          insideCandidateIds,
          overlapsBlockingCollider: false,
          validForEveryCandidate: true,
        },
        worldBody,
      };
    })
    .sort((left, right) => compareStrings(left.id, right.id));
}

function summarizeColliders(extracted) {
  const effectivePolygons = extracted.colliders.flatMap(
    (collider) => collider.geometry.polygonAnalysis,
  );
  const countForChannel = (channel) => {
    const categories = extracted.categorySummary.filter((category) =>
      category.collisionChannels.includes(channel),
    );

    return {
      effectiveColliderCount: categories.reduce(
        (sum, category) => sum + category.effectiveColliderCount,
        0,
      ),
      polygonCount: categories.reduce((sum, category) => sum + category.polygonCount, 0),
      sourceInstanceCount: categories.reduce(
        (sum, category) => sum + category.sourceInstanceCount,
        0,
      ),
    };
  };

  return {
    categoryCount: extracted.categorySummary.length,
    concavePolygonCount: effectivePolygons.filter(
      (polygon) => polygon.classification === "concave",
    ).length,
    convexPolygonCount: effectivePolygons.filter(
      (polygon) => polygon.classification === "convex",
    ).length,
    degenerateDiagnosticCount: extracted.degenerateMasks.length,
    effectiveColliderCount: extracted.colliders.length,
    effectivePolygonCount: effectivePolygons.length,
    monsterChannel: countForChannel("monster"),
    monsterOnlyColliderCount: extracted.colliders.filter(
      (collider) =>
        collider.collisionChannels.length === 1 &&
        collider.collisionChannels[0] === "monster",
    ).length,
    playerChannel: countForChannel("player"),
    playerOnlyColliderCount: extracted.colliders.filter(
      (collider) =>
        collider.collisionChannels.length === 1 &&
        collider.collisionChannels[0] === "player",
    ).length,
    sharedColliderCount: extracted.colliders.filter(
      (collider) => collider.collisionChannels.length === 2,
    ).length,
    sourceInstanceCount: extracted.categorySummary.reduce(
      (sum, category) => sum + category.sourceInstanceCount,
      0,
    ),
  };
}

export function buildWorldArtifact({ projectPath }) {
  assertCondition(
    typeof projectPath === "string" && projectPath.length > 0,
    "A canonical GDevelop project path is required.",
  );

  const absoluteProjectPath = resolve(projectPath);

  assertCondition(existsSync(absoluteProjectPath), `Canonical project is missing: ${projectPath}`);
  assertCondition(
    basename(absoluteProjectPath) === EXPECTED_PROJECT_FILE,
    `Only ${EXPECTED_PROJECT_FILE} may be used as the canonical source.`,
  );

  const projectRoot = dirname(absoluteProjectPath);
  const projectBytes = readFileSync(absoluteProjectPath);
  const project = parseJson(projectBytes, EXPECTED_PROJECT_FILE);

  assertCondition(
    project.firstLayout === EXPECTED_FIRST_LAYOUT,
    `firstLayout must remain ${EXPECTED_FIRST_LAYOUT}.`,
  );

  const layouts = project.layouts?.filter((layout) => layout.name === MAP_ID) ?? [];

  assertCondition(layouts.length === 1, `${MAP_ID} layout is missing or ambiguous.`);

  const layout = layouts[0];
  assertCondition(Array.isArray(layout.instances), `${MAP_ID} instances are missing.`);

  const objectRegistry = createObjectRegistry(project, layout);
  const resourceRegistry = createResourceRegistry(project, projectRoot);
  const classifications = validateCollisionClassifications(project, layout);
  const extractedColliders = extractColliders(
    layout,
    objectRegistry,
    resourceRegistry,
    classifications,
  );
  const bodies = extractBodyProfiles(objectRegistry);
  const tileContext = extractTileMapContext(
    layout,
    objectRegistry,
    resourceRegistry,
  );

  const provisionalAnchors = [
    {
      ...AUTHORIZED_RECOVERY_ENTRY,
      bodyProfileId: "character",
    },
    ...AUTHORIZED_MONSTER_SPAWNS,
  ].map((anchor) => ({
    ...anchor,
    worldBody: createAnchorWorldBody(
      anchor,
      bodies.bodyProfiles.find((profile) => profile.id === anchor.bodyProfileId),
    ),
  }));
  const candidatePlayableRegion = createCandidatePlayableRegion(
    extractedColliders.colliders,
    provisionalAnchors,
    tileContext,
  );
  const anchors = validateAnchors(
    project,
    bodies.bodyProfiles,
    extractedColliders.colliders,
    candidatePlayableRegion,
  );
  const summary = summarizeColliders(extractedColliders);

  const artifact = {
    anchors: {
      monsterSpawns: anchors.filter((anchor) => anchor.kind === "monster_spawn"),
      recoveryEntries: anchors.filter(
        (anchor) => anchor.kind === "player_recovery_entry",
      ),
    },
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    bodyProfiles: bodies.bodyProfiles,
    candidatePlayableRegion,
    collisionChannels: [
      {
        blockerObjects: classifications.monster,
        id: "monster",
      },
      {
        blockerObjects: classifications.player,
        id: "player",
      },
    ],
    colliders: extractedColliders.colliders,
    combatGeometry: bodies.combatGeometry,
    coordinateSystem: {
      angleDirection: "clockwise",
      angleUnit: "degree",
      authoringGrid: {
        height: AUTHORING_GRID_SIZE,
        snapEnabled: false,
        width: AUTHORING_GRID_SIZE,
      },
      origin: "top_left",
      unit: "pixel",
      xAxis: "right",
      yAxis: "down",
    },
    diagnostics: {
      categorySummary: extractedColliders.categorySummary,
      degenerateMasks: extractedColliders.degenerateMasks,
      dormantColliderObjects: DORMANT_BLOCKER_OBJECTS.map((objectName) => ({
        objectName,
        sourceInstanceCount: layout.instances.filter(
          (instance) => instance.name === objectName,
        ).length,
      })),
      summary,
      warnings: [
        {
          code: "candidate_region_unresolved",
          message:
            "Candidate playable regions require manual approval and have no gameplay effect.",
        },
        {
          code: "degenerate_selected_masks",
          count: extractedColliders.degenerateMasks.length,
          message:
            "Selected zero-area masks were preserved as diagnostics without visual rectangle fallback.",
        },
        {
          code: "distant_floor_duplicate_excluded",
          message: "The distant floor1_Map1 duplicate is excluded from every candidate.",
        },
        {
          code: "full_background_excluded",
          message:
            "Ground and GroundDetails full visual footprint is excluded from every candidate.",
        },
        {
          code: "tiled_collision_absent",
          message: "The active Tiled map and tileset contain no collision geometry.",
        },
      ].sort((left, right) => compareStrings(left.code, right.code)),
    },
    exporterVersion: EXPORTER_VERSION,
    mapContext: tileContext.context,
    mapId: MAP_ID,
    source: {
      project: {
        file: EXPECTED_PROJECT_FILE,
        sha256: sha256(projectBytes),
        sizeBytes: projectBytes.length,
      },
      resources: resourceRegistry.toManifest(),
    },
  };

  validateJsonValue(artifact);
  assertNoAbsolutePaths(artifact);

  return artifact;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function svgPolygon(points, attributes) {
  const serializedPoints = points.map((point) => `${point.x},${point.y}`).join(" ");

  return `<polygon points="${serializedPoints}" ${attributes} />`;
}

export function createSvgPreview(artifact) {
  const mainCandidates = artifact.candidatePlayableRegion.candidates;
  const duplicate = artifact.candidatePlayableRegion.rejectedRegions.find(
    (region) => region.id === "distant-floor1-duplicate",
  );
  const visiblePoints = [
    ...mainCandidates.flatMap((candidate) =>
      candidate.polygonSet.flatMap((polygon) => polygon.outer),
    ),
    ...duplicate.polygonSet.flatMap((polygon) => polygon.outer),
  ];
  const visibleAabb = calculateAabb([visiblePoints]);
  const margin = 128;
  const viewBox = {
    maxX: visibleAabb.maxX + margin,
    maxY: visibleAabb.maxY + margin,
    minX: visibleAabb.minX - margin,
    minY: visibleAabb.minY - margin,
  };
  const width = viewBox.maxX - viewBox.minX;
  const height = viewBox.maxY - viewBox.minY;
  const majorLines = [];

  for (
    let x = Math.floor(viewBox.minX / 128) * 128;
    x <= viewBox.maxX;
    x += 128
  ) {
    majorLines.push(
      `<line x1="${x}" y1="${viewBox.minY}" x2="${x}" y2="${viewBox.maxY}" class="major-grid" />`,
      `<text x="${x + 4}" y="${viewBox.minY + 28}" class="coordinate">${x}</text>`,
    );
  }
  for (
    let y = Math.floor(viewBox.minY / 128) * 128;
    y <= viewBox.maxY;
    y += 128
  ) {
    majorLines.push(
      `<line x1="${viewBox.minX}" y1="${y}" x2="${viewBox.maxX}" y2="${y}" class="major-grid" />`,
      `<text x="${viewBox.minX + 6}" y="${y - 5}" class="coordinate">${y}</text>`,
    );
  }

  const candidateColors = ["#16a34a", "#0f766e", "#65a30d"];
  const candidateShapes = mainCandidates.flatMap((candidate, candidateIndex) =>
    candidate.polygonSet.map((polygon) =>
      svgPolygon(
        polygon.outer,
        `fill="${candidateColors[candidateIndex]}" fill-opacity="0.05" stroke="${candidateColors[candidateIndex]}" stroke-width="5" stroke-dasharray="${candidateIndex === 0 ? "none" : "18 10"}" class="world-shape"`,
      ),
    ),
  );
  const colliderShapes = artifact.colliders.flatMap((collider) => {
    const channelKey = collider.collisionChannels.join("+");
    const color =
      channelKey === "monster+player"
        ? "#7c3aed"
        : channelKey === "monster"
          ? "#f97316"
          : "#2563eb";

    return collider.geometry.worldPolygons.map((polygon) =>
      svgPolygon(
        polygon,
        `fill="${color}" fill-opacity="0.32" stroke="${color}" stroke-width="2" class="world-shape" data-collider-id="${escapeXml(collider.id)}"`,
      ),
    );
  });
  const degenerateShapes = artifact.diagnostics.degenerateMasks.map((diagnostic) => {
    const { x, y } = diagnostic.transform.position;

    return `<g class="world-shape"><line x1="${x - 7}" y1="${y - 7}" x2="${x + 7}" y2="${y + 7}" class="degenerate" /><line x1="${x + 7}" y1="${y - 7}" x2="${x - 7}" y2="${y + 7}" class="degenerate" /></g>`;
  });
  const anchorShapes = [
    ...artifact.anchors.recoveryEntries,
    ...artifact.anchors.monsterSpawns,
  ].flatMap((anchor) => {
    const color =
      anchor.kind === "player_recovery_entry"
        ? "#22c55e"
        : anchor.bodyProfileId === "mob_hare"
          ? "#eab308"
          : "#dc2626";
    const marker =
      anchor.kind === "player_recovery_entry"
        ? `<circle cx="${anchor.x}" cy="${anchor.y}" r="9" fill="${color}" class="world-shape" />`
        : anchor.bodyProfileId === "mob_hare"
          ? svgPolygon(
              [
                { x: anchor.x, y: anchor.y - 10 },
                { x: anchor.x + 10, y: anchor.y },
                { x: anchor.x, y: anchor.y + 10 },
                { x: anchor.x - 10, y: anchor.y },
              ],
              `fill="${color}" class="world-shape"`,
            )
          : `<rect x="${anchor.x - 9}" y="${anchor.y - 9}" width="18" height="18" fill="${color}" class="world-shape" />`;

    return [
      ...anchor.worldBody.polygons.map((polygon) =>
        svgPolygon(
          polygon,
          `fill="none" stroke="${color}" stroke-width="3" class="world-shape"`,
        ),
      ),
      marker,
      `<text x="${anchor.x + 14}" y="${anchor.y - 12}" class="anchor-label">${escapeXml(anchor.id)} (${anchor.x}, ${anchor.y})</text>`,
    ];
  });
  const duplicateShape = duplicate.polygonSet.map((polygon) =>
    svgPolygon(
      polygon.outer,
      'fill="#ef4444" fill-opacity="0.04" stroke="#ef4444" stroke-width="5" stroke-dasharray="20 12" class="world-shape"',
    ),
  );
  const legendX = viewBox.minX + 36;
  const legendY = viewBox.maxY - 330;
  const legendEntries = [
    ["#16a34a", "Candidate A: active evidence envelope"],
    ["#0f766e", "Candidate B: evidence + complete piso component"],
    ["#7c3aed", "Shared player + monster blocker"],
    ["#2563eb", "Player-only blocker"],
    ["#f97316", "Monster-only blocker"],
    ["#6b7280", "Zero-area mask diagnostic"],
    ["#22c55e", "Player recovery entry"],
    ["#eab308", "Hare spawn"],
    ["#dc2626", "Boar spawn"],
    ["#ef4444", "Excluded distant floor1_Map1 instance"],
  ];
  const legend = legendEntries
    .map(
      ([color, label], index) =>
        `<g transform="translate(${legendX}, ${legendY + index * 32})"><rect width="22" height="22" fill="${color}" /><text x="32" y="18" class="legend-text">${escapeXml(label)}</text></g>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="${viewBox.minX} ${viewBox.minY} ${width} ${height}">
  <title>Grandoria MAP_1 physical-world candidate preview</title>
  <desc>Generated deterministically from exported GDevelop coordinates. Candidate regions are pending manual approval and have no gameplay effect.</desc>
  <defs>
    <pattern id="minor-grid" width="16" height="16" patternUnits="userSpaceOnUse">
      <path d="M 16 0 L 0 0 0 16" fill="none" stroke="#cbd5e1" stroke-width="0.5" />
    </pattern>
  </defs>
  <style>
    .world-shape, .major-grid, .degenerate { vector-effect: non-scaling-stroke; }
    .major-grid { stroke: #94a3b8; stroke-width: 1; opacity: 0.45; }
    .coordinate { font: 18px monospace; fill: #475569; }
    .anchor-label { font: bold 22px sans-serif; fill: #111827; paint-order: stroke; stroke: white; stroke-width: 4px; }
    .legend-text { font: 22px sans-serif; fill: #111827; paint-order: stroke; stroke: white; stroke-width: 4px; }
    .degenerate { stroke: #6b7280; stroke-width: 3; }
  </style>
  <rect x="${viewBox.minX}" y="${viewBox.minY}" width="${width}" height="${height}" fill="#f8fafc" />
  <rect x="${viewBox.minX}" y="${viewBox.minY}" width="${width}" height="${height}" fill="url(#minor-grid)" />
  ${majorLines.join("\n  ")}
  ${candidateShapes.join("\n  ")}
  ${duplicateShape.join("\n  ")}
  ${colliderShapes.join("\n  ")}
  ${degenerateShapes.join("\n  ")}
  ${anchorShapes.join("\n  ")}
  <g aria-label="Legend">${legend}</g>
</svg>
`;
}

function parseArguments(argv) {
  const options = {
    check: false,
    outputPath: DEFAULT_OUTPUT_PATH,
    projectPath: null,
    svgPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--check") {
      options.check = true;
    } else if (argument === "--project") {
      options.projectPath = argv[++index] ?? null;
    } else if (argument === "--output") {
      options.outputPath = argv[++index] ?? null;
    } else if (argument === "--svg") {
      options.svgPath = argv[++index] ?? null;
    } else if (argument === "--help") {
      options.help = true;
    } else {
      fail(`Unknown exporter argument: ${argument}`);
    }
  }

  return options;
}

function usage() {
  return `Usage: node scripts/export-gdevelop-world.mjs --project <canonical-project> [--output <artifact>] [--check] [--svg <temporary-svg>]`;
}

function runCli(argv) {
  const options = parseArguments(argv);

  if (options.help) {
    console.log(usage());
    return;
  }

  assertCondition(options.projectPath, `${usage()}\n--project is required.`);
  assertCondition(options.outputPath, "--output requires a path.");

  const projectPath = resolve(options.projectPath);
  const outputPath = resolve(options.outputPath);
  const gameRoot = dirname(projectPath);
  const svgPath = options.svgPath ? resolve(options.svgPath) : null;

  assertCondition(
    pathsEqual(outputPath, DEFAULT_OUTPUT_PATH),
    `Artifact output is restricted to this checkpoint path: ${DEFAULT_OUTPUT_PATH}`,
  );
  assertCondition(
    !pathsEqual(outputPath, projectPath),
    "Artifact output must not overwrite the canonical project.",
  );

  if (svgPath) {
    assertCondition(
      !isPathInside(SERVER_ROOT, svgPath) && !isPathInside(gameRoot, svgPath),
      "SVG diagnostics must be generated outside both repositories.",
    );
  }

  const firstArtifact = buildWorldArtifact({ projectPath });
  const secondArtifact = buildWorldArtifact({ projectPath });
  const generatedText = serializeWorldArtifact(firstArtifact);
  const repeatedText = serializeWorldArtifact(secondArtifact);

  assertCondition(
    generatedText === repeatedText,
    "Exporter output is unstable for unchanged source bytes.",
  );

  if (options.check) {
    assertCondition(existsSync(outputPath), `Committed artifact is missing: ${outputPath}`);
    assertArtifactCurrent(generatedText, readFileSync(outputPath, "utf8"));
    console.log(`World artifact is current: ${outputPath}`);
  } else {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, generatedText, "utf8");
    console.log(`World artifact exported: ${outputPath}`);
  }

  if (svgPath) {
    mkdirSync(dirname(svgPath), { recursive: true });
    writeFileSync(svgPath, createSvgPreview(firstArtifact), "utf8");
    console.log(`SVG preview written: ${svgPath}`);
  }
}

const invokedAsEntryPoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsEntryPoint) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`World export failed: ${error.message}`);
    process.exitCode = 1;
  }
}
