import assert from "node:assert/strict";
import test from "node:test";
import { summarizeSelection } from "../public/selection-summary.js";

test("summarizes a selection array without assuming permanent identity", () => {
  const summary = summarizeSelection({
    messageName: "SELECTION",
    selections: [
      { selectionType: "BODY", bodyType: "SOLID", selectionId: "JHD" },
      { selectionType: "ENTITY", entityType: "FACE", selectionId: "JHO" },
    ],
  });

  assert.equal(summary.entityCount, 2);
  assert.deepEqual(summary.entityTypes, ["BODY", "ENTITY", "FACE", "SOLID"]);
  assert.deepEqual(
    summary.identifiers.map((identifier) => identifier.value),
    ["JHD", "JHO"],
  );
  assert.equal(summary.selectionItems.length, 2);
});

test("recognizes the observed Onshape single BODY payload shape", () => {
  const summary = summarizeSelection({
    messageName: "SELECTION",
    documentId: "adc5d879e22ce46bcfa595d0",
    selections: {
      selectionType: "BODY",
      selectionId: "RoMD",
      workspaceMicroversionId: "ca497703a732ba476f374ed9",
    },
  });
  assert.equal(summary.entityCount, 1);
  assert.equal(summary.selectionItems[0].selectionId, "RoMD");
});

test("recognizes an explicit empty selection array", () => {
  const summary = summarizeSelection({ messageName: "SELECTION", selections: [] });
  assert.equal(summary.entityCount, 0);
  assert.equal(summary.structureRecognized, true);
});

test("marks an undocumented structure unknown while preserving raw data elsewhere", () => {
  const summary = summarizeSelection({ messageName: "SELECTION", undocumented: { value: true } });
  assert.equal(summary.entityCount, null);
  assert.equal(summary.structureRecognized, false);
});
