import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type JsonRecord = Record<string, unknown>;

function readProject(): JsonRecord {
  const projectPath = process.env.GRANDORIA_GDEVELOP_PROJECT;

  assert.ok(
    projectPath,
    "GRANDORIA_GDEVELOP_PROJECT must select the current GDevelop project.",
  );

  return JSON.parse(readFileSync(projectPath, "utf8")) as JsonRecord;
}

function readChildren(value: unknown): JsonRecord[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const children = (value as JsonRecord).children;

  return Array.isArray(children)
    ? children as JsonRecord[]
    : [];
}

function findVariable(
  variables: unknown,
  name: string,
): JsonRecord | undefined {
  if (!Array.isArray(variables)) {
    return undefined;
  }

  return (variables as JsonRecord[]).find(
    (candidate) => candidate.name === name,
  );
}

function findNamedEvent(
  events: unknown,
  name: string,
): JsonRecord | null {
  if (!Array.isArray(events)) {
    return null;
  }

  for (const event of events as JsonRecord[]) {
    if (event.name === name) {
      return event;
    }

    const nested = findNamedEvent(event.events, name);

    if (nested) {
      return nested;
    }
  }

  return null;
}

describe("GDevelop class-driven character creation", () => {
  it("uses canonical class IDs in the character creation model", () => {
    const project = readProject();
    const layouts = project.layouts as JsonRecord[];
    const scene = layouts.find(
      (layout) => layout.name === "Scene_Characters",
    );

    assert.ok(scene);

    const selectedClass = findVariable(
      scene.variables,
      "SelectedClass",
    );
    const newCharacterData = findVariable(
      scene.variables,
      "NewCharacterData",
    );

    assert.ok(selectedClass);
    assert.ok(newCharacterData);
    assert.strictEqual(selectedClass.value, "warrior");

    const newCharacterChildren = readChildren(newCharacterData);
    const childNames = newCharacterChildren.map(
      (child) => child.name,
    );

    assert.ok(childNames.includes("ClassId"));
    assert.ok(!childNames.includes("Class"));
  });

  it("drives the class selector and attribute preview from global classes_data", () => {
    const project = readProject();
    const layouts = project.layouts as JsonRecord[];
    const scene = layouts.find(
      (layout) => layout.name === "Scene_Characters",
    );

    assert.ok(scene);

    const classChange = findNamedEvent(
      scene.events,
      "Class change",
    );

    const classPreview = findNamedEvent(
      scene.events,
      "Class attributes preview",
    );

    assert.ok(classChange);
    assert.ok(classPreview);

    const serializedSelector = JSON.stringify(classChange);
    const serializedPreview = JSON.stringify(classPreview);

    assert.match(serializedSelector, /classes_data/);
    assert.match(serializedSelector, /getAllChildren/);
    assert.match(serializedSelector, /base_attributes/);
    assert.match(serializedSelector, /PreviewClassAttributes/);

    assert.doesNotMatch(
      serializedSelector,
      /SelectedClass","=","\\"Mage\\"/,
    );
    assert.doesNotMatch(
      serializedSelector,
      /SelectedClass","=","\\"Archer\\"/,
    );
    assert.doesNotMatch(
      serializedPreview,
      /PreviewClassAttributes\.AttackPower","=","[0-9]+"/,
    );
  });

  it("saves ClassId instead of the legacy display-name Class field", () => {
    const project = readProject();
    const layouts = project.layouts as JsonRecord[];
    const scene = layouts.find(
      (layout) => layout.name === "Scene_Characters",
    );

    assert.ok(scene);

    const creation = findNamedEvent(
      scene.events,
      "button for character creation",
    );

    assert.ok(creation);

    const serialized = JSON.stringify(creation);

    assert.match(serialized, /NewCharacterData\.ClassId/);
    assert.doesNotMatch(serialized, /NewCharacterData\.Class"/);
    assert.match(serialized, /SelectedClass/);
  });

  it("keeps UI metadata editable in classes_data without changing the server class schema", () => {
    const project = readProject();

    const classesData = findVariable(
      project.variables,
      "classes_data",
    );

    assert.ok(classesData);

    const warrior = readChildren(classesData).find(
      (candidate) => candidate.name === "warrior",
    );

    assert.ok(warrior);

    const fields = Object.fromEntries(
      readChildren(warrior).map(
        (child) => [child.name, child],
      ),
    ) as Record<string, JsonRecord>;

    assert.strictEqual(fields.display_name?.value, "Warrior");
    assert.strictEqual(fields.ui_name?.value, "GUERREIRO");
    assert.ok(
      typeof fields.description?.value === "string" &&
        String(fields.description.value).length > 0,
    );
    assert.ok(fields.base_attributes);
  });
});
