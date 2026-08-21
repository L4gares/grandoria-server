import {
  getClassDefinition,
} from "../classes/ClassCatalog.js";

import type {
  SkillDefinition,
} from "./SkillCatalog.js";

export type ClassSkillAccessDecision = Readonly<{
  allowed: boolean;
  code:
    | "AVAILABLE_TO_ALL"
    | "CLASS_SKILL_ALLOWED"
    | "CLASS_SKILL_NOT_ALLOWED"
    | "UNKNOWN_CLASS";
}>;

/*
 * Pure eligibility rule for Class -> Skills.
 *
 * This module does not equip a skill, execute it, check cooldowns, or mutate
 * the character loadout. It only answers whether a known skill belongs to a
 * character class. Universal skills bypass the per-class list by design.
 */
export function resolveClassSkillAccess(
  classId: string,
  skill: Pick<SkillDefinition, "id" | "availableToAll">,
): ClassSkillAccessDecision {
  if (skill.availableToAll) {
    return {
      allowed: true,
      code: "AVAILABLE_TO_ALL",
    };
  }

  const classDefinition = getClassDefinition(classId);

  if (!classDefinition) {
    return {
      allowed: false,
      code: "UNKNOWN_CLASS",
    };
  }

  if (classDefinition.skillIds.includes(skill.id)) {
    return {
      allowed: true,
      code: "CLASS_SKILL_ALLOWED",
    };
  }

  return {
    allowed: false,
    code: "CLASS_SKILL_NOT_ALLOWED",
  };
}

export function canClassUseSkill(
  classId: string,
  skill: Pick<SkillDefinition, "id" | "availableToAll">,
): boolean {
  return resolveClassSkillAccess(classId, skill).allowed;
}
