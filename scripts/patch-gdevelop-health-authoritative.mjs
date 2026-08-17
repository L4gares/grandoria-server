import fs from "node:fs";
import path from "node:path";

const projectArgIndex = process.argv.indexOf("--project");
const projectPath = projectArgIndex >= 0 ? process.argv[projectArgIndex + 1] : "";

if (!projectPath) {
  console.error('Usage: node patch-gdevelop-health-authoritative.mjs --project "C:\\path\\to\\project.json"');
  process.exit(1);
}

const absoluteProjectPath = path.resolve(projectPath);
const project = JSON.parse(fs.readFileSync(absoluteProjectPath, "utf8"));

function findFunction(extensionName, functionName) {
  const extension = (project.eventsFunctionsExtensions || []).find(
    (candidate) => candidate.name === extensionName,
  );

  return extension?.eventsFunctions?.find(
    (candidate) => candidate.name === functionName,
  );
}

function removeMessageListener(code, messageName) {
  const messageIndex = code.findIndex(
    (line) => line.trim() === `"${messageName}",`,
  );

  if (messageIndex < 0) {
    return false;
  }

  let start = messageIndex;
  while (start >= 0 && code[start].trim() !== "room.onMessage(") {
    start -= 1;
  }

  if (start < 0) {
    throw new Error(`Could not locate the start of ${messageName} listener.`);
  }

  let next = messageIndex + 1;
  while (next < code.length) {
    if (code[next].trim() === "room.onMessage(") {
      break;
    }
    next += 1;
  }

  if (next >= code.length) {
    throw new Error(`Could not locate the end of ${messageName} listener.`);
  }

  code.splice(start, next - start);
  return true;
}

const saveCharacterFunction = findFunction("Backend", "SaveCharacter");

if (!saveCharacterFunction?.events?.[0]?.inlineCode) {
  throw new Error("Backend::SaveCharacter inline code was not found.");
}

saveCharacterFunction.events[0].inlineCode = [
  "const saveResult =",
  "  runtimeScene",
  "    .getVariables()",
  '    .get("CharacterProgressSaveResult");',
  "",
  "/*",
  " * Character progression, attributes, Resources, inventory,",
  " * equipment and currencies are authoritative on Colyseus.",
  " * This function remains only as a compatibility no-op for",
  " * older event calls that still expect an immediate save result.",
  " */",
  'saveResult.setString("ok");',
];

saveCharacterFunction.description =
  "Compatibility no-op. Character progression and Resources are persisted by the authoritative Colyseus server.";

const connectFunction = findFunction("GrandoriaColyseus", "ConnectToServer");

if (!connectFunction?.events?.[0]?.inlineCode) {
  throw new Error("GrandoriaColyseus::ConnectToServer inline code was not found.");
}

removeMessageListener(
  connectFunction.events[0].inlineCode,
  "set_max_health_result",
);

const syncFunction = findFunction(
  "GrandoriaColyseus",
  "SyncLocalEquipmentState",
);

if (!syncFunction?.events?.[0]?.inlineCode) {
  throw new Error("GrandoriaColyseus::SyncLocalEquipmentState inline code was not found.");
}

const syncCode = syncFunction.events[0].inlineCode;

for (let index = syncCode.length - 1; index >= 0; index -= 1) {
  const trimmed = syncCode[index].trim();

  if (
    trimmed === "network.lastRequestedMaxHealth = null;" ||
    trimmed === "network.maxHealthRequestSequence = 0;"
  ) {
    syncCode.splice(index, 1);
  }
}

const savedMaxHealthIndex = syncCode.findIndex(
  (line) => line.trim() === "const savedMaxHealth = Math.max(",
);

