"use strict";

const { Disposable } = require("lumine");

module.exports = function disposableEvent(target, type, listener, options) {
  target.addEventListener(type, listener, options);
  return new Disposable(() =>
    target.removeEventListener(type, listener, options),
  );
};
