import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ITEM_DEFINITIONS } from "../src/items/ItemCatalog.js";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_PATH = resolve(
  TEST_DIRECTORY,
  "..",
  "..",
  "grandoria-game",
  "RPG-2D-project-organized-by-systems-pre-combat-english.json",
);

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

  it("moves the active shared item flow out of the Firebase event sheet", () => {
    assert.ok(firebaseSheet);
    assert.ok(colyseusSheet);
    assert.ok(sharedItemsGroup);
    assert.strictEqual(
      findGroup(
        firebaseSheet,
        "02 — FIREBASE RTDB — SHARED ITEMS AND DROPS",
      ),
      undefined,
    );
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

    assert.deepStrictEqual(
      [...catalogEntries.entries()].sort(([first], [second]) =>
        first.localeCompare(second),
      ),
      Object.entries(ITEM_DEFINITIONS).sort(([first], [second]) =>
        first.localeCompare(second),
      ),
    );
  });
});
