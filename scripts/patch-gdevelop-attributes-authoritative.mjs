import fs from "node:fs";
import path from "node:path";

const projectArgIndex = process.argv.indexOf("--project");
const projectPath = projectArgIndex >= 0 ? process.argv[projectArgIndex + 1] : "";

if (!projectPath) {
  console.error('Usage: node patch-gdevelop-attributes-authoritative.mjs --project "C:\\path\\to\\project.json"');
  process.exit(1);
}

const absoluteProjectPath = path.resolve(projectPath);
const project = JSON.parse(fs.readFileSync(absoluteProjectPath, "utf8"));

function findNamedEvent(events, name) {
  for (const event of events || []) {
    if (event?.name === name) return event;
    const nested = findNamedEvent(event?.events, name);
    if (nested) return nested;
  }
  return null;
}

function findConfirmEvent(events) {
  for (const event of events || []) {
    const hasConfirmCondition = (event.conditions || []).some((condition) =>
      Array.isArray(condition?.parameters) &&
      condition.parameters.includes("Btn_ConfirmAttributes")
    );
    if (hasConfirmCondition) return event;
    const nested = findConfirmEvent(event?.events);
    if (nested) return nested;
  }
  return null;
}

function setNumberAction(target, operator, expression) {
  return {
    type: { value: "SetNumberVariable" },
    parameters: [target, operator, expression],
  };
}

function setStringAction(target, value) {
  return {
    type: { value: "SetStringVariable" },
    parameters: [target, "=", JSON.stringify(value)],
  };
}

const extension = (project.eventsFunctionsExtensions || []).find(
  (candidate) => candidate.name === "GrandoriaColyseus",
);

if (!extension) {
  throw new Error("GrandoriaColyseus extension was not found.");
}

const connectFunction = extension.eventsFunctions.find(
  (candidate) => candidate.name === "ConnectToServer",
);

if (!connectFunction?.events?.[0]?.inlineCode) {
  throw new Error("ConnectToServer inline code was not found.");
}

if (!extension.eventsFunctions.some((candidate) => candidate.name === "AllocateAttributes")) {
  extension.eventsFunctions.push({
    description: "Requests an authoritative allocation of pending character attribute points.",
    fullName: "Allocate character attributes",
    functionType: "Action",
    group: "Character",
    name: "AllocateAttributes",
    sentence: "Allocate pending character attributes on the authoritative server",
    events: [
      {
        type: "BuiltinCommonInstructions::JsCode",
        inlineCode: [
          "const network = gdjs._grandoriaColyseus;",
          "const sceneVariables = runtimeScene.getVariables();",
          "",
          "const readPoint = (name) => {",
          "  const value = Number(eventsFunctionContext.getArgument(name));",
          "  return Number.isSafeInteger(value) && value >= 0 ? value : null;",
          "};",
          "",
          "const allocations = {",
          '  AttackPower: readPoint("AttackPower"),',
          '  MagicPower: readPoint("MagicPower"),',
          '  HealingPower: readPoint("HealingPower"),',
          '  Agility: readPoint("Agility"),',
          '  Vitality: readPoint("Vitality"),',
          '  Regeneration: readPoint("Regeneration"),',
          '  Armor: readPoint("Armor"),',
          '  CriticalChance: readPoint("CriticalChance"),',
          "};",
          "",
          "if (Object.values(allocations).some((value) => value === null)) {",
          '  sceneVariables.get("CharacterProgressLastError").setString("INVALID_ATTRIBUTE_ALLOCATION");',
          '  sceneVariables.get("AttributeAllocationStatus").setString("ERROR");',
          "  return;",
          "}",
          "",
          "const totalPoints = Object.values(allocations).reduce((sum, value) => sum + value, 0);",
          "",
          "if (totalPoints <= 0) {",
          '  sceneVariables.get("CharacterProgressLastError").setString("NO_ATTRIBUTE_POINTS_REQUESTED");',
          '  sceneVariables.get("AttributeAllocationStatus").setString("ERROR");',
          "  return;",
          "}",
          "",
          "if (!network || network.status !== \"connected\" || !network.room) {",
          '  sceneVariables.get("CharacterProgressLastError").setString("COLYSEUS_UNAVAILABLE");',
          '  sceneVariables.get("AttributeAllocationStatus").setString("ERROR");',
          "  return;",
          "}",
          "",
          "network.attributeAllocationRequestSequence =",
          "  (Number.isFinite(network.attributeAllocationRequestSequence)",
          "    ? network.attributeAllocationRequestSequence",
          "    : 0) + 1;",
          "",
          "const requestId = [",
          '  "attributes",',
          '  String(network.room.sessionId || "session"),',
          "  Date.now().toString(36),",
          "  network.attributeAllocationRequestSequence.toString(36),",
          '].join("_");',
          "",
          "try {",
          '  network.room.send("allocate_attributes", { requestId, allocations });',
          "  network.lastAttributeAllocationRequest = { requestId, allocations };",
          '  console.log("[Grandoria] Attribute allocation requested:", network.lastAttributeAllocationRequest);',
          "} catch (error) {",
          '  sceneVariables.get("CharacterProgressLastError").setString("ATTRIBUTE_REQUEST_SEND_FAILED");',
          '  sceneVariables.get("AttributeAllocationStatus").setString("ERROR");',
          '  console.error("[Grandoria] Error sending attribute allocation:", error);',
          "}",
        ],
        parameterObjects: "",
        useStrict: true,
        eventsSheetExpanded: true,
      },
    ],
    parameters: [
      { description: "Pending Attack Power points", name: "AttackPower", type: "expression" },
      { description: "Pending Magic Power points", name: "MagicPower", type: "expression" },
      { description: "Pending Healing Power points", name: "HealingPower", type: "expression" },
      { description: "Pending Agility points", name: "Agility", type: "expression" },
      { description: "Pending Vitality points", name: "Vitality", type: "expression" },
      { description: "Pending Regeneration points", name: "Regeneration", type: "expression" },
      { description: "Pending Armor points", name: "Armor", type: "expression" },
      { description: "Pending Critical Chance points", name: "CriticalChance", type: "expression" },
    ],
    objectGroups: [],
  });

  extension.eventsFunctionsFolderStructure.children.push({ functionName: "AllocateAttributes" });
}

