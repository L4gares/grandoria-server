import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";
import {
  resolve,
} from "node:path";

import {
  PlayerState,
} from "../src/rooms/schema/MyRoomState.js";

import {
  createEmptySkillLoadout,
  EMPTY_SKILL_SLOT,
  normalizeSkillLoadout,
} from "../src/skills/SkillLoadout.js";

import {
  getSkillSlotDefinitions,
} from "../src/skills/SkillSlotCatalog.js";

describe("Authoritative character SkillLoadout foundation", () => {
  it("creates the current 10 character slots empty from the generated catalog", () => {
    const definitions = getSkillSlotDefinitions();
    const loadout = createEmptySkillLoadout();

    assert.equal(definitions.length, 10);
    assert.deepEqual(
      Object.keys(loadout),
      definitions.map((definition) => definition.slotId),
    );

    for (const skillID of Object.values(loadout)) {
      assert.equal(skillID, EMPTY_SKILL_SLOT);
    }
  });

  it("normalizes missing or stale persistence without hardcoding slot_1...slot_10", () => {
    const emptyLoadout = createEmptySkillLoadout();

    const missing = normalizeSkillLoadout(undefined);

    assert.equal(missing.needsPersistence, true);
    assert.deepEqual(missing.loadout, emptyLoadout);

    const canonical = normalizeSkillLoadout(emptyLoadout);

    assert.equal(canonical.needsPersistence, false);
    assert.deepEqual(canonical.loadout, emptyLoadout);

    const stale = normalizeSkillLoadout({
      ...emptyLoadout,
      removed_slot: "skill_old",
    });

    assert.equal(stale.needsPersistence, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        stale.loadout,
        "removed_slot",
      ),
      false,
    );
  });

  it("mirrors the loadout dynamically in Colyseus PlayerState", () => {
    const player = new PlayerState();
    const emptyLoadout = createEmptySkillLoadout();

    for (const [slotId, skillID] of Object.entries(
      emptyLoadout,
    )) {
      player.skillLoadout.set(slotId, skillID);
    }

    assert.equal(
      player.skillLoadout.size,
      getSkillSlotDefinitions().length,
    );

    for (const definition of getSkillSlotDefinitions()) {
      assert.equal(
        player.skillLoadout.get(definition.slotId),
        EMPTY_SKILL_SLOT,
      );
    }
  });

  it("loads, synchronizes and saves SkillLoadout without adding slot execution", () => {
    const roomSource = readFileSync(
      resolve(
        process.cwd(),
        "src",
        "rooms",
        "MyRoom.ts",
      ),
      "utf8",
    );

    assert.match(
      roomSource,
      /characterData\.SkillLoadout\s*\?\?\s*characterData\.skillLoadout/,
    );
    assert.match(
      roomSource,
      /Character SkillLoadout synchronized from skill-slot catalog/,
    );
    assert.match(
      roomSource,
      /SkillLoadout:\s*this\.readPlayerSkillLoadout\(player\)/,
    );

    assert.doesNotMatch(
      roomSource,
      /use_skill_slot/,
    );
    assert.doesNotMatch(
      roomSource,
      /equip_skill/,
    );
    assert.doesNotMatch(
      roomSource,
      /SkillLoadout\.[A-Za-z0-9_]+\s*=/,
    );
  });
});
