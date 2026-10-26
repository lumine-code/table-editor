"use strict";
const { Transform } = require("node:stream");
const { RECORD_UNITS, COLUMNS, CELLS, checkLength } = require("./text-budget");

// csv-parse's max_record_size does not count empty fields or delimiters. This
// bounded lexical pass runs before each chunk reaches its record array.
function createValidator(
  { delimiter, recordDelimiter, quote, escape, commentPrefix = "" },
  limits = {},
) {
  const maxUnits = limits.units ?? RECORD_UNITS,
    maxColumns = limits.columns ?? COLUMNS,
    maxCells = limits.cells ?? CELLS;
  const recordDelimiters = Array.isArray(recordDelimiter)
    ? recordDelimiter
    : [recordDelimiter];
  checkLength(recordDelimiters.length, 16, "Record delimiter count");
  for (const token of [
    delimiter,
    ...recordDelimiters,
    quote,
    escape,
    commentPrefix,
  ]) {
    if (typeof token !== "string")
      throw new TypeError("Delimited tokens must be strings");
    checkLength(token.length, 64, "Delimited format token (64 UTF-16)");
  }
  const carryLength =
    2 *
    Math.max(
      1,
      delimiter.length,
      ...recordDelimiters.map((token) => token.length),
      quote.length,
      escape.length,
      commentPrefix.length,
    );
  let carry = "",
    cells = 0,
    units = 0,
    columns = 1,
    quoted = false,
    commenting = false;
  const processText = (text, final) => {
    let position = 0;
    const end = final ? text.length : Math.max(0, text.length - carryLength);
    const at = (token) => token.length > 0 && text.startsWith(token, position);
    while (position < end) {
      let size = 1;
      const record = !quoted && recordDelimiters.find(at);
      if (
        quoted &&
        at(escape) &&
        text.startsWith(quote, position + escape.length)
      )
        size = escape.length + quote.length;
      else if (!commenting && at(quote)) {
        quoted = !quoted;
        size = quote.length;
      } else if (record) {
        cells += columns;
        checkLength(cells, maxCells, "Delimited cell count");
        units = 0;
        columns = 1;
        commenting = false;
        position += record.length;
        continue;
      } else if (!quoted && !commenting && at(commentPrefix)) {
        commenting = true;
        size = commentPrefix.length;
      } else if (!quoted && !commenting && at(delimiter)) {
        checkLength(++columns, maxColumns, "Record column count");
        size = delimiter.length;
      }
      units += size;
      checkLength(units, maxUnits, "Delimited record (8 Mi UTF-16)");
      position += size;
    }
    carry = text.slice(position);
    if (final)
      checkLength(
        cells + (units || columns > 1 ? columns : 0),
        maxCells,
        "Delimited cell count",
      );
  };
  return (text, final = false) => processText(carry + text, final);
}

function recordBudget(format, limits) {
  const validate = createValidator(format, limits);
  return new Transform({
    decodeStrings: false,
    transform(chunk, _encoding, done) {
      try {
        validate(chunk.toString());
        this.push(chunk);
        done();
      } catch (error) {
        done(error);
      }
    },
    flush(done) {
      try {
        validate("", true);
        done();
      } catch (error) {
        done(error);
      }
    },
  });
}
function validateRecordText(text, format, limits) {
  createValidator(format, limits)(text, true);
}
module.exports = { recordBudget, validateRecordText };
