import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildQuestCatalog, buildWorldArtifact, serializeQuestCatalog } from "../scripts/export-gdevelop-world.mjs";
import { resolveCanonicalGDevelopProject, CANONICAL_GDEVELOP_PROJECT_FILE } from "../scripts/resolve-gdevelop-project.mjs";

type GdVariable = Record<string, unknown>;

const str = (name: string, value: string): GdVariable => ({ name, type: "string", value });
const num = (name: string, value: number): GdVariable => ({ name, type: "number", value });
const bool = (name: string, value: boolean): GdVariable => ({ name, type: "boolean", value });
const struct = (name: string, children: GdVariable[]): GdVariable => ({ name, type: "structure", children });
const arr = (name: string, children: GdVariable[]): GdVariable => ({ name, type: "array", children });

const SOURCE_PROJECT_PATH = resolveCanonicalGDevelopProject();
const SOURCE_PROJECT_ROOT = dirname(SOURCE_PROJECT_PATH);
const SOURCE_WORLD = buildWorldArtifact({ projectPath: SOURCE_PROJECT_PATH });
const ACTIVE_RESOURCE_FILES = SOURCE_WORLD.source.resources.map((resource: any) => resource.file as string);

function copyActiveResources(directory: string) {
  for (const relativeFile of ACTIVE_RESOURCE_FILES) {
    const targetFile = join(directory, relativeFile);
    mkdirSync(dirname(targetFile), { recursive: true });
    copyFileSync(join(SOURCE_PROJECT_ROOT, relativeFile), targetFile);
  }
}

function questVariable(targetItem = "rabbit_skin", duplicateObjective = false): GdVariable {
  const objectives = [
    struct("0", [str("objective_id", "kill_hare"), str("type", "kill"), str("target_id", "mob_hare"), num("quantity", 1), num("order", 0)]),
    struct("1", [str("objective_id", duplicateObjective ? "kill_hare" : "collect_skin"), str("type", "collect"), str("target_id", targetItem), num("quantity", 1), num("order", 1)]),
  ];

  return struct("quest_export_test", [
    str("quest_id", "quest_export_test"),
    str("title", "Export Test"),
    str("description", "Automated fixture only."),
    str("offer_npc_id", "npc_trader_merchant"),
    struct("turn_in", [str("type", "npc"), str("target_id", "npc_trader_merchant")]),
    arr("prerequisites", []),
    arr("objectives", objectives),
    struct("rewards", [num("xp", 10), num("gold", 0), num("gem", 0), arr("items", [])]),
    str("next_quest_id", ""),
    bool("repeatable", false),
    str("initial_state", "available"),
    struct("dialogue", [str("offer", "Offer"), str("active", "Active"), str("ready", "Ready"), str("completed", "Done")]),
    bool("tracking_allowed", true),
    struct("credit", [str("mode", "solo")]),
  ]);
}

function writeFixture(directory: string, mutate: (project: any) => void) {
  const project = JSON.parse(readFileSync(SOURCE_PROJECT_PATH, "utf8"));
  const map = project.layouts.find((layout: any) => layout.name === "MAP_1");

  for (const instance of map?.instances ?? []) {
    if (instance.name !== "QuestRegion") continue;
    for (const variable of instance.initialVariables ?? []) {
      if (variable.name === "AccessQuestID" || variable.name === "AssociatedQuestID") {
        variable.value = "";
      }
    }
  }

  mutate(project);
  copyActiveResources(directory);
  const targetPath = join(directory, CANONICAL_GDEVELOP_PROJECT_FILE);
  writeFileSync(targetPath, JSON.stringify(project), "utf8");
  return targetPath;
}

describe("Quest GDevelop exporter", () => {
  let temporaryDirectory = "";

  beforeEach(() => { temporaryDirectory = mkdtempSync(join(tmpdir(), "grandoria-quest-export-")); });
  afterEach(() => { rmSync(temporaryDirectory, { recursive: true, force: true }); });

  it("exports a deterministic validated quest catalog from quests_data", () => {
    const projectPath = writeFixture(temporaryDirectory, (project) => {
      const root = project.variables.find((variable: any) => variable.name === "quests_data");
      root.children = [questVariable()];
    });
    const first = buildQuestCatalog({ projectPath });
    const second = buildQuestCatalog({ projectPath });
    assert.deepStrictEqual((first.definitions as Record<string, any>).quest_export_test.objectives.map((objective: any) => objective.type), ["kill", "collect"]);
    assert.strictEqual(serializeQuestCatalog(first), serializeQuestCatalog(second));
  });

  it("rejects nonexistent item references", () => {
    const projectPath = writeFixture(temporaryDirectory, (project) => {
      project.variables.find((variable: any) => variable.name === "quests_data").children = [questVariable("missing_item")];
    });
    assert.throws(() => buildQuestCatalog({ projectPath }), /unknown item missing_item/);
  });

  it("rejects duplicate objective IDs in GDevelop", () => {
    const projectPath = writeFixture(temporaryDirectory, (project) => {
      project.variables.find((variable: any) => variable.name === "quests_data").children = [questVariable("rabbit_skin", true)];
    });
    assert.throws(() => buildQuestCatalog({ projectPath }), /duplicate objective ID kill_hare/);
  });
});
