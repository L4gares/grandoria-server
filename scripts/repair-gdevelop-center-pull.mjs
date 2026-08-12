import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, parse, resolve } from "node:path";

const projectFlagIndex = process.argv.indexOf("--project");
const projectArgument =
  projectFlagIndex >= 0 ? process.argv[projectFlagIndex + 1] : "";

if (!projectArgument) {
  throw new Error("Use --project com o caminho do projeto GDevelop.");
}

const projectPath = resolve(projectArgument);

if (!existsSync(projectPath)) {
  throw new Error(`Projeto nao encontrado: ${projectPath}`);
}

if (extname(projectPath).toLowerCase() !== ".json") {
  throw new Error("O projeto GDevelop precisa ser um arquivo .json.");
}

const source = readFileSync(projectPath, "utf8");
const project = JSON.parse(source);
const extension = project.eventsFunctionsExtensions?.find(
  (item) => item?.name === "GrandoriaColyseus",
);

if (!extension) {
  throw new Error("Extensao GrandoriaColyseus nao encontrada.");
}

const sendInputFunction = extension.eventsFunctions?.find(
  (item) => item?.name === "SendPlayerInput",
);
const sendInputCodeEvent = sendInputFunction?.events?.find(
  (event) => event?.type === "BuiltinCommonInstructions::JsCode",
);

if (!sendInputCodeEvent || !Array.isArray(sendInputCodeEvent.inlineCode)) {
  throw new Error("Codigo de SendPlayerInput nao encontrado.");
}

const sendInputLines = sendInputCodeEvent.inlineCode;
let changed = false;

if (!sendInputLines.includes("const movementEnabled =")) {
  const inputStart = sendInputLines.indexOf("const input = {");
  const intervalStart = sendInputLines.indexOf(
    "const INPUT_SEND_INTERVAL_MS = 50;",
    inputStart,
  );

  if (inputStart < 0 || intervalStart < 0 || intervalStart <= inputStart) {
    throw new Error("Bloco de entrada original nao foi reconhecido.");
  }

  const replacement = [
    "const movementEnabled =",
    "  runtimeScene",
    "    .getVariables()",
    "    .get(\"can_move\")",
    "    .getAsBoolean();",
    "",
    "const input = {",
    "  left:",
    "    movementEnabled &&",
    "    gdjs.evtTools.input.isKeyPressed(",
    "      runtimeScene,",
    "      leftKey",
    "    ),",
    "",
    "  right:",
    "    movementEnabled &&",
    "    gdjs.evtTools.input.isKeyPressed(",
    "      runtimeScene,",
    "      rightKey",
    "    ),",
    "",
    "  up:",
    "    movementEnabled &&",
    "    gdjs.evtTools.input.isKeyPressed(",
    "      runtimeScene,",
    "      upKey",
    "    ),",
    "",
    "  down:",
    "    movementEnabled &&",
    "    gdjs.evtTools.input.isKeyPressed(",
    "      runtimeScene,",
    "      downKey",
    "    ),",
    "};",
    "",
  ];

  sendInputLines.splice(
    inputStart,
    intervalStart - inputStart,
    ...replacement,
  );
  changed = true;
}

const characterEvents = project.externalEvents?.find(
  (item) => item?.name === "character",
);

if (!characterEvents) {
  throw new Error("Eventos externos de character nao encontrados.");
}

const movementCandidates = [];

const findMovementEvent = (events) => {
  for (const event of events || []) {
    const actions = Array.isArray(event?.actions) ? event.actions : [];
    const moveXAction = actions.find(
      (action) =>
        action?.type?.value === "MettreX" &&
        action?.parameters?.[0] === "character" &&
        String(action?.parameters?.[2] || "").includes("character.moveX"),
    );
    const moveYAction = actions.find(
      (action) =>
        action?.type?.value === "MettreY" &&
        action?.parameters?.[0] === "character" &&
        String(action?.parameters?.[2] || "").includes("character.moveY"),
    );

    if (moveXAction && moveYAction) {
      movementCandidates.push({ moveXAction, moveYAction });
    }

    findMovementEvent(event?.events);
  }
};

findMovementEvent(characterEvents.events);

if (movementCandidates.length !== 1) {
  throw new Error(
    `Evento de movimento local ambiguo: ${movementCandidates.length} encontrado(s).`,
  );
}

const { moveXAction, moveYAction } = movementCandidates[0];
const restoredMoveX = "character.moveX * character.speed * TimeDelta()";
const restoredMoveY = "character.moveY * character.speed * TimeDelta()";

if (moveXAction.parameters[2] !== restoredMoveX) {
  moveXAction.parameters[2] = restoredMoveX;
  changed = true;
}

if (moveYAction.parameters[2] !== restoredMoveY) {
  moveYAction.parameters[2] = restoredMoveY;
  changed = true;
}

if (!changed) {
  console.log("Projeto GDevelop ja estava sem o puxao ao centro.");
  process.exit(0);
}

const projectName = parse(projectPath);
const backupPath = join(
  dirname(projectPath),
  `${projectName.name}.before-center-pull-fix${projectName.ext}`,
);

if (!existsSync(backupPath)) {
  copyFileSync(projectPath, backupPath);
}

const eol = source.includes("\r\n") ? "\r\n" : "\n";
const output = `${JSON.stringify(project, null, 2)}\n`.replace(/\n/g, eol);
const temporaryPath = `${projectPath}.center-pull-fix-${process.pid}.tmp`;

try {
  writeFileSync(temporaryPath, output, "utf8");
  JSON.parse(readFileSync(temporaryPath, "utf8"));
  renameSync(temporaryPath, projectPath);
} catch (error) {
  if (existsSync(temporaryPath)) {
    unlinkSync(temporaryPath);
  }

  throw error;
}

console.log(`Puxao ao centro corrigido: ${projectPath}`);
console.log(`Backup: ${backupPath}`);
