import {
  existsSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

export const CANONICAL_GDEVELOP_PROJECT_FILE =
  "RPG-2D-project-Grandoria-Colyseus-authoritative-inventory-equipment.json";

function isFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveExplicitProject(projectPath, sourceLabel) {
  const absolutePath = resolve(projectPath);

  if (basename(absolutePath) !== CANONICAL_GDEVELOP_PROJECT_FILE) {
    throw new Error(
      `${sourceLabel} must point to ${CANONICAL_GDEVELOP_PROJECT_FILE}.`,
    );
  }
  if (!isFile(absolutePath)) {
    throw new Error(
      `${sourceLabel} does not point to an existing file: ${absolutePath}`,
    );
  }

  return realpathSync(absolutePath);
}

function discoverSiblingProjects(serverRoot) {
  const absoluteServerRoot = resolve(serverRoot);
  const parentDirectory = resolve(absoluteServerRoot, "..");
  const candidates = new Set([
    join(absoluteServerRoot, CANONICAL_GDEVELOP_PROJECT_FILE),
    join(parentDirectory, CANONICAL_GDEVELOP_PROJECT_FILE),
  ]);

  for (const entry of readdirSync(parentDirectory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      candidates.add(
        join(parentDirectory, entry.name, CANONICAL_GDEVELOP_PROJECT_FILE),
      );
    }
  }

  return [...candidates]
    .filter(isFile)
    .map((candidate) => realpathSync(candidate))
    .filter((candidate, index, allCandidates) =>
      allCandidates.indexOf(candidate) === index,
    )
    .sort();
}

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   projectPath?: string,
 *   serverRoot?: string,
 * }} [options]
 */
export function resolveCanonicalGDevelopProject(
  { env = process.env, projectPath, serverRoot = process.cwd() } = {},
) {
  const explicitProject =
    projectPath ?? env.GRANDORIA_GDEVELOP_PROJECT?.trim();

  if (explicitProject) {
    return resolveExplicitProject(
      explicitProject,
      projectPath ? "projectPath" : "GRANDORIA_GDEVELOP_PROJECT",
    );
  }

  const explicitGameRoot = env.GRANDORIA_GAME_ROOT?.trim();

  if (explicitGameRoot) {
    return resolveExplicitProject(
      join(resolve(explicitGameRoot), CANONICAL_GDEVELOP_PROJECT_FILE),
      "GRANDORIA_GAME_ROOT",
    );
  }

  const discoveredProjects = discoverSiblingProjects(serverRoot);

  if (discoveredProjects.length === 1) {
    return discoveredProjects[0];
  }
  if (discoveredProjects.length > 1) {
    throw new Error(
      `Multiple canonical GDevelop projects were found:\n${discoveredProjects.join("\n")}\nSet GRANDORIA_GDEVELOP_PROJECT to select one.`,
    );
  }

  throw new Error(
    `Could not find ${CANONICAL_GDEVELOP_PROJECT_FILE} beside ${resolve(serverRoot)}. Set GRANDORIA_GDEVELOP_PROJECT to its full path.`,
  );
}
