import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canClassUseSkill,
  resolveClassSkillAccess,
} from "../src/skills/ClassSkillAccess.js";

import {
  getClassDefinition,
} from "../src/classes/ClassCatalog.js";

import {
  getSkillDefinition,
} from "../src/skills/SkillCatalog.js";

type JsonRecord = Record<string, unknown>;

function readProject(): JsonRecord {
  const projectPath = process.env.GRANDORIA_GDEVELOP_PROJECT;

  assert.ok(
    projectPath,
    "GRANDORIA_GDEVELOP_PROJECT must select the current GDevelop project.",
  );

  return JSON.parse(readFileSync(projectPath, "utf8")) as JsonRecord;
}

function childrenOf(value: unknown): JsonRecord[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const children = (value as JsonRecord).children;
  return Array.isArray(children) ? children as JsonRecord[] : [];
}

function findVariable(variables: unknown, name: string): JsonRecord | undefined {
  if (!Array.isArray(variables)) {
    return undefined;
  }

  return (variables as JsonRecord[]).find(
    (candidate) => candidate.name === name,
  );
}

describe("Class -> Skills access foundation", () => {
  it("keeps the current Warrior class with an empty editable skills structure in GDevelop", () => {
    const project = readProject();
    const classesData = findVariable(project.variables, "classes_data");

    assert.ok(classesData);

    const classes = childrenOf(classesData);
    assert.deepStrictEqual(classes.map((entry) => entry.name), ["warrior"]);

    const warrior = classes[0];
    const skills = childrenOf(warrior).find(
      (entry) => entry.name === "skills",
    );

    assert.ok(skills);
    assert.strictEqual(skills.type, "structure");
    assert.deepStrictEqual(childrenOf(skills), []);
  });

  it("exports the current class skill relation without creating a real new skill", () => {
    const warrior = getClassDefinition("warrior");

    assert.ok(warrior);
    assert.deepStrictEqual(warrior.skillIds, []);
    assert.strictEqual(getSkillDefinition("skill_test_only"), undefined);
  });

  it("keeps universal Basic Heal available independently from the class list", () => {
    const basicHeal = getSkillDefinition("skill_heal_basic");

    assert.ok(basicHeal);
    assert.strictEqual(basicHeal.availableToAll, true);
    assert.strictEqual(basicHeal.loadoutEligible, false);
    assert.deepStrictEqual(
      resolveClassSkillAccess("warrior", basicHeal),
      {
        allowed: true,
        code: "AVAILABLE_TO_ALL",
      },
    );
  });

  it("supports future non-universal skills through Class -> SkillIDs without adding execution logic", () => {
    const futureSkill = {
      id: "skill_future_warrior",
      availableToAll: false,
    };

    assert.strictEqual(canClassUseSkill("warrior", futureSkill), false);
    assert.deepStrictEqual(
      resolveClassSkillAccess("missing_class", futureSkill),
      {
        allowed: false,
        code: "UNKNOWN_CLASS",
      },
    );
  });
});