const connectCode = connectFunction.events[0].inlineCode;
const alreadyHasAllocationResult = connectCode.some((line) =>
  line.includes('"allocate_attributes_result"'),
);

if (!alreadyHasAllocationResult) {
  const xpListenerIndex = connectCode.findIndex(
    (line, index) =>
      line.trim() === '"xp_awarded",' &&
      index > 0 &&
      connectCode[index - 1]?.trim() === "room.onMessage(",
  );

  if (xpListenerIndex < 1) {
    throw new Error("xp_awarded listener insertion point was not found.");
  }

  const insertAt = xpListenerIndex - 1;
  const listenerLines = [
    '      room.onMessage(',
    '        "allocate_attributes_result",',
    '        (result) => {',
    '          if (network.room !== room || !result) {',
    '            return;',
    '          }',
    '',
    '          const sceneVariables = runtimeScene.getVariables();',
    '',
    '          if (!result.ok) {',
    '            sceneVariables',
    '              .get("CharacterProgressLastError")',
    '              .setString(String(result.code || "ATTRIBUTE_ALLOCATION_FAILED"));',
    '            sceneVariables',
    '              .get("AttributeAllocationStatus")',
    '              .setString("ERROR");',
    '',
    '            console.warn("[Grandoria] Attribute allocation rejected:", result);',
    '            return;',
    '          }',
    '',
    '          const activeCharacterData = sceneVariables.get("ActiveCharacterData");',
    '          const allocatedVariable = activeCharacterData',
    '            .getChild("Attributes")',
    '            .getChild("Allocated");',
    '          const attributeNames = [',
    '            "AttackPower",',
    '            "MagicPower",',
    '            "HealingPower",',
    '            "Agility",',
    '            "Vitality",',
    '            "Regeneration",',
    '            "Armor",',
    '            "CriticalChance",',
    '          ];',
    '',
    '          for (const attributeName of attributeNames) {',
    '            const value = Number(result.allocated?.[attributeName]);',
    '            if (Number.isFinite(value)) {',
    '              allocatedVariable.getChild(attributeName).setNumber(value);',
    '            }',
    '          }',
    '',
    '          activeCharacterData',
    '            .getChild("UnspentAttributePoints")',
    '            .setNumber(Math.max(0, Math.trunc(Number(result.unspentAttributePoints) || 0)));',
    '',
    '          sceneVariables.get("FinalAttributesStatus").setString("IDLE");',
    '          sceneVariables.get("CharacterProgressLastError").setString("");',
    '          sceneVariables.get("AttributeAllocationStatus").setString("SAVED");',
    '',
    '          console.log("[Grandoria] Attribute allocation confirmed:", result);',
    '        }',
    '      );',
    '',
  ];

  connectCode.splice(insertAt, 0, ...listenerLines);
}

