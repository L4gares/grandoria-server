import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertArtifactCurrent,
  buildWorldArtifact,
  createSvgPreview,
  serializeWorldArtifact,
} from "../scripts/export-gdevelop-world.mjs";
import { resolveCanonicalGDevelopProject } from "../scripts/resolve-gdevelop-project.mjs";

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_PATH = resolveCanonicalGDevelopProject({ serverRoot: SERVER_ROOT });
const GAME_ROOT = dirname(PROJECT_PATH);
const EXPORTER_PATH = resolve(
  SERVER_ROOT,
  "scripts",
  "export-gdevelop-world.mjs",
);
const ARTIFACT_PATH = resolve(
  SERVER_ROOT,
  "src",
  "world",
  "maps",
  "MAP_1.world.json",
);

type Point = {
  x: number;
  y: number;
};

function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPathInside(parentPath: string, childPath: string) {
  const pathFromParent = relative(resolve(parentPath), resolve(childPath));

  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== ".." &&
      !isAbsolute(pathFromParent))
  );
}

function hashFile(filePath: string) {
  const bytes = readFileSync(filePath);
  const hashBytes = filePath.toLowerCase().endsWith(".json")
    ? Buffer.from(
        bytes
          .toString("utf8")
          .replaceAll("\r\n", "\n")
          .replaceAll("\r", "\n"),
        "utf8",
      )
    : bytes;

  return createHash("sha256").update(hashBytes).digest("hex");
}

function findCollider(artifact: any, instancePersistentUuid: string) {
  const collider = artifact.colliders.find(
    (entry: any) =>
      entry.source.instancePersistentUuid === instancePersistentUuid,
  );

  assert.ok(collider, `Missing collider ${instancePersistentUuid}`);

  return collider;
}

function findBodyProfile(artifact: any, id: string) {
  const profile = artifact.bodyProfiles.find((entry: any) => entry.id === id);

  assert.ok(profile, `Missing body profile ${id}`);

  return profile;
}

function assertPointClose(actual: Point, expected: Point, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual.x - expected.x) <= tolerance,
    `Expected x=${expected.x}, received ${actual.x}`,
  );
  assert.ok(
    Math.abs(actual.y - expected.y) <= tolerance,
    `Expected y=${expected.y}, received ${actual.y}`,
  );
}

function walkValues(value: unknown, visit: (entry: unknown) => void) {
  visit(value);

  if (Array.isArray(value)) {
    value.forEach((entry) => walkValues(entry, visit));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => walkValues(entry, visit));
  }
}

