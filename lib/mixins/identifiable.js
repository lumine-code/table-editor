"use strict";

const include = require("../decorators/include");

module.exports = class Identifiable {
  static includeInto(target) {
    include(target, this);
  }

  initID() {
    if (!this.constructor.lastID) this.constructor.lastID = 0;
    this.id = ++this.constructor.lastID;
  }
};
