"use strict";

const CELL_UNITS = 1024 * 1024;
const NAME_UNITS = 65536;
const RECORD_UNITS = 8 * 1024 * 1024;
const TOTAL_UNITS = 64 * 1024 * 1024;
const CLIPBOARD_UNITS = 8 * 1024 * 1024;
const COLUMNS = 10000;
const CELLS = 2000000;

function budgetError(label) {
  return Object.assign(
    new RangeError(
      `${label} exceeds Table Editor's complete-data budget. No partial result was applied. Keep the source in the text editor or shorten the input.`,
    ),
    { code: "ERR_TABLE_TEXT_LIMIT" },
  );
}
function checkLength(length, maximum, label) {
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum)
    throw budgetError(label);
}
function checkRecord(record, totals = { cells: 0, units: 0 }) {
  checkLength(record.length, COLUMNS, "Record column count");
  totals.cells += record.length;
  checkLength(totals.cells, CELLS, "Table cell count");
  for (const value of record) {
    const length = valueLength(value);
    checkLength(length, CELL_UNITS, "Cell text (1 Mi UTF-16)");
    totals.units += length;
    checkLength(totals.units, TOTAL_UNITS, "Table text (64 Mi UTF-16)");
  }
  return totals;
}

function valueLength(value) {
  if (value == null) return 0;
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value).length;
  if (value instanceof Date) return 32;
  throw new TypeError(
    "Delimited cells must contain text, numbers, booleans, dates or empty values.",
  );
}

module.exports = {
  CELL_UNITS,
  NAME_UNITS,
  RECORD_UNITS,
  TOTAL_UNITS,
  CLIPBOARD_UNITS,
  COLUMNS,
  CELLS,
  checkLength,
  checkRecord,
  budgetError,
  valueLength,
};
