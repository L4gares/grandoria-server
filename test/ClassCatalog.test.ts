import assert from "node:assert/strict";

import {
  getClassDefinition,
  getClassDefinitions,
  hasClassDefinition,
  parseClassCatalog,
} from "../src/classes/ClassCatalog.js";

describe("ClassCatalog", () => {
  it("loads Warrior base attributes and the data-driven class skill list", () => {
    const warrior = getClassDefinition("warrior");

    assert.ok(warrior);
    assert.strictEqual(warrior.classId, "warrior");
    assert.strictEqual(warrior.displayName, "Warrior");

    assert.deepStrictEqual(warrior.baseAttributes, {
      AttackPower: 6,
      MagicPower: 0,
      HealingPower: 0,
      Agility: 2,
      Vitality: 6,
      Regeneration: 3,
      Armor: 5,
      CriticalChance: 2,
    });

    assert.deepStrictEqual(warrior.skillIds, []);
    assert.strictEqual(hasClassDefinition("warrior"), true);
    assert.strictEqual(hasClassDefinition("missing_class"), false);
  });

  it("keeps class definitions generic so future classes and skill relations are data-only", () => {
    const parsed = parseClassCatalog({
      schemaVersion: 2,
      classes: {
        class_test_one: {
          classId: "class_test_one",
          displayName: "Class Test One",
          baseAttributes: {
            AttackPower: 1,
            MagicPower: 2,
            HealingPower: 3,
            Agility: 4,
            Vitality: 5,
            Regeneration: 6,
            Armor: 7,
            CriticalChance: 8,
          },
          skillIds: ["skill_future_one"],
        },
        class_test_two: {
          classId: "class_test_two",
          displayName: "Class Test Two",
          baseAttributes: {
            AttackPower: 8,
            MagicPower: 7,
            HealingPower: 6,
            Agility: 5,
            Vitality: 4,
            Regeneration: 3,
            Armor: 2,
            CriticalChance: 1,
          },
          skillIds: ["skill_future_two", "skill_future_three"],
        },
      },
    });

    assert.strictEqual(parsed.size, 2);
    assert.deepStrictEqual(
      parsed.get("class_test_two")?.skillIds,
      ["skill_future_three", "skill_future_two"],
    );
  });

  it("rejects invalid class definitions instead of silently accepting broken base attributes", () => {
    assert.throws(
      () =>
        parseClassCatalog({
          schemaVersion: 2,
          classes: {
            invalid_class: {
              classId: "invalid_class",
              displayName: "Invalid Class",
              baseAttributes: {
                AttackPower: -1,
                MagicPower: 0,
                HealingPower: 0,
                Agility: 0,
                Vitality: 0,
                Regeneration: 0,
                Armor: 0,
                CriticalChance: 0,
              },
              skillIds: [],
            },
          },
        }),
      /non-negative integer/i,
    );
  });

  it("rejects malformed or duplicated class SkillIDs", () => {
    const makeCatalog = (skillIds: unknown) => ({
      schemaVersion: 2,
      classes: {
        warrior: {
          classId: "warrior",
          displayName: "Warrior",
          baseAttributes: {
            AttackPower: 6,
            MagicPower: 0,
            HealingPower: 0,
            Agility: 2,
            Vitality: 6,
            Regeneration: 3,
            Armor: 5,
            CriticalChance: 2,
          },
          skillIds,
        },
      },
    });

    assert.throws(
      () => parseClassCatalog(makeCatalog(["bad skill id"])),
      /invalid SkillID/i,
    );
    assert.throws(
      () => parseClassCatalog(makeCatalog(["skill_one", "skill_one"])),
      /duplicate SkillID/i,
    );
  });

  it("keeps the class catalog declarative: attributes plus allowed SkillIDs only", () => {
    const definitions = getClassDefinitions();

    assert.ok(definitions.length > 0);

    for (const definition of definitions) {
      const keys = Object.keys(
        definition as unknown as Record<string, unknown>,
      );

      assert.deepStrictEqual(
        keys.sort(),
        ["baseAttributes", "classId", "displayName", "skillIds"].sort(),
      );
    }
  });
});
