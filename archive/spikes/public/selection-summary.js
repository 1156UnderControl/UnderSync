const candidateArrayKeys = new Set([
  "selection",
  "selections",
  "selectedentities",
  "entities",
  "items",
]);

function visit(value, visitor, path = [], seen = new WeakSet()) {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  visitor(value, path);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, visitor, [...path, String(index)], seen));
    return;
  }
  Object.entries(value).forEach(([key, entry]) => visit(entry, visitor, [...path, key], seen));
}

export function summarizeSelection(message) {
  const candidateArrays = [];
  const directItems = [];
  const explicitEmptyMarkers = [];
  const entityTypes = new Set();
  const identifiers = [];

  visit(message, (value, path) => {
    if (Array.isArray(value)) {
      const key = path.at(-1)?.toLowerCase() ?? "";
      if (candidateArrayKeys.has(key)) candidateArrays.push({ path: path.join("."), value });
      return;
    }

    for (const [key, entry] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (candidateArrayKeys.has(lowerKey) && entry === null) explicitEmptyMarkers.push(path.concat(key).join("."));
      if (
        typeof entry === "string" &&
        ["entitytype", "bodytype", "geometrytype", "selectiontype"].includes(lowerKey)
      ) {
        entityTypes.add(entry);
      }
      if (typeof entry === "string" && (lowerKey === "id" || lowerKey.endsWith("id"))) {
        identifiers.push({ key, value: entry, path: path.concat(key).join(".") });
      }
    }
    if (typeof value.selectionType === "string" && typeof value.selectionId === "string") {
      directItems.push(value);
    }
  });

  candidateArrays.sort((left, right) => right.value.length - left.value.length);
  const selectedArray = candidateArrays[0];
  const selectionItems = selectedArray
    ? selectedArray.value.filter((entry) => entry && typeof entry === "object")
    : directItems;
  const entityCount = selectedArray || directItems.length > 0
    ? selectionItems.length
    : explicitEmptyMarkers.length > 0
      ? 0
      : null;

  return {
    entityCount,
    countEvidencePath: selectedArray?.path ?? explicitEmptyMarkers[0] ?? null,
    entityTypes: [...entityTypes].sort(),
    identifiers,
    selectionItems,
    structureRecognized: Boolean(selectedArray || explicitEmptyMarkers.length > 0),
  };
}
