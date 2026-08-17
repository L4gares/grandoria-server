import assert from "node:assert/strict";

import {
  getSkillDefinition,
  getSkillEffectNumber,
  getSkillDefinitions,
} from "../src/skills/SkillCatalog.js";

describe("GDevelop skill catalog", () => {
  it("loads the universal basic heal from the exported GDevelop catalog", () => {
    const definition = getSkillDefinition("skill_heal_basic");

    assert.ok(definition);
    assert.strictEqual(definition.enabled, true);
    assert.strictEqual(definition.availableToAll, true);
    assert.strictEqual(definition.type, "healing");
    assert.strictEqual(definition.target, "self");
    assert.strictEqual(definition.cooldownMs, 30_000);
    assert.strictEqual(definition.castTimeMs, 0);
    assert.strictEqual(definition.resourceType, "none");
    assert.strictEqual(definition.resourceCost, 0);
    assert.strictEqual(definition.scaling.attribute, "none");
    assert.strictEqual(definition.scaling.perPoint, 0);
    assert.strictEqual(
      getSkillEffectNumber(definition, "heal_percent_max_hp"),
      20,
    );
  });

  it("keeps skill definitions centralized in the generated catalog", () => {
    const definitions = getSkillDefinitions();

    assert.ok(definitions.skill_heal_basic);
    assert.deepStrictEqual(
      Object.keys(definitions),
      ["skill_heal_basic"],
    );
  });
});
