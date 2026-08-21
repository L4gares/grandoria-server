import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function findNamedEvent(
  events: unknown[],
  name: string,
): Record<string, unknown> | null {
  for (const candidate of events) {
    const event = candidate as Record<string, unknown>;

    if (event.name === name) {
      return event;
    }

    const nested = Array.isArray(event.events)
      ? event.events
      : [];

    const found = findNamedEvent(nested, name);

    if (found) {
      return found;
    }
  }

  return null;
}

function visitObjects(
  value: unknown,
  callback: (value: Record<string, unknown>) => void,
) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) =>
      visitObjects(entry, callback),
    );
    return;
  }

  const object =
    value as Record<string, unknown>;

  callback(object);

  Object.values(object).forEach((entry) =>
    visitObjects(entry, callback),
  );
}

function readStructure(
  variable: Record<string, unknown>,
) {
  const children = Array.isArray(variable.children)
    ? variable.children as Record<string, unknown>[]
    : [];

  return Object.fromEntries(
    children.map((child) => [
      child.name,
      child,
    ]),
  );
}

describe("configurable GDevelop controls", () => {
  it("centralizes the current Grandoria action bindings in ControlBindings", () => {
    const projectPath =
      process.env.GRANDORIA_GDEVELOP_PROJECT;

    assert.ok(
      projectPath,
      "GRANDORIA_GDEVELOP_PROJECT must select the current GDevelop project.",
    );

    const project = JSON.parse(
      readFileSync(projectPath, "utf8"),
    );

    const controlBindings =
      project.variables.find(
        (candidate: Record<string, unknown>) =>
          candidate.name === "ControlBindings",
      );

    assert.ok(controlBindings);
    assert.strictEqual(
      controlBindings.type,
      "structure",
    );

    const actions =
      readStructure(controlBindings);

    const expected = {
      MoveUp: ["keyboard", "w"],
      MoveDown: ["keyboard", "s"],
      MoveLeft: ["keyboard", "a"],
      MoveRight: ["keyboard", "d"],
      BasicAttack: ["mouse", "Right"],
      Heal: ["keyboard", "f"],
      Skill1: ["keyboard", "q"],
      Skill2: ["keyboard", "e"],
      Skill3: ["keyboard", "r"],
      Interact: ["keyboard", "Space"],
    } as const;

    assert.deepStrictEqual(
      Object.keys(actions).sort(),
      Object.keys(expected).sort(),
    );

    for (
      const [actionName, [device, input]]
      of Object.entries(expected)
    ) {
      const action =
        actions[actionName];

      assert.ok(action);

      const values =
        readStructure(action);

      assert.strictEqual(
        values.Device?.value,
        device,
      );

      assert.strictEqual(
        values.Input?.value,
        input,
      );
    }

    assert.strictEqual(
      actions.Dodge,
      undefined,
    );
  });

  it("uses action bindings instead of hardcoded gameplay keys in existing movement, attack, heal and interact events", () => {
    const projectPath =
      process.env.GRANDORIA_GDEVELOP_PROJECT;

    assert.ok(projectPath);

    const project = JSON.parse(
      readFileSync(projectPath, "utf8"),
    );

    const character =
      project.externalEvents.find(
        (candidate: Record<string, unknown>) =>
          candidate.name === "character",
      );

    const colyseus =
      project.externalEvents.find(
        (candidate: Record<string, unknown>) =>
          candidate.name === "colyseus",
      );

    const interfaces =
      project.externalEvents.find(
        (candidate: Record<string, unknown>) =>
          candidate.name === "interfaces",
      );

    assert.ok(character);
    assert.ok(colyseus);
    assert.ok(interfaces);

    const movement =
      findNamedEvent(
        character.events,
        "LOCAL CHARACTER — MOVEMENT AND INPUT",
      );

    const attack =
      findNamedEvent(
        character.events,
        "LOCAL CHARACTER — ATTACK ANIMATION AND HITBOX",
      );

    const heal =
      findNamedEvent(
        character.events,
        "HUD — HEALTH POTION",
      );

    const sharedItems =
      findNamedEvent(
        colyseus.events,
        "COLYSEUS — SHARED ITEMS",
      );

    const market =
      findNamedEvent(
        interfaces.events,
        "MARKET — OPEN AND CLOSE WINDOW",
      );

    assert.ok(movement);
    assert.ok(attack);
    assert.ok(heal);
    assert.ok(sharedItems);
    assert.ok(market);

    const serializedMovement =
      JSON.stringify(movement);

    const serializedAttack =
      JSON.stringify(attack);

    const serializedHeal =
      JSON.stringify(heal);

    const serializedSharedItems =
      JSON.stringify(sharedItems);

    const serializedMarket =
      JSON.stringify(market);

    assert.match(
      serializedMovement,
      /ControlBindings\.MoveUp\.Input/,
    );
    assert.match(
      serializedMovement,
      /ControlBindings\.MoveDown\.Input/,
    );
    assert.match(
      serializedMovement,
      /ControlBindings\.MoveLeft\.Input/,
    );
    assert.match(
      serializedMovement,
      /ControlBindings\.MoveRight\.Input/,
    );

    assert.match(
      serializedAttack,
      /ControlBindings\.BasicAttack\.Input/,
    );

    assert.match(
      serializedHeal,
      /ControlBindings\.Heal\.Input/,
    );

    assert.match(
      serializedSharedItems,
      /ControlBindings\.Interact\.Input/,
    );

    assert.match(
      serializedMarket,
      /ControlBindings\.Interact\.Input/,
    );

    assert.doesNotMatch(
      serializedMovement,
      /"w"|"a"|"s"|"d"/,
    );

    assert.doesNotMatch(
      serializedAttack,
      /"Right"/,
    );

    assert.doesNotMatch(
      serializedHeal,
      /"f"/,
    );

    assert.doesNotMatch(
      serializedSharedItems,
      /"Space"/,
    );

    assert.doesNotMatch(
      serializedMarket,
      /"e"/,
    );
  });

  it("makes SendPlayerInput read movement actions from ControlBindings instead of accepting physical keys", () => {
    const projectPath =
      process.env.GRANDORIA_GDEVELOP_PROJECT;

    assert.ok(projectPath);

    const project = JSON.parse(
      readFileSync(projectPath, "utf8"),
    );

    const extension =
      project.eventsFunctionsExtensions.find(
        (candidate: Record<string, unknown>) =>
          candidate.name === "GrandoriaColyseus",
      );

    assert.ok(extension);

    const sendPlayerInput =
      extension.eventsFunctions.find(
        (candidate: Record<string, unknown>) =>
          candidate.name === "SendPlayerInput",
      );

    assert.ok(sendPlayerInput);

    assert.deepStrictEqual(
      sendPlayerInput.parameters,
      [],
    );

    const code =
      sendPlayerInput.events[0]
        .inlineCode.join("\n");

    assert.match(
      code,
      /ControlBindings/,
    );

    assert.match(
      code,
      /readKeyboardBinding\("MoveLeft"\)/,
    );
    assert.match(
      code,
      /readKeyboardBinding\("MoveRight"\)/,
    );
    assert.match(
      code,
      /readKeyboardBinding\("MoveUp"\)/,
    );
    assert.match(
      code,
      /readKeyboardBinding\("MoveDown"\)/,
    );

    assert.doesNotMatch(
      code,
      /LeftKey|RightKey|UpKey|DownKey/,
    );

    const calls: Record<string, unknown>[] = [];

    visitObjects(project, (entry) => {
      const type =
        (entry.type as Record<string, unknown> | undefined)
          ?.value;

      if (
        type ===
        "GrandoriaColyseus::SendPlayerInput"
      ) {
        calls.push(entry);
      }
    });

    assert.ok(calls.length > 0);

    for (const call of calls) {
      assert.deepStrictEqual(
        call.parameters,
        ["", ""],
      );
    }

    assert.doesNotThrow(
      () =>
        new Function(
          "runtimeScene",
          "eventsFunctionContext",
          "gdjs",
          code,
        ),
    );
  });
});
