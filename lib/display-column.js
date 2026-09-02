"use strict";

const { Emitter } = require("lumine");
const widthConfig = "table-editor.tableEditor.columnWidth";

class DisplayColumn {
  get name() {
    return this.options.name;
  }
  set name(newName) {
    const oldName = this.name;
    this.setOption("name", newName);
    this.emitter.emit("did-change-name", { oldName, newName, column: this });
  }

  get width() {
    return this.options.width || lumine.config.get(widthConfig);
  }
  set width(newWidth) {
    this.setOption("width", newWidth);
  }

  get align() {
    return this.options.align || "left";
  }
  set align(newAlign) {
    this.setOption("align", newAlign);
  }

  get formatCell() {
    return this.options.formatCell;
  }
  set formatCell(formatCell) {
    this.setOption("formatCell", formatCell);
  }

  get paintCell() {
    return this.options.paintCell;
  }
  set paintCell(paintCell) {
    this.setOption("paintCell", paintCell);
  }

  get grammarScope() {
    return this.options.grammarScope || "text.plain.null-grammar";
  }
  set grammarScope(newGrammarScope) {
    this.setOption("grammarScope", newGrammarScope);
  }

  constructor(options = {}) {
    this.options = options;
    this.emitter = new Emitter();
  }

  onDidChangeName(callback) {
    return this.emitter.on("did-change-name", callback);
  }

  onDidChangeOption(callback) {
    return this.emitter.on("did-change-option", callback);
  }

  setOptions(options = {}) {
    return (() => {
      let result = [];
      for (let name in options) {
        let value = options[name];
        if (name !== "name") {
          result.push((this[name] = value));
        }
      }
      return result;
    })();
  }

  setOption(name, newValue, batch = false) {
    let oldValue = this[name];
    this.options[name] = newValue;

    if (!batch) {
      return this.emitter.emit("did-change-option", {
        option: name,
        column: this,
        oldValue,
        newValue,
      });
    }
  }
}

module.exports = DisplayColumn;
