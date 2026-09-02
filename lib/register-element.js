"use strict";

module.exports = function registerElement(name, ElementClass) {
  const registered = customElements.get(name);
  if (registered) return registered;
  customElements.define(name, ElementClass);
  return ElementClass;
};
