import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ITEM_DEFINITIONS } from "../src/items/ItemCatalog.js";
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

function findInlineBlocks(root: unknown): string[] {
  const result: string[] = [];

  visitObjects(root, (entry) => {
    if (Array.isArray(entry.inlineCode)) {
      result.push(entry.inlineCode.join("\n"));
    }
  });

  return result;
}

function readVariableChildren(variable: JsonObject): Map<string, JsonObject> {
  return new Map(
    (Array.isArray(variable.children) ? variable.children : []).map(
      (child: JsonObject) => [child.name, child],
    ),
  );
}

describe("GDevelop Colyseus shared item migration", () => {
  const project = JSON.parse(readFileSync(PROJECT_PATH, "utf8"));
  const firebaseSheet = project.externalEvents.find(
    (entry: JsonObject) => entry.name === "firebase",
  );
  const colyseusSheet = project.externalEvents.find(
    (entry: JsonObject) => entry.name === "colyseus",
  );
  const sharedItemsGroup = findGroup(
    colyseusSheet,
    "05 — COLYSEUS — SHARED ITEMS AND DROPS",
  );

  it("keeps shared items on Colyseus after removing the RTDB event sheet", () => {
    assert.strictEqual(firebaseSheet, undefined);
    assert.ok(colyseusSheet);
    assert.ok(sharedItemsGroup);
  });

  it("contains no Firebase API use in the migrated shared item blocks", () => {
    const blocks = findInlineBlocks(sharedItemsGroup);

    assert.strictEqual(blocks.length, 3);

    for (const block of blocks) {
      assert.doesNotMatch(block, /firebase/i);
      assert.doesNotMatch(block, /itemsReference/);
      assert.doesNotThrow(() => {
        new Function("runtimeScene", "eventsFunctionContext", block);
      });
    }
  });

  it("registers item schema callbacks in the Colyseus connection", () => {
    const extension = project.eventsFunctionsExtensions.find(
      (entry: JsonObject) => entry.name === "GrandoriaColyseus",
    );
    const connectFunction = extension.eventsFunctions.find(
      (entry: JsonObject) => entry.name === "ConnectToServer",
    );
    const [connectCode] = findInlineBlocks(connectFunction);

    assert.match(connectCode, /network\.syncedItems/);
    assert.match(connectCode, /callbacks\.onAdd\(\s*"items"/);
    assert.match(connectCode, /callbacks\.onRemove\(\s*"items"/);
    assert.doesNotThrow(() => {
      new Function("runtimeScene", "eventsFunctionContext", connectCode);
    });
  });

  it("keeps the server item catalog aligned with GDevelop item metadata", () => {
    const itemsData = project.variables.find(
      (entry: JsonObject) => entry.name === "items_data",
    );
    const catalogEntries = new Map<string, JsonObject>();

    for (const typeVariable of itemsData.children) {
      for (const subTypeVariable of typeVariable.children) {
        for (const itemVariable of subTypeVariable.children) {
          const itemChildren = readVariableChildren(itemVariable);

          catalogEntries.set(itemVariable.name, {
            maxStack: itemChildren.get("max_stack")?.value,
            subType: subTypeVariable.name,
            type: typeVariable.name,
          });
        }
      }
    }

    const serverCatalogEntries = Object.entries(ITEM_DEFINITIONS).map(
      ([itemID, definition]) => [
        itemID,
        {
          maxStack: definition.maxStack,
          subType: definition.subType,
          type: definition.type,
        },
      ] as const,
    );

    assert.deepStrictEqual(
      [...catalogEntries.entries()].sort(([first], [second]) =>
        first.localeCompare(second),
      ),
      serverCatalogEntries.sort(([first], [second]) =>
        first.localeCompare(second),
      ),
    );
  });

  it("uses one canonical global visual object for every catalog item", () => {
    const itemIDs = Object.keys(ITEM_DEFINITIONS).sort();

    for (const itemID of itemIDs) {
      const matches = project.objects.filter(
        (object: JsonObject) => object.name === itemID,
      );

      assert.strictEqual(matches.length, 1, `${itemID} visual must be unique.`);
      assert.strictEqual(matches[0].type, "Sprite");
      assert.strictEqual(matches[0].animations[0]?.name, itemID);
      assert.ok(matches[0].animations[0]?.directions[0]?.sprites.length > 0);
    }

    const legacyItemsObject = project.objects.find(
      (object: JsonObject) => object.name === "items",
    );

    assert.ok(legacyItemsObject);
    assert.deepStrictEqual(
      legacyItemsObject.animations.map((animation: JsonObject) => animation.name),
      ["legacy_disabled"],
    );
    assert.strictEqual(
      project.objects.some(
        (object: JsonObject) => object.name === "market_slot_item",
      ),
      false,
    );

    const mapLayout = project.layouts.find(
      (layout: JsonObject) => layout.name === "MAP_1",
    );
    const marketSlotObject = mapLayout.objects.find(
      (object: JsonObject) => object.name === "market_slot",
    );

    assert.ok(marketSlotObject);
    assert.deepStrictEqual(
      marketSlotObject.animations.map(
        (animation: JsonObject) => animation.name,
      ),
      ["background"],
    );
  });

  it("creates ground drops and market icons from the canonical item objects", () => {
    const sharedItemsCode = findInlineBlocks(sharedItemsGroup).join("\n");
    const genericVisualsGroup = findGroup(
      project,
      "INVENTORY — GENERIC ITEM VISUALS",
    );

    assert.ok(genericVisualsGroup);

    const genericVisualsCode = findInlineBlocks(genericVisualsGroup).join("\n");

    assert.match(
      sharedItemsCode,
      /runtimeScene\.createObject\(\s*itemID\s*\)/,
    );
    assert.doesNotMatch(
      sharedItemsCode,
      /runtimeScene\.createObject\(\s*"items"\s*\)/,
    );
    assert.match(
      sharedItemsCode,
      /Object\.values\(\s*sharedItemsState\.visuals\s*\)/,
    );
    assert.match(sharedItemsCode, /\.get\("item_id"\)/);

    assert.match(genericVisualsCode, /marketSlots/);
    assert.match(
      genericVisualsCode,
      /runtimeScene\.getObjects\("market_slot"\)/,
    );
    assert.match(genericVisualsCode, /createVisual\(itemID, "market"\)/);
    assert.doesNotThrow(() => {
      new Function("runtimeScene", genericVisualsCode);
    });
  });

  it("does not read item identity from aggregate slot animations", () => {
    const marketLoadGroup = findGroup(
      project,
      "MARKET — CLEAR AND LOAD ITEMS",
    );
    const marketSelectionGroup = findGroup(project, "MARKET — SELECT ITEM");

    assert.ok(marketLoadGroup);
    assert.ok(marketSelectionGroup);

    const serializedMarket = JSON.stringify([
      marketLoadGroup,
      marketSelectionGroup,
    ]);

    assert.doesNotMatch(
      serializedMarket,
      /slot_item_display\.Animation::Name\(\)/,
    );
    assert.match(
      serializedMarket,
      /inventory\[slot_item_display\.slot_index\]\.id/,
    );

    const marketSlotAnimationValues: string[] = [];

    visitObjects(marketLoadGroup, (entry) => {
      if (
        entry.type?.value ===
          "AnimatableCapability::AnimatableBehavior::SetName" &&
        entry.parameters?.[0] === "market_slot"
      ) {
        marketSlotAnimationValues.push(entry.parameters[3]);
      }
    });

    assert.deepStrictEqual(marketSlotAnimationValues, ['"background"']);
  });
});
