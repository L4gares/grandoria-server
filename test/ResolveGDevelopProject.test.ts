import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CANONICAL_GDEVELOP_PROJECT_FILE,
  resolveCanonicalGDevelopProject,
} from "../scripts/resolve-gdevelop-project.mjs";

describe("canonical GDevelop project path resolution", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "grandoria-paths-"));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  });

  function createProject(directoryName: string) {
    const gameRoot = join(temporaryDirectory, directoryName);
    const projectPath = join(gameRoot, CANONICAL_GDEVELOP_PROJECT_FILE);

    mkdirSync(gameRoot, { recursive: true });
    writeFileSync(projectPath, "{}", "utf8");

    return projectPath;
  }

  it("discovers a canonical project without depending on the game folder name", () => {
    const serverRoot = join(temporaryDirectory, "renamed-server");
    const projectPath = createProject("renamed-game");

    mkdirSync(serverRoot);

    assert.strictEqual(
      resolveCanonicalGDevelopProject({ env: {}, serverRoot }),
      projectPath,
    );
  });

  it("requires an explicit project when sibling discovery is ambiguous", () => {
    const serverRoot = join(temporaryDirectory, "server");

    mkdirSync(serverRoot);
    createProject("game-one");
    createProject("game-two");

    assert.throws(
      () => resolveCanonicalGDevelopProject({ env: {}, serverRoot }),
      /Multiple canonical GDevelop projects were found/,
    );
  });

  it("accepts an explicit canonical project path", () => {
    const serverRoot = join(temporaryDirectory, "server");
    const selectedProject = createProject("selected-game");

    mkdirSync(serverRoot);
    createProject("other-game");

    assert.strictEqual(
      resolveCanonicalGDevelopProject({
        env: {},
        projectPath: selectedProject,
        serverRoot,
      }),
      selectedProject,
    );
  });
});
