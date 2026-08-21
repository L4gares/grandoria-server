import {
  getSkillSlotDefinition,
  getSkillSlotDefinitions,
} from "./SkillSlotCatalog.js";

export const EMPTY_SKILL_SLOT = "empty";

export type SkillLoadoutData = Record<string, string>;

export type NormalizedSkillLoadout = Readonly<{
  loadout: SkillLoadoutData;
  needsPersistence: boolean;
}>;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function normalizeSkillID(
  value: unknown,
): string {
  if (typeof value !== "string") {
    return EMPTY_SKILL_SLOT;
  }

  const skillID = value.trim();

  if (
    !skillID ||
    skillID.toLowerCase() === EMPTY_SKILL_SLOT
  ) {
    return EMPTY_SKILL_SLOT;
  }

  if (
    skillID.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(skillID)
  ) {
    return EMPTY_SKILL_SLOT;
  }

  return skillID;
}

/*
 * The global slot structure comes from skill-slots.json, while the values
 * belong to each character. This function intentionally does not decide
 * whether a SkillID can be executed; it only keeps the persistent loadout
 * structurally aligned with the configured slot catalog.
 */
export function normalizeSkillLoadout(
  value: unknown,
): NormalizedSkillLoadout {
  const source = isRecord(value) ? value : {};
  const definitions = getSkillSlotDefinitions();
  const expectedSlotIds = new Set(
    definitions.map((definition) => definition.slotId),
  );
  const loadout: SkillLoadoutData = {};

  let needsPersistence = !isRecord(value);

  for (const definition of definitions) {
    const rawValue = source[definition.slotId];
    const normalizedValue = normalizeSkillID(rawValue);

    loadout[definition.slotId] = normalizedValue;

    if (rawValue !== normalizedValue) {
      needsPersistence = true;
    }
  }

  for (const persistedSlotId of Object.keys(source)) {
    if (!expectedSlotIds.has(persistedSlotId)) {
      needsPersistence = true;
      break;
    }
  }

  if (
    Object.keys(source).length !==
    definitions.length
  ) {
    needsPersistence = true;
  }

  return {
    loadout,
    needsPersistence,
  };
}

export function createEmptySkillLoadout():
  SkillLoadoutData {
  return Object.fromEntries(
    getSkillSlotDefinitions().map(
      (definition) => [
        definition.slotId,
        EMPTY_SKILL_SLOT,
      ],
    ),
  );
}

export type SkillLoadoutAssignableSkill = Readonly<{
  enabled: boolean;
  loadoutEligible: boolean;
}>;

export type SkillLoadoutAssignmentPlan =
  | Readonly<{
      ok: true;
      changed: boolean;
      code: "LOADOUT_UPDATED" | "NO_CHANGE";
      loadout: SkillLoadoutData;
      skillID: string;
      slotId: string;
    }>
  | Readonly<{
      ok: false;
      code:
        | "UNKNOWN_SLOT"
        | "SLOT_DISABLED"
        | "UNKNOWN_SKILL"
        | "SKILL_UNAVAILABLE"
        | "SKILL_NOT_LOADOUT_ELIGIBLE"
        | "SKILL_ALREADY_EQUIPPED"
        | "INVALID_SKILL_ID";
      loadout: SkillLoadoutData;
      skillID: string;
      slotId: string;
    }>;

/*
 * Plans one authoritative loadout mutation without touching persistence.
 * Skill existence/class availability are resolved by the caller so this
 * module stays reusable when Class -> Skills rules are added later.
 */
export function planSkillLoadoutAssignment(
  value: unknown,
  slotId: string,
  skillID: string,
  skill: SkillLoadoutAssignableSkill | undefined,
): SkillLoadoutAssignmentPlan {
  const normalized = normalizeSkillLoadout(value).loadout;
  const slot = getSkillSlotDefinition(slotId);
  const rawSkillID =
    typeof skillID === "string" ? skillID.trim() : "";

  if (
    !rawSkillID ||
    rawSkillID.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(rawSkillID)
  ) {
    return {
      ok: false,
      code: "INVALID_SKILL_ID",
      loadout: normalized,
      skillID: rawSkillID,
      slotId,
    };
  }

  const requestedSkillID =
    rawSkillID.toLowerCase() === EMPTY_SKILL_SLOT
      ? EMPTY_SKILL_SLOT
      : rawSkillID;

  if (!slot) {
    return {
      ok: false,
      code: "UNKNOWN_SLOT",
      loadout: normalized,
      skillID: requestedSkillID,
      slotId,
    };
  }

  if (!slot.enabled) {
    return {
      ok: false,
      code: "SLOT_DISABLED",
      loadout: normalized,
      skillID: requestedSkillID,
      slotId,
    };
  }

  const currentSkillID = normalized[slotId] ?? EMPTY_SKILL_SLOT;

  if (requestedSkillID === EMPTY_SKILL_SLOT) {
    if (currentSkillID === EMPTY_SKILL_SLOT) {
      return {
        ok: true,
        changed: false,
        code: "NO_CHANGE",
        loadout: normalized,
        skillID: EMPTY_SKILL_SLOT,
        slotId,
      };
    }

    return {
      ok: true,
      changed: true,
      code: "LOADOUT_UPDATED",
      loadout: {
        ...normalized,
        [slotId]: EMPTY_SKILL_SLOT,
      },
      skillID: EMPTY_SKILL_SLOT,
      slotId,
    };
  }

  if (!skill) {
    return {
      ok: false,
      code: "UNKNOWN_SKILL",
      loadout: normalized,
      skillID: requestedSkillID,
      slotId,
    };
  }

  if (!skill.enabled) {
    return {
      ok: false,
      code: "SKILL_UNAVAILABLE",
      loadout: normalized,
      skillID: requestedSkillID,
      slotId,
    };
  }

  if (!skill.loadoutEligible) {
    return {
      ok: false,
      code: "SKILL_NOT_LOADOUT_ELIGIBLE",
      loadout: normalized,
      skillID: requestedSkillID,
      slotId,
    };
  }

  if (currentSkillID === requestedSkillID) {
    return {
      ok: true,
      changed: false,
      code: "NO_CHANGE",
      loadout: normalized,
      skillID: requestedSkillID,
      slotId,
    };
  }

  const duplicateSlotId = Object.entries(normalized).find(
    ([otherSlotId, equippedSkillID]) =>
      otherSlotId !== slotId &&
      equippedSkillID === requestedSkillID,
  )?.[0];

  if (duplicateSlotId) {
    return {
      ok: false,
      code: "SKILL_ALREADY_EQUIPPED",
      loadout: normalized,
      skillID: requestedSkillID,
      slotId,
    };
  }

  return {
    ok: true,
    changed: true,
    code: "LOADOUT_UPDATED",
    loadout: {
      ...normalized,
      [slotId]: requestedSkillID,
    },
    skillID: requestedSkillID,
    slotId,
  };
}

