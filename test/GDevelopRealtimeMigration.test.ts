import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCanonicalGDevelopProject } from "../scripts/resolve-gdevelop-project.mjs";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(TEST_DIRECTORY, "..");
const PROJECT_PATH = resolveCanonicalGDevelopProject({ serverRoot: SERVER_ROOT });

type JsonObject = Record<string, any>;

function visitObjects(value: unknown, callback: (value: JsonObject) => void) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => visitObjects(entry, callback));
    return;
  }

  const object = value as JsonObject;

  callback(object);
  Object.values(object).forEach((entry) => visitObjects(entry, callback));
}

function findGroup(root: unknown, name: string): JsonObject | undefined {
  let result: JsonObject | undefined;

  visitObjects(root, (entry) => {
    if (
      !result &&
      entry.type === "BuiltinCommonInstructions::Group" &&
      entry.name === name
    ) {
      result = entry;
    }
  });

  return result;
}

function findGroups(root: unknown): JsonObject[] {
  const groups: JsonObject[] = [];

  visitObjects(root, (entry) => {
    if (entry.type === "BuiltinCommonInstructions::Group") {
      groups.push(entry);
    }
  });

  return groups;
}

function findInlineBlocks(root: unknown): string[] {
  const blocks: string[] = [];

  visitObjects(root, (entry) => {
    if (Array.isArray(entry.inlineCode)) {
      blocks.push(entry.inlineCode.join("\n"));
    }
  });

  return blocks;
}

function findExtensionFunction(
  project: JsonObject,
  extensionName: string,
  functionName: string,
): JsonObject {
  const extension = project.eventsFunctionsExtensions.find(
    (entry: JsonObject) => entry.name === extensionName,
  );
  const eventsFunction = extension?.eventsFunctions?.find(
    (entry: JsonObject) => entry.name === functionName,
  );

  assert.ok(eventsFunction);

  return eventsFunction;
}