const characterEvents = (project.externalEvents || []).find(
  (candidate) => candidate.name === "character",
);

if (!characterEvents) {
  throw new Error("character external events were not found.");
}

const attributeDistribution = findNamedEvent(
  characterEvents.events,
  "Attribute Distribution",
);

if (!attributeDistribution) {
  throw new Error("Attribute Distribution group was not found.");
}

const confirmEvent = findConfirmEvent(attributeDistribution.events);

if (!confirmEvent) {
  throw new Error("Confirm attributes event was not found.");
}

const visualActions = confirmEvent.actions.slice(0, 3);
confirmEvent.actions = [
  ...visualActions,
  setStringAction("AttributeAllocationStatus", "SAVING"),
  {
    type: { value: "GrandoriaColyseus::AllocateAttributes" },
    parameters: [
      "",
      "PendingAttributePoints.AttackPower",
      "PendingAttributePoints.MagicPower",
      "PendingAttributePoints.HealingPower",
      "PendingAttributePoints.Agility",
      "PendingAttributePoints.Vitality",
      "PendingAttributePoints.Regeneration",
      "PendingAttributePoints.Armor",
      "PendingAttributePoints.CriticalChance",
      "",
    ],
  },
];

const savingEvent = attributeDistribution.events.find(
  (event) =>
    Array.isArray(event.conditions) &&
    event.conditions.some(
      (condition) =>
        condition?.type?.value === "StringVariable" &&
        condition?.parameters?.[0] === "AttributeAllocationStatus" &&
        (condition?.parameters?.[2] === '"SAVING"' ||
          condition?.parameters?.[2] === '"SAVED"'),
    ) &&
    (event.conditions.some(
      (condition) => condition?.parameters?.[0] === "CharacterProgressSaveStatus",
    ) ||
      event.conditions.length === 1),
);

if (!savingEvent) {
  throw new Error("Attribute allocation success event was not found.");
}

savingEvent.conditions = [
  {
    type: { value: "StringVariable" },
    parameters: ["AttributeAllocationStatus", "=", '"SAVED"'],
  },
];

savingEvent.actions = savingEvent.actions.filter((action) =>
  !(action?.type?.value === "SetStringVariable" &&
    action?.parameters?.[0] === "CharacterProgressSaveStatus"),
);

const oldErrorEvent = attributeDistribution.events.find(
  (event) =>
    Array.isArray(event.conditions) &&
    (event.conditions.some(
      (condition) => condition?.parameters?.[0] === "CharacterProgressSaveResult",
    ) ||
      event.conditions.some(
        (condition) =>
          condition?.parameters?.[0] === "AttributeAllocationStatus" &&
          condition?.parameters?.[2] === '"ERROR"',
      )) &&
    Array.isArray(event.actions) &&
    (event.actions.some(
      (action) =>
        action?.parameters?.[0] === "ActiveCharacterData.Attributes.Allocated.AttackPower" &&
        action?.parameters?.[1] === "-",
    ) ||
      event.actions.some(
        (action) =>
          action?.parameters?.[0] === "AttributeAllocationStatus" &&
          action?.parameters?.[2] === '"EDITING"',
      )),
);

if (!oldErrorEvent) {
  throw new Error("Attribute allocation error event was not found.");
}

oldErrorEvent.conditions = [
  {
    type: { value: "StringVariable" },
    parameters: ["AttributeAllocationStatus", "=", '"ERROR"'],
  },
];
oldErrorEvent.actions = [
  setStringAction("AttributeAllocationStatus", "EDITING"),
];

fs.writeFileSync(
  absoluteProjectPath,
  `${JSON.stringify(project, null, 2)}\n`,
  "utf8",
);

console.log("[Grandoria] GDevelop authoritative attribute allocation patch applied:");
console.log(absoluteProjectPath);