if (savedMaxHealthIndex >= 0) {
  let blockStart = savedMaxHealthIndex;

  for (
    let index = savedMaxHealthIndex - 1;
    index >= Math.max(0, savedMaxHealthIndex - 12);
    index -= 1
  ) {
    if (syncCode[index].trim() === "const activeCharacterData =") {
      blockStart = index;
      break;
    }
  }

  const lastRequestedIndex = syncCode.findIndex(
    (line, index) =>
      index > savedMaxHealthIndex &&
      line.trim() === "network.lastRequestedMaxHealth = savedMaxHealth;",
  );

  if (lastRequestedIndex < 0) {
    throw new Error("Could not isolate the client max-health request block.");
  }

  let blockEnd = lastRequestedIndex + 1;
  while (
    blockEnd < syncCode.length &&
    syncCode[blockEnd].trim() !== "}"
  ) {
    blockEnd += 1;
  }

  if (blockEnd >= syncCode.length) {
    throw new Error("Could not locate the end of the client max-health request block.");
  }

  syncCode.splice(blockStart, blockEnd - blockStart + 1);
}

const applyLocalPlayerStateFunction = findFunction(
  "GrandoriaColyseus",
  "ApplyLocalPlayerState",
);

if (!applyLocalPlayerStateFunction?.events?.[1]?.inlineCode) {
  throw new Error("GrandoriaColyseus::ApplyLocalPlayerState inline code was not found.");
}

const applyCode = applyLocalPlayerStateFunction.events[1].inlineCode;
const serverIsAliveIndex = applyCode.findIndex(
  (line) => line.trim() === "const serverIsAlive =",
);

if (serverIsAliveIndex < 0) {
  throw new Error("ApplyLocalPlayerState server health block was not found.");
}

const alreadyMirrorsResources = applyCode.some(
  (line) => line.includes("ActiveCharacterData") && line.includes("authoritative health"),
);

if (!alreadyMirrorsResources) {
  let insertionIndex = serverIsAliveIndex;
  while (
    insertionIndex < applyCode.length &&
    applyCode[insertionIndex].trim() !== ");"
  ) {
    insertionIndex += 1;
  }

  insertionIndex += 1;

  applyCode.splice(
    insertionIndex,
    0,
    "",
    "/* Mirror authoritative health into ActiveCharacterData. */",
    "const authoritativeHealthData =",
    "  runtimeScene",
    "    .getVariables()",
    '    .get("ActiveCharacterData")',
    '    .getChild("Resources");',
    "",
    "if (Number.isFinite(serverCurrentHealth)) {",
    "  authoritativeHealthData",
    '    .getChild("CurrentHP")',
    "    .setNumber(serverCurrentHealth);",
    "}",
    "",
    "if (Number.isFinite(serverMaxHealth)) {",
    "  authoritativeHealthData",
    '    .getChild("MaxHP")',
    "    .setNumber(serverMaxHealth);",
    "}",
  );
}

function replaceLegacyMaxHealthCalculations(value) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      replaceLegacyMaxHealthCalculations(entry);
    }
    return;
  }

  const actionType = value.type?.value;
  const parameters = value.parameters;

  if (
    actionType === "SetNumberObjectVariable" &&
    Array.isArray(parameters) &&
    parameters[0] === "character" &&
    parameters[1] === "max_HP" &&
    typeof parameters[3] === "string" &&
    parameters[3].includes("FinalAttributes.Vitality")
  ) {
    parameters[3] = "ActiveCharacterData.Resources.MaxHP";
  }

  for (const child of Object.values(value)) {
    replaceLegacyMaxHealthCalculations(child);
  }
}

replaceLegacyMaxHealthCalculations(project.externalEvents || []);

const serialized = JSON.stringify(project, null, 2);

if (serialized.includes('room.send(\\"set_max_health\\"')) {
  throw new Error("A set_max_health client send still exists after patching.");
}

fs.writeFileSync(
  absoluteProjectPath,
  `${serialized}\n`,
  "utf8",
);

console.log("[Grandoria] GDevelop authoritative health patch applied:");
console.log(absoluteProjectPath);
