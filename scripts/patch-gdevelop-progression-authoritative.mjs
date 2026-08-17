import fs from "node:fs";
import path from "node:path";

const projectArgIndex = process.argv.indexOf("--project");
const projectPath = projectArgIndex >= 0 ? process.argv[projectArgIndex + 1] : "";

if (!projectPath) {
  console.error('Usage: node patch-gdevelop-progression-authoritative.mjs --project "C:\\path\\to\\project.json"');
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

const backendExtension = (project.eventsFunctionsExtensions || []).find(
  (candidate) => candidate.name === "Backend",
);
const saveCharacterFunction = backendExtension?.eventsFunctions?.find(
  (candidate) => candidate.name === "SaveCharacter",
);

if (!saveCharacterFunction?.events?.[0]?.inlineCode) {
  throw new Error("Backend::SaveCharacter inline code was not found.");
}

const saveCode = saveCharacterFunction.events[0].inlineCode;
const fieldsStart = saveCode.findIndex((line) => line.trim() === "const persistentFields = [");
const fieldsEnd = fieldsStart >= 0
  ? saveCode.findIndex((line, index) => index > fieldsStart && line.trim() === "];" )
  : -1;

if (fieldsStart < 0 || fieldsEnd < 0) {
  throw new Error("Backend::SaveCharacter persistentFields block was not found.");
}

saveCode.splice(
  fieldsStart,
  fieldsEnd - fieldsStart + 1,
  "const persistentFields = [",
  '  "Resources",',
  "];",
);

saveCharacterFunction.description =
  "Saves the remaining client-owned character Resources to Firestore. Progression, attributes, inventory, equipment, Gold, and Gem are persisted by the authoritative server.";

const colyseusExtension = (project.eventsFunctionsExtensions || []).find(
  (candidate) => candidate.name === "GrandoriaColyseus",
);
const connectFunction = colyseusExtension?.eventsFunctions?.find(
  (candidate) => candidate.name === "ConnectToServer",
);

if (!connectFunction?.events?.[0]?.inlineCode) {
  throw new Error("GrandoriaColyseus::ConnectToServer inline code was not found.");
}

const connectCode = connectFunction.events[0].inlineCode;
const xpMessageIndex = connectCode.findIndex(
  (line) => line.trim() === '"xp_awarded",',
);

if (xpMessageIndex < 0) {
  const alreadyPatched = connectCode.some(
    (line) => line.trim() === '"progression_updated",',
  );
  if (!alreadyPatched) {
    throw new Error("xp_awarded listener was not found.");
  }
} else {
  let listenerStart = xpMessageIndex;
  while (
    listenerStart >= 0 &&
    connectCode[listenerStart].trim() !== "room.onMessage("
  ) {
    listenerStart -= 1;
  }

  const nextMessageIndex = connectCode.findIndex(
    (line, index) =>
      index > xpMessageIndex &&
      line.trim() === '"set_max_health_result",',
  );

  let listenerEnd = nextMessageIndex;
  while (
    listenerEnd >= 0 &&
    connectCode[listenerEnd].trim() !== "room.onMessage("
  ) {
    listenerEnd -= 1;
  }

  if (listenerStart < 0 || listenerEnd <= listenerStart) {
    throw new Error("Could not isolate the xp_awarded listener block.");
  }

  const progressionListener = [
    "      room.onMessage(",
    '        "progression_updated",',
    "        (result) => {",
    "          if (network.room !== room || !result) {",
    "            return;",
    "          }",
    "",
    "          const sceneVariables = runtimeScene.getVariables();",
    "",
    "          if (!result.ok) {",
    "            sceneVariables",
    '              .get("CharacterProgressLastError")',
    '              .setString(String(result.code || "PROGRESSION_UPDATE_FAILED"));',
    "",
    '            console.warn("[Grandoria] Progression update rejected:", result);',
    "            return;",
    "          }",
    "",
    '          const activeCharacterData = sceneVariables.get("ActiveCharacterData");',
    "          const experience = Math.max(0, Math.trunc(Number(result.experience) || 0));",
    "          const level = Math.max(1, Math.trunc(Number(result.level) || 1));",
    "          const experienceToNextLevel = Math.max(0, Math.trunc(Number(result.experienceToNextLevel) || 0));",
    "          const unspentAttributePoints = Math.max(0, Math.trunc(Number(result.unspentAttributePoints) || 0));",
    "",
    '          activeCharacterData.getChild("Experience").setNumber(experience);',
    '          activeCharacterData.getChild("Level").setNumber(level);',
    '          activeCharacterData.getChild("UnspentAttributePoints").setNumber(unspentAttributePoints);',
    "",
    '          const characterObjects = runtimeScene.getObjects("character");',
    "          if (characterObjects.length > 0) {",
    "            const characterVariables = characterObjects[0].getVariables();",
    '            characterVariables.get("XP").setNumber(experience);',
    '            characterVariables.get("level").setNumber(level);',
    '            characterVariables.get("XP_NextLevel").setNumber(experienceToNextLevel);',
    "          }",
    "",
    '          sceneVariables.get("CharacterProgressLastError").setString("");',
    "",
    '          console.log("[Grandoria] Authoritative progression synchronized:", {',
    "            amount: result.amount,",
    "            experience,",
    "            experienceToNextLevel,",
    "            level,",
    "            levelsGained: result.levelsGained,",
    "            monsterId: result.monsterId,",
    "            monsterType: result.monsterType,",
    "            unspentAttributePoints,",
    "          });",
    "        }",
    "      );",
    "",
  ];

  connectCode.splice(
    listenerStart,
    listenerEnd - listenerStart,
    ...progressionListener,
  );
}

const characterExternalEvents = (project.externalEvents || []).find(
  (candidate) => candidate.name === "character",
);

if (!characterExternalEvents) {
  throw new Error("character external events were not found.");
}

const levelUpGroup =
  findNamedEvent(
    characterExternalEvents.events,
    "LOCAL CHARACTER — LEVEL UP",
  ) ??
  findNamedEvent(
    characterExternalEvents.events,
    "CHARACTER — AUTHORITATIVE LEVEL PROGRESS",
  );

if (!levelUpGroup) {
  throw new Error("Character level progression group was not found.");
}

levelUpGroup.name = "CHARACTER — AUTHORITATIVE LEVEL PROGRESS";
levelUpGroup.events = [
  {
    type: "BuiltinCommonInstructions::Comment",
    color: {
      b: 109,
      g: 230,
      r: 255,
      textB: 0,
      textG: 0,
      textR: 0,
    },
    comment:
      "XP, Level and attribute-point rewards are calculated and persisted by Colyseus. This group only mirrors the authoritative values in the HUD.",
  },
  {
    type: "BuiltinCommonInstructions::Standard",
    conditions: [],
    actions: [
      {
        type: { value: "PanelSpriteContinuousBar::PanelSpriteContinuousBar::SetValue" },
        parameters: ["XP_HUD", "=", "character.XP", ""],
      },
      {
        type: { value: "PanelSpriteContinuousBar::PanelSpriteContinuousBar::SetMaxValue" },
        parameters: ["XP_HUD", "=", "max(1, character.XP_NextLevel)", ""],
      },
      {
        type: { value: "ChangeSprite" },
        parameters: ["levels_numbers", "=", "max(0, character.level - 1)"],
      },
    ],
  },
];

fs.writeFileSync(
  absoluteProjectPath,
  `${JSON.stringify(project, null, 2)}\n`,
  "utf8",
);

console.log("[Grandoria] GDevelop authoritative progression patch applied:");
console.log(absoluteProjectPath);
