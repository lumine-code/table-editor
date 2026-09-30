"use strict";

// Runtime arrays keep row insertion/deletion semantics. Persist only explicit
// overrides so an untouched large table does not write one null per row.
function indexedEntries(values) {
  return Object.entries(values || {}).filter(([index]) => {
    const number = Number(index);
    return (
      Number.isInteger(number) &&
      number >= 0 &&
      number < 0xffffffff &&
      String(number) === index
    );
  });
}

function compactRowHeights(rowHeights) {
  const result = {};
  if (Array.isArray(rowHeights)) {
    // Old JSON state has dense null arrays. Avoid allocating a million entry
    // tuples while removing those default slots during migration.
    for (let index = 0; index < rowHeights.length; index++) {
      if (rowHeights[index] != null) result[index] = rowHeights[index];
    }
  } else {
    for (const [index, height] of indexedEntries(rowHeights)) {
      if (height != null) result[index] = height;
    }
  }
  return result;
}

function expandRowHeights(rowHeights, rowCount) {
  const heights = new Array(rowCount);
  for (const [index, height] of indexedEntries(rowHeights)) {
    if (Number(index) < rowCount && height != null) heights[index] = height;
  }
  return heights;
}

function compactLayout(layout) {
  const columns = {};
  for (const [index, column] of indexedEntries(layout?.columns)) {
    if (!column) continue;
    const overrides = {};
    if (column.width != null) overrides.width = column.width;
    if (column.align != null && column.align !== "left")
      overrides.align = column.align;
    if (Object.keys(overrides).length) columns[index] = overrides;
  }
  const rowHeights = compactRowHeights(layout?.rowHeights);
  return {
    ...(Object.keys(columns).length ? { columns } : {}),
    ...(Object.keys(rowHeights).length ? { rowHeights } : {}),
  };
}

module.exports = { compactLayout, compactRowHeights, expandRowHeights };
