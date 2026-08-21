import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Authoritative Classes", () => {
  const myRoomSource = readFileSync(
    resolve(process.cwd(), "src", "rooms", "MyRoom.ts"),
    "utf8",
  );

  const stateSource = readFileSync(
    resolve(
      process.cwd(),
      "src",
      "rooms",
      "schema",
      "MyRoomState.ts",
    ),
    "utf8",
  );

  describe("7.2B.2 - ClassId foundation", () => {
    it("stores ClassId in the authoritative Colyseus PlayerState", () => {
      assert.match(
        stateSource,
        /@type\("string"\)\s+classId:\s*string\s*=\s*"";/,
      );

      assert.match(
        myRoomSource,
        /player\.classId\s*=\s*authenticatedPlayer\.classId;/,
      );
    });

    it("loads and validates persisted ClassId through ClassCatalog", () => {
      assert.match(
        myRoomSource,
        /getClassDefinition\(persistedClassId\)/,
      );

      assert.match(
        myRoomSource,
        /characterData\.ClassId/,
      );

      assert.match(
        myRoomSource,
        /classId:\s*authenticatedClassId/,
      );
    });

    it("migrates legacy characters only when the class catalog is unambiguous", () => {
      assert.match(
        myRoomSource,
        /getClassDefinitions\(\)/,
      );

      assert.match(
        myRoomSource,
        /definitions\.length\s*!==\s*1/,
      );

      assert.match(
        myRoomSource,
        /characterSnapshot\.ref\.update\(\{\s*ClassId:\s*authenticatedClassId,/,
      );
    });

    it("persists the authoritative ClassId with the character lifecycle", () => {
      assert.match(
        myRoomSource,
        /ClassId:\s*player\.classId/,
      );

      assert.match(
        myRoomSource,
        /`Class:\s*\$\{player\.classId\s*\|\|\s*"not provided"\}\.`/,
      );
    });
  });

  describe("7.2B.3 - Class-authoritative Base attributes", () => {
    it("takes Attributes.Base from the resolved class definition instead of Firestore", () => {
      assert.match(
        myRoomSource,
        /const classDefinition = getClassDefinition\(authenticatedClassId\);/,
      );

      assert.match(
        myRoomSource,
        /const baseAttributes = readPlayerAttributeValues\(\s*classDefinition\.baseAttributes,\s*\);/,
      );

      assert.doesNotMatch(
        myRoomSource,
        /const baseAttributes = readPlayerAttributeValues\(\s*attributesData\.Base/,
      );
    });

    it("keeps allocated points character-specific and loaded from persistence", () => {
      assert.match(
        myRoomSource,
        /const allocatedAttributes = readPlayerAttributeValues\(\s*attributesData\.Allocated\s*\?\?\s*attributesData\.allocated,\s*\);/,
      );

      assert.match(
        myRoomSource,
        /"Attributes\.Allocated":\s*this\.readPlayerAllocatedAttributes\(player\)/,
      );
    });

    it("preserves Base + Allocated = Final using the class base", () => {
      assert.match(
        myRoomSource,
        /authenticatedAttributes = \{\s*Base:\s*baseAttributes,\s*Allocated:\s*allocatedAttributes,\s*Final:\s*addPlayerAttributeValues\(baseAttributes,\s*allocatedAttributes\),\s*\};/,
      );

      assert.match(
        myRoomSource,
        /applyPlayerAttributeValues\(\s*player\.attributes\.Base,\s*authenticatedPlayer\.attributes\.Base,\s*\);/,
      );
    });

    it("synchronizes Firestore's Base copy when GDevelop class configuration changes without hardcoding a class", () => {
      assert.match(
        myRoomSource,
        /playerAttributeValuesEqual\(\s*persistedBaseAttributes,\s*baseAttributes,\s*\)/,
      );

      assert.match(
        myRoomSource,
        /"Attributes\.Base":\s*baseAttributes/,
      );

      assert.doesNotMatch(
        myRoomSource,
        /classId\s*===\s*["']warrior["']/i,
      );

      assert.doesNotMatch(
        myRoomSource,
        /if\s*\(\s*authenticatedClassId\s*===\s*["']warrior["']/i,
      );
    });
  });
});
