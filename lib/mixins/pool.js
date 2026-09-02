"use strict";

const include = require("../decorators/include");

module.exports = class Pool {
  static includeInto(target) {
    include(target, this);
  }

  static pool(singular, plural) {
    const title = singular[0].toUpperCase() + singular.slice(1);
    const pluralTitle = plural[0].toUpperCase() + plural.slice(1);
    const used = `used${pluralTitle}`;
    const unused = `unused${pluralTitle}`;

    this.prototype[`init${pluralTitle}Pool`] = function (
      ElementClass,
      container,
    ) {
      this[`${plural}Class`] = ElementClass;
      this[`${plural}Container`] = container;
      this[used] ||= [];
      this[unused] ||= [];
      return this[unused];
    };

    this.prototype[`request${title}`] = function (model) {
      const instance = this[unused].shift() || new this[`${plural}Class`]();
      if (!instance.parentNode)
        this[`${plural}Container`].appendChild(instance);
      instance.tableElement = this;
      instance.tableEditor = this.getModel();
      instance.setModel(model);
      this[used].push(instance);
      return instance;
    };

    this.prototype[`release${title}`] = function (instance) {
      if (instance.isReleased()) return;
      const index = this[used].indexOf(instance);
      if (index >= 0) this[used].splice(index, 1);
      this[unused].push(instance);
      instance.release(false);
    };

    this.prototype[`total${title}Count`] = function () {
      return this[used].length + this[unused].length;
    };

    this.prototype[`clear${pluralTitle}`] = function () {
      for (const instance of this[used]) instance.release(false);
      this[used] = [];
      this[unused] = [];
    };
  }
};
