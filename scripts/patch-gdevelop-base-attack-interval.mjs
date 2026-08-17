import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--project") {
      args.project = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function visit(value, callback) {
  if (!value || typeof value !== "object") return;
  callback(value);
  if (Array.isArray(value)) {
    for (const entry of value) visit(entry, callback);
    return;
  }
  for (const entry of Object.values(value)) visit(entry, callback);
}

const { project } = parseArgs(process.argv.slice(2));
if (!project) {
  throw new Error("Usage: node scripts/patch-gdevelop-base-attack-interval.mjs --project <project.json>");
}

const projectPath = path.resolve(project);
const source = fs.readFileSync(projectPath, "utf8");
const data = JSON.parse(source);

let sendMonsterAttackFunction = null;
visit(data, (candidate) => {
  if (
    !sendMonsterAttackFunction &&
    candidate &&
    candidate.name === "SendMonsterAttack" &&
    Array.isArray(candidate.events)
  ) {
    sendMonsterAttackFunction = candidate;
  }
});

if (!sendMonsterAttackFunction) {
  throw new Error("SendMonsterAttack function was not found in the GDevelop project.");
}

const jsEvent = sendMonsterAttackFunction.events.find(
  (event) => event?.type === "BuiltinCommonInstructions::JsCode" && Array.isArray(event.inlineCode),
);

if (!jsEvent) {
  throw new Error("SendMonsterAttack JavaScript event was not found.");
}

let code = jsEvent.inlineCode.join("\n");
const marker = "[Grandoria] BASE_ATTACK_INTERVAL_AUTHORITATIVE";

if (code.includes(marker)) {
  console.log("[Grandoria] Base attack interval patch is already applied.");
  process.exit(0);
}

const playerAnchor = `const player =\n  network.localPlayer;\n`;
if (!code.includes(playerAnchor)) {
  throw new Error("Could not find the local player anchor inside SendMonsterAttack.");
}

const cooldownBlock = `${playerAnchor}\n/* ${marker} */\nconst cancelLocalAttack = () => {\n  for (const characterObject of runtimeScene.getObjects("character")) {\n    characterObject\n      .getVariables()\n      .get("attack")\n      .setBoolean(false);\n  }\n};\n\nconst attackIntervalMs = Number(player.attackIntervalMs);\n\nif (!Number.isFinite(attackIntervalMs) || attackIntervalMs <= 0) {\n  cancelLocalAttack();\n  console.warn(\n    "[Grandoria] Attack not sent: authoritative attack interval is unavailable."\n  );\n  return;\n}\n\nconst attackSessionId = String(network.room.sessionId || "");\nconst attackNow =\n  globalThis.performance &&\n  typeof globalThis.performance.now === "function"\n    ? globalThis.performance.now()\n    : Date.now();\n\nconst sameAttackSession =\n  network.lastAttackSessionId === attackSessionId;\nconst lastAttackSentAt = sameAttackSession\n  ? Number(network.lastAttackSentAt)\n  : Number.NaN;\n\nif (\n  Number.isFinite(lastAttackSentAt) &&\n  attackNow - lastAttackSentAt < attackIntervalMs\n) {\n  cancelLocalAttack();\n  return;\n}\n`;

code = code.replace(playerAnchor, cooldownBlock);

const sendAnchor = `  network.room.send(\n    "attack",\n    attackMessage\n  );\n`;
if (!code.includes(sendAnchor)) {
  throw new Error("Could not find the attack send call inside SendMonsterAttack.");
}

code = code.replace(
  sendAnchor,
  `${sendAnchor}\n  network.lastAttackSessionId = attackSessionId;\n  network.lastAttackSentAt = attackNow;\n`,
);

jsEvent.inlineCode = code.split("\n");

fs.writeFileSync(projectPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log("[Grandoria] Authoritative 1500 ms base attack interval client gate applied.");