describe("MAP_1 deterministic GDevelop world exporter", () => {
  let artifact: any;
  let repeatedArtifact: any;
  let serializedArtifact: string;
  let repeatedSerializedArtifact: string;
  let temporaryDirectory: string;

  before(() => {
    temporaryDirectory = mkdtempSync(
      join(tmpdir(), "grandoria-world-export-"),
    );

    assert.strictEqual(isPathInside(SERVER_ROOT, temporaryDirectory), false);
    assert.strictEqual(isPathInside(GAME_ROOT, temporaryDirectory), false);

    artifact = buildWorldArtifact({ projectPath: PROJECT_PATH });
    repeatedArtifact = buildWorldArtifact({ projectPath: PROJECT_PATH });
    serializedArtifact = serializeWorldArtifact(artifact);
    repeatedSerializedArtifact = serializeWorldArtifact(repeatedArtifact);
  });

  after(() => {
    assert.strictEqual(isPathInside(resolve(tmpdir()), temporaryDirectory), true);
    rmSync(temporaryDirectory, { force: true, recursive: true });
  });

  it("produces byte-identical exports for unchanged sources", () => {
    assert.strictEqual(serializedArtifact, repeatedSerializedArtifact);
    assert.ok(serializedArtifact.endsWith("\n"));
    assert.ok(!serializedArtifact.endsWith("\n\n"));

    const firstPath = join(temporaryDirectory, "first.world.json");
    const secondPath = join(temporaryDirectory, "second.world.json");

    writeFileSync(firstPath, serializedArtifact, "utf8");
    writeFileSync(secondPath, repeatedSerializedArtifact, "utf8");
    assert.deepStrictEqual(readFileSync(firstPath), readFileSync(secondPath));
  });

  it("keeps collider ordering and IDs stable", () => {
    const ids = artifact.colliders.map((collider: any) => collider.id);
    const repeatedIds = repeatedArtifact.colliders.map(
      (collider: any) => collider.id,
    );

    assert.deepStrictEqual(ids, repeatedIds);
    assert.strictEqual(new Set(ids).size, ids.length);
    assert.deepStrictEqual(ids, [...ids].sort(compareStrings));
    artifact.colliders.forEach((collider: any) => {
      assert.strictEqual(
        collider.id,
        `MAP_1:collider:${collider.source.instancePersistentUuid}`,
      );
    });

    const resourceFiles = artifact.source.resources.map(
      (resource: any) => resource.file,
    );
    assert.deepStrictEqual(
      resourceFiles,
      [...resourceFiles].sort(compareStrings),
    );

    const diagnosticIds = artifact.diagnostics.degenerateMasks.map(
      (entry: any) => entry.source.instancePersistentUuid,
    );
    assert.deepStrictEqual(
      diagnosticIds,
      [...diagnosticIds].sort(compareStrings),
    );

    for (const [entries, getId] of [
      [artifact.collisionChannels, (entry: any) => entry.id],
      [artifact.bodyProfiles, (entry: any) => entry.id],
      [artifact.combatGeometry.monsterAttackMasks, (entry: any) => entry.id],
      [artifact.anchors.recoveryEntries, (entry: any) => entry.id],
      [artifact.anchors.monsterSpawns, (entry: any) => entry.id],
      [artifact.spawnRegions, (entry: any) => entry.id],
      [artifact.candidatePlayableRegion.candidates, (entry: any) => entry.id],
      [artifact.candidatePlayableRegion.rejectedRegions, (entry: any) => entry.id],
      [artifact.diagnostics.categorySummary, (entry: any) => entry.objectName],
      [artifact.diagnostics.dormantColliderObjects, (entry: any) => entry.objectName],
    ] as Array<[any[], (entry: any) => string]>) {
      const entryIds = entries.map(getId);
      assert.deepStrictEqual(entryIds, [...entryIds].sort(compareStrings));
    }
  });

  it("does not serialize machine-local absolute paths", () => {
    walkValues(artifact, (value) => {
      if (typeof value !== "string") {
        return;
      }

      assert.strictEqual(isAbsolute(value), false, value);
      assert.strictEqual(win32.isAbsolute(value), false, value);
      assert.strictEqual(value.startsWith("file:"), false, value);
    });

    artifact.source.resources.forEach((resource: any) => {
      assert.ok(!resource.file.split("/").includes(".."));
      assert.ok(!resource.file.includes("\\"));
    });
  });

  it("records canonical project and active resource hashes", () => {
    assert.match(artifact.source.project.sha256, /^[a-f0-9]{64}$/);
    assert.strictEqual(artifact.source.project.sha256, hashFile(PROJECT_PATH));

    const expectedCoreHashes = new Map([
      [
        "MAPA_1/Map1_TiledFiles/MAP1.json",
        "89f3a30268a67f71e971a78bb0fb5193b224f3f6142bf79635a933ef3384b784",
      ],
      [
        "MAPA_1/Map1_TiledFiles/MAP1_Tileset.json",
        "19b08c39c490b7ee8bed2c889e174ec102f4f03712dbebc94b47753e35790dc0",
      ],
      [
        "MAPA_1/Map1_TiledFiles/MAP_1_PNG.png",
        "7858b1108ec8fd35a53e22ffdb6363b67253c44ab64c28b50f6ec6e80898b06b",
      ],
    ]);

    for (const resource of artifact.source.resources) {
      const sourcePath = resolve(GAME_ROOT, ...resource.file.split("/"));

      assert.strictEqual(resource.sha256, hashFile(sourcePath));
      if (expectedCoreHashes.has(resource.file)) {
        assert.strictEqual(
          resource.sha256,
          expectedCoreHashes.get(resource.file),
        );
      }
    }

    assert.strictEqual(
      [...expectedCoreHashes.keys()].every((file) =>
        artifact.source.resources.some(
          (resource: any) => resource.file === file,
        ),
      ),
      true,
    );
  });

  it("applies exact origin, scale, position, and rectangle transforms", () => {
    const rectangle = findCollider(
      artifact,
      "757dfe23-2790-4730-b540-4c79851254b9",
    );

    assert.strictEqual(rectangle.geometry.sourceKind, "instance_rectangle");
    assert.deepStrictEqual(rectangle.transform.position, { x: 300, y: 480 });
    assert.deepStrictEqual(rectangle.geometry.worldPolygons[0], [
      { x: 300, y: 480 },
      { x: 416, y: 480 },
      { x: 416, y: 494 },
      { x: 300, y: 494 },
    ]);

    const tree = findCollider(
      artifact,
      "eaf31804-ad1c-4eae-a18b-ccaa612d85cd",
    );
    const expectedScaleX = 120 / 106;
    const expectedScaleY = 126.7924528301888 / 112;
    const sourcePoint = { x: 29.5, y: 102 };
    const expectedWorldPoint = {
      x: 128 + (sourcePoint.x - 53.5) * expectedScaleX,
      y: 576 + (sourcePoint.y - 100) * expectedScaleY,
    };

    assert.deepStrictEqual(tree.transform.origin, { x: 53.5, y: 100 });
    assert.strictEqual(tree.transform.scale.x, expectedScaleX);
    assert.strictEqual(tree.transform.scale.y, expectedScaleY);
    assert.deepStrictEqual(tree.geometry.sourcePolygons[0][0], sourcePoint);
    assertPointClose(tree.geometry.worldPolygons[0][0], expectedWorldPoint);
  });

  it("exports exactly 53 collision_floor_1 rectangles", () => {
    const colliders = artifact.colliders.filter(
      (collider: any) => collider.source.objectName === "collision_floor_1",
    );

    assert.strictEqual(colliders.length, 53);
    colliders.forEach((collider: any) => {
      assert.strictEqual(collider.geometry.sourceKind, "instance_rectangle");
      assert.deepStrictEqual(collider.collisionChannels, ["monster", "player"]);
      assert.strictEqual(collider.geometry.worldPolygons.length, 1);
    });
  });

  it("exports exactly 39 collision_mobs rectangles", () => {
    const colliders = artifact.colliders.filter(
      (collider: any) => collider.source.objectName === "collision_mobs",
    );

    assert.strictEqual(colliders.length, 39);
    colliders.forEach((collider: any) => {
      assert.strictEqual(collider.geometry.sourceKind, "instance_rectangle");
      assert.deepStrictEqual(collider.collisionChannels, ["monster"]);
    });
  });

  it("preserves all three one-pixel walls", () => {
    const fixtures = [
      {
        height: 32,
        uuid: "6fa789f5-2af6-4379-9d35-6d1d81ce3cae",
        width: 1,
        x: 416,
        y: 272,
      },
      {
        height: 46,
        uuid: "fe1ac288-aad1-488c-8cdf-19aa5d9922c6",
        width: 1,
        x: 608,
        y: 496,
      },
      {
        height: 48,
        uuid: "98249520-71fd-4f05-affe-af8215dd7443",
        width: 1,
        x: 415,
        y: 494,
      },
    ];

    fixtures.forEach((fixture) => {
      const collider = findCollider(artifact, fixture.uuid);

      assert.deepStrictEqual(collider.geometry.worldPolygons[0], [
        { x: fixture.x, y: fixture.y },
        { x: fixture.x + fixture.width, y: fixture.y },
        {
          x: fixture.x + fixture.width,
          y: fixture.y + fixture.height,
        },
        { x: fixture.x, y: fixture.y + fixture.height },
      ]);
    });
  });

  it("preserves multipolygon source masks", () => {
    const expectedMasks = new Map<string, Point[][]>([
      [
        "cabana1",
        [
          [
            { x: 18, y: 34.5 },
            { x: 87.5, y: 34.5 },
            { x: 88.5, y: 96.5 },
            { x: 87, y: 101.5 },
            { x: 17, y: 102 },
          ],
          [
            { x: 122.5, y: 93.5 },
            { x: 124, y: 34.5 },
            { x: 146.5, y: 34.5 },
            { x: 146.5, y: 102 },
            { x: 124.5, y: 101.5 },
          ],
          [
            { x: 87.5, y: 34.5 },
            { x: 124, y: 34.5 },
            { x: 122, y: 96.5 },
            { x: 118, y: 89.5 },
            { x: 94.5, y: 89.5 },
            { x: 89, y: 96.5 },
          ],
        ],
      ],
      [
        "fogueira1",
        [
          [
            { x: 6, y: 38.5 },
            { x: 1.5, y: 25 },
            { x: 4, y: 21 },
            { x: 10, y: 17 },
            { x: 21, y: 17 },
            { x: 27, y: 20.5 },
            { x: 30, y: 26.5 },
            { x: 30, y: 30 },
            { x: 26.5, y: 33 },
            { x: 14.5, y: 38.5 },
          ],
          [
            { x: 2.5, y: 13.5 },
            { x: 5, y: 14 },
            { x: 6, y: 15 },
            { x: 6, y: 17 },
            { x: 1.5, y: 17 },
          ],
          [
            { x: 26, y: 11.5 },
            { x: 29, y: 12.5 },
            { x: 29, y: 14 },
            { x: 26, y: 14 },
          ],
        ],
      ],
    ]);

    for (const [objectName, sourcePolygons] of expectedMasks) {
      const collider = artifact.colliders.find(
        (entry: any) => entry.source.objectName === objectName,
      );

      assert.ok(collider);
      assert.deepStrictEqual(collider.geometry.sourcePolygons, sourcePolygons);
      assert.deepStrictEqual(
        collider.geometry.worldPolygons,
        sourcePolygons.map((polygon) =>
          polygon.map((point) => ({
            x:
              collider.transform.position.x +
              (point.x - collider.transform.origin.x) *
                collider.transform.scale.x,
            y:
              collider.transform.position.y +
              (point.y - collider.transform.origin.y) *
                collider.transform.scale.y,
          })),
        ),
      );
      assert.strictEqual(collider.transform.angle, 0);
    }
  });

  it("preserves concave polygons without alteration", () => {
    const tree = artifact.colliders.find(
      (collider: any) => collider.source.objectName === "MagicTreevillage",
    );
    const cabin = artifact.colliders.find(
      (collider: any) => collider.source.objectName === "cabana1",
    );

    assert.ok(tree);
    assert.ok(cabin);
    assert.deepStrictEqual(tree.geometry.sourcePolygons[0], [
      { x: 29.5, y: 102 },
      { x: 17, y: 104.5 },
      { x: 14.5, y: 95 },
      { x: 11, y: 92 },
      { x: 11.5, y: 86.5 },
      { x: 19, y: 79.5 },
      { x: 89, y: 79.5 },
      { x: 97.5, y: 83 },
      { x: 97.5, y: 95.5 },
      { x: 90, y: 97 },
      { x: 89, y: 105.5 },
      { x: 77, y: 104 },
    ]);
    assert.strictEqual(
      tree.geometry.polygonAnalysis[0].classification,
      "concave",
    );
    assert.strictEqual(tree.geometry.sourcePolygons[0].length, 12);
    assert.strictEqual(
      cabin.geometry.polygonAnalysis[2].classification,
      "concave",
    );
    assert.strictEqual(cabin.geometry.sourcePolygons[2].length, 6);
    assert.strictEqual(
      artifact.diagnostics.summary.concavePolygonCount,
      10,
    );
  });

  it("reports degenerate masks without visual-bound fallbacks", () => {
    const expectedIds = [
      "025d4702-3ff3-4dd9-8271-182441362db5",
      "0c8e85e0-5b24-40a7-906d-a54adc6813c4",
      "13da3baf-8c0e-41b7-8f97-dd3c702de54d",
      "659a382b-0c7e-4a5e-bb88-9bb6d0dbc249",
      "71f8e275-4366-4ee1-9e00-03793557bcd1",
      "773d4be4-b8a4-476a-8c5d-f1fe0db522da",
      "cf774d81-6fa1-42f3-bc7d-05683bc65646",
    ];
    const diagnostics = artifact.diagnostics.degenerateMasks;

    assert.strictEqual(diagnostics.length, 7);
    assert.deepStrictEqual(
      diagnostics
        .map((entry: any) => entry.source.instancePersistentUuid)
        .sort(compareStrings),
      expectedIds,
    );
    diagnostics.forEach((entry: any) => {
      assert.strictEqual(entry.code, "zero_area_selected_mask");
      assert.strictEqual(entry.fallbackApplied, false);
      assert.ok(entry.geometry.sourcePolygons.length > 0);
      assert.ok(
        entry.geometry.polygonAnalysis.every(
          (polygon: any) => polygon.classification === "degenerate",
        ),
      );
      assert.strictEqual(
        artifact.colliders.some(
          (collider: any) =>
            collider.source.instancePersistentUuid ===
            entry.source.instancePersistentUuid,
        ),
        false,
      );
    });

    assert.strictEqual(
      artifact.combatGeometry.playerUnarmedAttackHitboxes
        .degenerateFrameMaskCount,
      13,
    );
    assert.strictEqual(
      artifact.combatGeometry.playerUnarmedAttackHitboxes.hitboxes.length,
      4,
    );
  });

  it("assigns exact player and monster collision channels", () => {
    const summary = artifact.diagnostics.summary;

    assert.deepStrictEqual(summary.playerChannel, {
      effectiveColliderCount: 78,
      polygonCount: 82,
      sourceInstanceCount: 85,
    });
    assert.deepStrictEqual(summary.monsterChannel, {
      effectiveColliderCount: 95,
      polygonCount: 99,
      sourceInstanceCount: 95,
    });
    assert.strictEqual(summary.sharedColliderCount, 56);
    assert.strictEqual(summary.playerOnlyColliderCount, 22);
    assert.strictEqual(summary.monsterOnlyColliderCount, 39);
    assert.strictEqual(summary.effectiveColliderCount, 117);
    assert.strictEqual(summary.sourceInstanceCount, 124);

    const playerObjects = artifact.collisionChannels.find(
      (channel: any) => channel.id === "player",
    ).blockerObjects;
    const monsterObjects = artifact.collisionChannels.find(
      (channel: any) => channel.id === "monster",
    ).blockerObjects;

    assert.deepStrictEqual(playerObjects, [
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
    ]);
    assert.deepStrictEqual(monsterObjects, [
      "MagicTreevillage",
      "cabana1",
      "collision_floor_1",
      "collision_mobs",
      "fogueira1",
    ]);
    artifact.diagnostics.dormantColliderObjects.forEach((entry: any) => {
      assert.strictEqual(entry.sourceInstanceCount, 0);
      assert.strictEqual(
        artifact.colliders.some(
          (collider: any) => collider.source.objectName === entry.objectName,
        ),
        false,
      );
    });
  });

  it("exports the stable character movement body", () => {
    const character = findBodyProfile(artifact, "character");

    assert.deepStrictEqual(character.aliases, ["character"]);
    assert.deepStrictEqual(character.movementBody.sourceOrigin, {
      x: 31.5,
      y: 44.5,
    });
    assert.deepStrictEqual(character.movementBody.originRelativePolygons[0], [
      { x: -6, y: -11 },
      { x: 6, y: -11 },
      { x: 6, y: -6 },
      { x: 3.5, y: -5 },
      { x: 3.5, y: -3 },
      { x: -3.5, y: -2.5 },
      { x: -3.5, y: -5 },
      { x: -6, y: -5.5 },
    ]);
    assert.strictEqual(
      character.movementBody.polygonAnalysis[0].classification,
      "concave",
    );
    assert.ok(!character.aliases.includes("Collision_attack_unarmed"));
  });

  it("exports the shared stable hare body", () => {
    const hare = findBodyProfile(artifact, "mob_hare");

    assert.deepStrictEqual(hare.aliases, ["mob_hare"]);
    assert.deepStrictEqual(hare.movementBody.sourceOrigin, {
      x: 15.5,
      y: 26.5,
    });
    assert.deepStrictEqual(hare.movementBody.originRelativePolygons[0], [
      { x: -6.5, y: -9.5 },
      { x: 7, y: -9.5 },
      { x: 7, y: 2.5 },
      { x: -6.5, y: 2.5 },
    ]);
    assert.strictEqual(hare.verification.verifiedFrameCount, 100);
    assert.strictEqual(
      hare.verification.stableMovementBodyDecision,
      "stable_across_all_frames",
    );
  });

  it("exports the baseline boar movement body", () => {
    const boar = findBodyProfile(artifact, "mob_boar");

    assert.deepStrictEqual(boar.aliases, ["mob_boar"]);
    assert.deepStrictEqual(boar.movementBody.sourceOrigin, {
      x: 16.5,
      y: 25.5,
    });
    assert.deepStrictEqual(boar.movementBody.originRelativePolygons[0], [
      { x: -6.5, y: -15 },
      { x: 5.5, y: -15 },
      { x: 5.5, y: -3.5 },
      { x: -6.5, y: -3.5 },
    ]);
    assert.strictEqual(boar.verification.baselineFrameCount, 116);
    assert.strictEqual(
      boar.verification.stableMovementBodyDecision,
      "dominant_baseline_with_attack_only_variants",
    );
  });

  it("keeps boar attack masks separate from movement body", () => {
    const boar = findBodyProfile(artifact, "mob_boar");
    const attacks = artifact.combatGeometry.monsterAttackMasks.filter(
      (attack: any) => attack.monsterType === "mob_boar",
    );

    assert.deepStrictEqual(
      attacks.map((attack: any) => attack.direction),
      ["down", "left", "right", "up"],
    );
    assert.ok(attacks.every((attack: any) => attack.frameIndex === 3));
    assert.deepStrictEqual(
      attacks.map((attack: any) => attack.originRelativePolygons[0].length),
      [11, 8, 5, 6],
    );
    attacks.forEach((attack: any) => {
      assert.notDeepStrictEqual(
        attack.originRelativePolygons,
        boar.movementBody.originRelativePolygons,
      );
    });
    assert.strictEqual(
      artifact.combatGeometry.playerUnarmedAttackHitboxes
        .excludedFromMovementBodies,
      true,
    );
  });

  it("validates the exact recovery entry", () => {
    assert.strictEqual(artifact.anchors.recoveryEntries.length, 1);
    const entry = artifact.anchors.recoveryEntries[0];

    assert.deepStrictEqual(
      {
        direction: entry.direction,
        id: entry.id,
        mapId: entry.mapId,
        x: entry.x,
        y: entry.y,
      },
      {
        direction: "down",
        id: "MAP_1/default",
        mapId: "MAP_1",
        x: 519,
        y: 626,
      },
    );
    assert.deepStrictEqual(entry.worldBody.polygons[0], [
      { x: 513, y: 615 },
      { x: 525, y: 615 },
      { x: 525, y: 620 },
      { x: 522.5, y: 621 },
      { x: 522.5, y: 623 },
      { x: 515.5, y: 623.5 },
      { x: 515.5, y: 621 },
      { x: 513, y: 620.5 },
    ]);
    assert.strictEqual(entry.validation.finiteCoordinates, true);
    assert.strictEqual(entry.validation.validForEveryCandidate, true);
    assert.strictEqual(entry.validation.overlapsBlockingCollider, false);
  });

  it("exports the exact Stage 4 spawn regions", () => {
    assert.deepStrictEqual(artifact.anchors.monsterSpawns, []);
    assert.deepStrictEqual(
      artifact.spawnRegions.map((region: any) => ({
        bounds: region.bounds,
        enabled: region.enabled,
        id: region.id,
        mapId: region.mapId,
        maxAlive: region.maxAlive,
        mobType: region.mobType,
        questRegionId: region.questRegionId,
        respawnSeconds: region.respawnSeconds,
        spawnPadding: region.spawnPadding,
      })),
      [
        {
          bounds: {
            maxX: 532.5,
            maxY: 1332.5,
            minX: 417.5,
            minY: 1187.5,
          },
          enabled: true,
          id: "deep_wilds_guardian_01",
          mapId: "MAP_1",
          maxAlive: 1,
          mobType: "mob_boar_guardian",
          questRegionId: "deep_wilds_01",
          respawnSeconds: 15,
          spawnPadding: 8,
        },
        {
          bounds: {
            maxX: 330.5,
            maxY: 1291.5,
            minX: 111.5,
            minY: 1110.5,
          },
          enabled: true,
          id: "grassland_boar_01",
          mapId: "MAP_1",
          maxAlive: 5,
          mobType: "mob_boar",
          questRegionId: "south_fields_01",
          respawnSeconds: 10,
          spawnPadding: 0,
        },
        {
          bounds: {
            maxX: 317,
            maxY: 1035.5,
            minX: 103,
            minY: 854.5,
          },
          enabled: true,
          id: "grassland_hare_01",
          mapId: "MAP_1",
          maxAlive: 3,
          mobType: "mob_hare",
          questRegionId: "south_fields_01",
          respawnSeconds: 10,
          spawnPadding: 0,
        },
      ],
    );
  });

  it("excludes the full visual footprint from every candidate", () => {
    const region = artifact.candidatePlayableRegion;
    const background = region.rejectedRegions.find(
      (entry: any) => entry.id === "full-visual-background-footprint",
    );

    assert.strictEqual(region.status, "pending_manual_approval");
    assert.strictEqual(region.decision, "unresolved");
    assert.strictEqual(region.selectedCandidateId, null);
    assert.ok(background);
    assert.deepStrictEqual(background.polygonSet[0].outer, [
      { x: -2096, y: -1648 },
      { x: 5792, y: -1648 },
      { x: 5792, y: 6112 },
      { x: -2096, y: 6112 },
    ]);

    const candidatePolygons = region.candidates.flatMap((candidate: any) =>
      candidate.polygonSet.map((polygon: any) => polygon.outer),
    );
    assert.strictEqual(
      candidatePolygons.some(
        (polygon: any) =>
          JSON.stringify(polygon) ===
          JSON.stringify(background.polygonSet[0].outer),
      ),
      false,
    );
  });

  it("does not reintroduce the removed distant floor1_Map1 duplicate", () => {
    const removedPersistentUuid = "648998ea-5c42-4d05-9644-6303cbf0a89e";

    assert.strictEqual(
      artifact.candidatePlayableRegion.rejectedRegions.some(
        (entry: any) =>
          entry.id === "distant-floor1-duplicate" ||
          entry.sourcePersistentUuid === removedPersistentUuid,
      ),
      false,
    );
    assert.strictEqual(
      artifact.mapContext.instances.some(
        (entry: any) => entry.persistentUuid === removedPersistentUuid,
      ),
      false,
    );
  });

  it("renders the SVG preview without the removed distant floor duplicate", () => {
    const svg = createSvgPreview(artifact);

    assert.match(svg, /Grandoria MAP_1 physical-world candidate preview/);
    assert.doesNotMatch(svg, /Excluded distant floor1_Map1 instance/);
  });

  it("stores exact unresolved candidate alternatives", () => {
    const candidates = new Map<string, any>(
      artifact.candidatePlayableRegion.candidates.map((candidate: any) => [
        candidate.id,
        candidate,
      ]),
    );

    assert.deepStrictEqual(
      candidates.get("active-evidence-envelope").polygonSet[0].outer,
      [
        { x: -256, y: -160 },
        { x: 944, y: -160 },
        { x: 944, y: 1472 },
        { x: -256, y: 1472 },
      ],
    );
    assert.deepStrictEqual(
      candidates.get("active-evidence-plus-complete-piso-component").polygonSet[0]
        .outer,
      [
        { x: -256, y: -160 },
        { x: 944, y: -160 },
        { x: 944, y: 1184 },
        { x: 1024, y: 1184 },
        { x: 1024, y: 1632 },
        { x: 736, y: 1632 },
        { x: 736, y: 1472 },
        { x: -256, y: 1472 },
      ],
    );
  });

  it("passes CLI check mode for the current committed artifact", () => {
    const before = readFileSync(ARTIFACT_PATH);
    const result = spawnSync(
      process.execPath,
      [
        EXPORTER_PATH,
        "--project",
        PROJECT_PATH,
        "--output",
        ARTIFACT_PATH,
        "--check",
      ],
      {
        cwd: SERVER_ROOT,
        encoding: "utf8",
        shell: false,
      },
    );

    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /artifact is current/i);
    assert.deepStrictEqual(readFileSync(ARTIFACT_PATH), before);
  });

  it("refuses unapproved artifact output paths without overwriting them", () => {
    const unapprovedOutputPath = join(
      temporaryDirectory,
      "unapproved-output.world.json",
    );
    const sentinel = "preserve-this-file\n";

    writeFileSync(unapprovedOutputPath, sentinel, "utf8");

    const result = spawnSync(
      process.execPath,
      [
        EXPORTER_PATH,
        "--project",
        PROJECT_PATH,
        "--output",
        unapprovedOutputPath,
      ],
      {
        cwd: SERVER_ROOT,
        encoding: "utf8",
        shell: false,
      },
    );

    assert.ifError(result.error);
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /output is restricted/i);
    assert.strictEqual(readFileSync(unapprovedOutputPath, "utf8"), sentinel);
  });

  it("detects a deliberately stale in-memory artifact", () => {
    const staleArtifact = structuredClone(artifact);

    staleArtifact.exporterVersion = "stale-test-fixture";
    const staleText = serializeWorldArtifact(staleArtifact);

    assert.throws(
      () => assertArtifactCurrent(serializedArtifact, staleText),
      /stale/i,
    );
  });

  it("contains no non-finite numeric values", () => {
    walkValues(artifact, (value) => {
      if (typeof value === "number") {
        assert.strictEqual(Number.isFinite(value), true);
      }
      if (typeof value === "string") {
        assert.ok(!["NaN", "Infinity", "-Infinity"].includes(value));
      }
    });
  });
});
