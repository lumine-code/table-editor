"use strict";

const path = require("path");
let layoutHelpers;
const compactLayout = (layout) =>
  (layoutHelpers ||= require("./csv-layout")).compactLayout(layout);

function compactFiles(files) {
  const result = {};
  for (const [filePath, entry] of Object.entries(files || {})) {
    const { layout, options } = entry;
    const compact = compactLayout(layout);
    const value = {
      ...(options ? { options: structuredClone(options) } : {}),
      ...(Object.keys(compact).length ? { layout: compact } : {}),
    };
    if (Object.keys(value).length) result[filePath] = value;
  }
  return result;
}

module.exports = class FilePreferences {
  constructor(state = {}, { didChange = null } = {}) {
    // Project preferences can contain a large map of remembered table layouts.
    // Keep the state reference during package initialization and clone it only
    // when an opener, command or serializer actually needs preferences.
    this._state = state;
    this._files = null;
    this.didChange = didChange;
  }

  restoreState(state = {}) {
    this._state = state;
    this._files = null;
  }

  get files() {
    if (this._files === null) {
      const state = this._state;
      this._files =
        state?.version === 1 && state.files ? compactFiles(state.files) : {};
      this._state = null;
    }
    return this._files;
  }

  set files(value) {
    this._files = value;
    this._state = null;
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
    if (property === "layout") {
      value = compactLayout(value);
      if (Object.keys(value).length === 0) {
        this.clearProperty(property, filePath);
        return;
      }
    }
    this.files[key] ||= {};
    this.files[key][property] = structuredClone(value);
    this.didChange?.(this.serialize());
  }

  move(previousPath, nextPath) {
    const previousKey = this.key(previousPath);
    const nextKey = this.key(nextPath);
    if (this.files[previousKey]) this.files[nextKey] = this.files[previousKey];
    delete this.files[previousKey];
    this.didChange?.(this.serialize());
  }

  clear(filePath) {
    if (filePath) delete this.files[this.key(filePath)];
    else this.files = {};
    this.didChange?.(this.serialize());
  }

  clearProperty(property, filePath) {
    if (filePath) {
      const entry = this.files[this.key(filePath)];
      if (entry) {
        delete entry[property];
        if (Object.keys(entry).length === 0)
          delete this.files[this.key(filePath)];
      }
    } else {
      for (const [filePath, entry] of Object.entries(this.files)) {
        delete entry[property];
        if (Object.keys(entry).length === 0) delete this.files[filePath];
      }
    }
    this.didChange?.(this.serialize());
  }

  serialize() {
    return { version: 1, files: compactFiles(this.files) };
  }
};
