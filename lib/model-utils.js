"use strict";

function delegateMethods(target, property, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(target.prototype, name)) continue;
    Object.defineProperty(target.prototype, name, {
      configurable: true,
      writable: true,
      value(...args) {
        const receiver = this[property];
        if (!receiver || typeof receiver[name] !== "function") {
          throw new Error(
            `${this.constructor.name}.${name} has no ${property} delegate`,
          );
        }
        return receiver[name](...args);
      },
    });
  }
}

function delegateProperties(target, property, names) {
  for (const name of names) {
    Object.defineProperty(target.prototype, name, {
      configurable: true,
      get() {
        return this[property]?.[name];
      },
      set(value) {
        if (!this[property])
          throw new Error(`${this.constructor.name}.${name} has no delegate`);
        this[property][name] = value;
      },
    });
  }
}

function installDelegation(target) {
  target.delegatesMethods = (...parts) => {
    const options = parts.pop();
    delegateMethods(target, options.toProperty, parts.flat());
  };
  target.delegatesProperties = (...parts) => {
    const options = parts.pop();
    delegateProperties(target, options.toProperty, parts.flat());
  };
}

module.exports = { delegateMethods, delegateProperties, installDelegation };