describe("GDevelop realtime migration closure", () => {
  const projectSource = readFileSync(PROJECT_PATH, "utf8");
  const project = JSON.parse(projectSource);
  const mapLayout = project.layouts.find(
    (entry: JsonObject) => entry.name === "MAP_1",
  );
  const mapEvents = project.externalEvents.find(
    (entry: JsonObject) => entry.name === "map1",
  );
  const characterEvents = project.externalEvents.find(
    (entry: JsonObject) => entry.name === "character",
  );
  const colyseusEvents = project.externalEvents.find(
    (entry: JsonObject) => entry.name === "colyseus",
  );

  it("removes the RTDB event sheet and its MAP_1 link", () => {
    assert.ok(mapLayout);
    assert.ok(colyseusEvents);
    assert.strictEqual(
      project.externalEvents.some(
        (entry: JsonObject) => entry.name === "firebase",
      ),
      false,
    );
    assert.strictEqual(
      mapLayout.events.some(
        (entry: JsonObject) =>
          entry.type === "BuiltinCommonInstructions::Link" &&
          entry.target === "firebase",
      ),
      false,
    );

    const activeEventSource = JSON.stringify({
      externalEvents: project.externalEvents,
      layoutEvents: project.layouts.map((layout: JsonObject) => layout.events),
      extensions: project.eventsFunctionsExtensions,
    });

    assert.doesNotMatch(activeEventSource, /Firebase::Database/);
    assert.doesNotMatch(activeEventSource, /firebase\.database/);
    assert.doesNotMatch(activeEventSource, /FIREBASE RTDB/);
  });

  it("keeps Firebase authentication and Firestore persistence", () => {
    assert.match(projectSource, /Firebase::IsSignedIn/);
    assert.match(projectSource, /Firebase::FirestoreWriteDocument/);
    assert.match(projectSource, /Firebase::FirestoreStartQuery/);
  });

  it("removes local monster authority from the active MAP_1 sheet", () => {
    assert.ok(mapEvents);
    assert.strictEqual(
      findGroup(
        mapEvents,
        "01 — MAP_1 — LOCAL MONSTERS STILL UNDER MIGRATION",
      ),
      undefined,
    );

    const remainingGroupNames = findGroups(mapEvents).map(
      (entry) => String(entry.name || ""),
    );

    assert.strictEqual(
      remainingGroupNames.some((name) => name.includes("LOCAL MOBS")),
      false,
    );
    assert.ok(
      findGroup(colyseusEvents, "03 — COLYSEUS — REMOTE MONSTERS"),
    );
  });

  it("prevents player controls from moving the remote boar", () => {
    const remoteBoar = mapLayout.objects.find(
      (entry: JsonObject) => entry.name === "Remote_mob_boar",
    );
    const movement = remoteBoar?.behaviors?.find(
      (entry: JsonObject) => entry.name === "TopDownMovement",
    );

    assert.ok(movement);
    assert.strictEqual(movement.ignoreDefaultControls, true);
  });

  it("interpolates both remote monster types from authoritative positions", () => {
    const remoteMonsterGroup = findGroup(
      colyseusEvents,
      "03 — COLYSEUS — REMOTE MONSTERS",
    );
    const blocks = findInlineBlocks(remoteMonsterGroup);

    assert.strictEqual(blocks.length, 1);
    assert.match(blocks[0], /__grandoriaMonsterInterpolation/);
    assert.match(blocks[0], /const interpolationSpeed = 12/);
    assert.match(blocks[0], /distance > 96/);
    assert.match(blocks[0], /Math\.round\(visual\.getY\(\)\)/);
    assert.doesNotThrow(() => {
      new Function("runtimeScene", "eventsFunctionContext", "gdjs", blocks[0]);
    });
  });

  it("converges the local visual position after the server confirms idle", () => {
    const localStateFunction = findExtensionFunction(
      project,
      "GrandoriaColyseus",
      "ApplyLocalPlayerState",
    );
    const [code] = findInlineBlocks(localStateFunction);

    assert.ok(code);
    assert.match(code, /const idleDeadZone = 0\.25/);
    assert.match(code, /const idleCorrectionSpeed = 12/);
    assert.match(code, /serverX - nextX/);
    assert.doesNotMatch(code, /Do not reposition the local player/);
    assert.doesNotThrow(() => {
      new Function("runtimeScene", "eventsFunctionContext", "gdjs", code);
    });
  });

  it("clears previous character inventory and equipment before loading another", () => {
    const loader = findInlineBlocks(characterEvents).find(
      (block) =>
        block.includes("// NORMAL CHARACTER LOADING") &&
        block.includes('globalVariables.get("equip_slots")'),
    );

    assert.ok(loader);

    const resetIndex = loader.indexOf(
      "inventory.clearChildren();\n  equipment.clearChildren();",
    );
    const inventoryCopyIndex = loader.indexOf(
      'activeCharacterData.getChild(\n      "Inventory"',
      resetIndex,
    );
    const equipmentCopyIndex = loader.indexOf(
      'activeCharacterData.getChild(\n      "Equipment"',
      resetIndex,
    );

    assert.ok(resetIndex >= 0);
    assert.ok(inventoryCopyIndex > resetIndex);
    assert.ok(equipmentCopyIndex > resetIndex);
  });

  it("resets connection and equipment history when the selected character changes", () => {
    const connectFunction = findExtensionFunction(
      project,
      "GrandoriaColyseus",
      "ConnectToServer",
    );
    const equipmentFunction = findExtensionFunction(
      project,
      "GrandoriaColyseus",
      "SyncLocalEquipmentState",
    );
    const [connectCode] = findInlineBlocks(connectFunction);
    const [equipmentCode] = findInlineBlocks(equipmentFunction);

    assert.match(
      connectCode,
      /const identityKey = JSON\.stringify\(\[\s*playerUid,\s*characterId,\s*mapId,/,
    );
    assert.match(
      connectCode,
      /leaveRoomSafely\(previousRoom\)\s*\.finally\(startConnection\)/,
    );
    assert.match(connectCode, /network\.equipmentSyncSessionId = null/);
    assert.match(
      equipmentCode,
      /network\.equipmentSyncSessionId !==\s*currentSessionId/,
    );
    assert.match(
      equipmentCode,
      /network\.lastSentEquipment =\s*Object\.create\(null\)/,
    );
  });

  it("shows diagnostics from the current Colyseus state only", () => {
    const diagnostics = findGroup(
      colyseusEvents,
      "06 — COLYSEUS — DIAGNOSTICS",
    );
    const blocks = findInlineBlocks(diagnostics);

    assert.ok(diagnostics);
    assert.strictEqual(blocks.length, 1);
    assert.match(blocks[0], /network\.syncedPlayers/);
    assert.match(blocks[0], /network\.syncedMonsters/);
    assert.match(blocks[0], /network\.syncedItems/);
    assert.doesNotMatch(blocks[0], /Presence|RTDB|SharedMobs/);
    assert.doesNotThrow(() => {
      new Function("runtimeScene", "eventsFunctionContext", "gdjs", blocks[0]);
    });
  });

  it("removes obsolete RTDB variables but keeps active Colyseus bridge variables", () => {
    const variableNames = new Set(
      mapLayout.variables.map((entry: JsonObject) => entry.name),
    );

    assert.strictEqual(variableNames.has("MultiplayerPresenceStatus"), false);
    assert.strictEqual(variableNames.has("SharedMobsStatus"), false);
    assert.strictEqual(variableNames.has("SharedHaresStatus"), false);
    assert.strictEqual(variableNames.has("SharedMobRegistry"), false);
    assert.strictEqual(variableNames.has("RemotePlayersStatus"), true);
    assert.strictEqual(variableNames.has("SharedItemsStatus"), true);
    assert.strictEqual(variableNames.has("SharedCollectStatus"), true);
  });
});
