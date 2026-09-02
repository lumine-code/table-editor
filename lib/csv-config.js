"use strict";

const path = require("path");

module.exports = class FilePreferences {
  constructor(state = {}) {
    this.files =
      state.version === 1 && state.files ? structuredClone(state.files) : {};
  }

  key(filePath) {
    return path.resolve(filePath);
  }

  get(filePath, property) {
    const entry = this.files[this.key(filePath)];
    return property ? entry?.[property] : entry;
  }

  set(filePath, property, value) {
    const key = this.key(filePath);
    this.files[key] ||= {};
    this.files[key][property] = structuredClone(value);
  }

  move(previousPath, nextPath) {
    const previousKey = this.key(previousPath);
    const nextKey = this.key(nextPath);
    if (this.files[previousKey]) this.files[nextKey] = this.files[previousKey];
    delete this.files[previousKey];
  }

  clear(filePath) {
    if (filePath) delete this.files[this.key(filePath)];
    else this.files = {};
  }

  clearProperty(property, filePath) {
    if (filePath) {
      const entry = this.files[this.key(filePath)];
      if (entry) delete entry[property];
      return;
    }
    for (const entry of Object.values(this.files)) delete entry[property];
  }

  serialize() {
    return { version: 1, files: structuredClone(this.files) };
  }
};
