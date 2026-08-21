import assert from "node:assert/strict";

import {
  buildSkillSlotCatalog,
} from "../scripts/export-gdevelop-world.mjs";

describe("GDevelop Skill Slots foundation", () => {
  const projectPath = process.env.GRANDORIA_GDEVELOP_PROJECT;

  it("exports the 10 prepared slots from GDevelop", () => {
    assert.ok(
      projectPath,
      "GRANDORIA_GDEVELOP_PROJECT must point to the current GDevelop project.",
    );

    const catalog = buildSkillSlotCatalog({ projectPath });
    const slots = catalog.slots as Record<
      string,
      {
        enabled: boolean;
        inputAction: string;
        order: number;
        slotId: string;
      }
    >;

    assert.deepStrictEqual(
      Object.keys(slots).sort((left, right) => {
        const leftOrder = slots[left].order;
        const rightOrder = slots[right].order;
        return leftOrder - rightOrder;
      }),
      Array.from({ length: 10 }, (_, index) => `slot_${index + 1}`),
    );
  });

  it("keeps slot identity independent from physical keys", () => {
    assert.ok(projectPath);

    const catalog = buildSkillSlotCatalog({ projectPath });
    const slots = catalog.slots as Record<
      string,
      {
        enabled: boolean;
        inputAction: string;
        order: number;
        slotId: string;
      }
    >;

    assert.strictEqual(slots.slot_1.inputAction, "Skill1");
    assert.strictEqual(slots.slot_2.inputAction, "Skill2");
    assert.strictEqual(slots.slot_3.inputAction, "Skill3");

    for (let index = 4; index <= 10; index += 1) {
      assert.strictEqual(slots[`slot_${index}`].inputAction, "");
    }

    const serialized = JSON.stringify(catalog);

    assert.doesNotMatch(serialized, /"q"/i);
    assert.doesNotMatch(serialized, /"e"/i);
    assert.doesNotMatch(serialized, /"r"/i);
  });

  it("does not equip or implement any skill in this stage", () => {
    assert.ok(projectPath);

    const catalog = buildSkillSlotCatalog({ projectPath });

    for (const slot of Object.values(
      catalog.slots as Record<string, Record<string, unknown>>,
    )) {
      assert.deepStrictEqual(
        Object.keys(slot).sort(),
        ["enabled", "inputAction", "order", "slotId"].sort(),
      );

      assert.ok(!("skillId" in slot));
      assert.ok(!("skillID" in slot));
    }
  });

  it("keeps the slot catalog data-driven instead of requiring Slot1-Slot10 server logic", () => {
    assert.ok(projectPath);

    const catalog = buildSkillSlotCatalog({ projectPath });
    const orders = Object.values(
      catalog.slots as Record<string, { order: number }>,
    )
      .map((slot) => slot.order)
      .sort((left, right) => left - right);

    assert.deepStrictEqual(
      orders,
      Array.from({ length: 10 }, (_, index) => index + 1),
    );
  });
});
