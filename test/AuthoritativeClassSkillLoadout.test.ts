import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  resolveClassSkillAccess,
} from "../src/skills/ClassSkillAccess.js";

import {
  getClassDefinition,
} from "../src/classes/ClassCatalog.js";

import {
  getSkillDefinition,
} from "../src/skills/SkillCatalog.js";

describe("Authoritative Class -> SkillLoadout validation", () => {
  it("keeps Basic Heal universal but outside the configurable loadout", () => {
    const basicHeal = getSkillDefinition("skill_heal_basic");

    assert.ok(basicHeal);
    assert.equal(basicHeal.availableToAll, true);
    assert.equal(basicHeal.loadoutEligible, false);
    assert.deepEqual(
      resolveClassSkillAccess("warrior", basicHeal),
      {
        allowed: true,
        code: "AVAILABLE_TO_ALL",
      },
    );
  });

  it("keeps future non-universal skills blocked until the class explicitly lists them", () => {
    const warrior = getClassDefinition("warrior");

    assert.ok(warrior);
    assert.deepEqual(warrior.skillIds, []);

    const futureSkill = {
      id: "skill_future_warrior",
      availableToAll: false,
    };

    assert.deepEqual(
      resolveClassSkillAccess("warrior", futureSkill),
      {
        allowed: false,
        code: "CLASS_SKILL_NOT_ALLOWED",
      },
    );
  });

  it("connects Class -> Skills authorization to the authoritative loadout assignment before persistence", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src", "rooms", "MyRoom.ts"),
      "utf8",
    );

    const planIndex = source.indexOf("planSkillLoadoutAssignment(");
    const classAccessIndex = source.indexOf("resolveClassSkillAccess(");
    const persistenceIndex = source.indexOf(
      "await this.persistPlayerSkillLoadout(client, player)",
    );

    assert.ok(planIndex >= 0, "loadout planning must exist");
    assert.ok(classAccessIndex > planIndex, "class access must be checked after structural loadout validation");
    assert.ok(persistenceIndex > classAccessIndex, "class access must be checked before Firestore persistence");

    assert.match(source, /SKILL_NOT_AVAILABLE_TO_CLASS/);
    assert.match(source, /classSkillAccessCode/);
    assert.match(source, /player\.classId/);
  });

  it("adds class authorization only, without slot execution or skill unlock mutation", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src", "rooms", "MyRoom.ts"),
      "utf8",
    );

    assert.match(source, /set_skill_loadout_slot/);
    assert.match(source, /resolveClassSkillAccess/);
    assert.doesNotMatch(source, /use_skill_slot/);
    assert.doesNotMatch(source, /unlock_skill/);
    assert.doesNotMatch(source, /learn_skill/);
  });
});
