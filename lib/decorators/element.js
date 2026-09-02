"use strict";

const { Disposable } = require("lumine");

const TAGS = [
  "a",
  "button",
  "div",
  "fieldset",
  "form",
  "h1",
  "i",
  "input",
  "label",
  "option",
  "p",
  "progress",
  "section",
  "select",
  "small",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "textarea",
  "th",
  "thead",
  "tr",
];

class DomBuilder {
  constructor() {
    this.fragment = document.createDocumentFragment();
    this.parent = this.fragment;
    this.outlets = {};
    for (const tag of TAGS) this[tag] = (...args) => this.tag(tag, ...args);
  }

  tag(name, ...args) {
    if (name === "content") return null;
    const node = document.createElement(name);
    let content;
    for (const argument of args) {
      if (typeof argument === "function") content = argument;
      else if (typeof argument === "string" || typeof argument === "number") {
        node.textContent = String(argument);
      } else if (argument && typeof argument === "object") {
        for (const [key, value] of Object.entries(argument)) {
          if (key === "outlet") this.outlets[value] = node;
          else if (key === "className") node.className = value;
          else if (value !== false && value != null)
            node.setAttribute(key, value === true ? "" : value);
        }
      }
    }
    this.parent.appendChild(node);
    if (content) {
      const parent = this.parent;
      this.parent = node;
      content.call(this);
      this.parent = parent;
    }
    return node;
  }
}

function buildContent(host, content) {
  if (host.__contentBuilt || typeof content !== "function") return;
  const builder = new DomBuilder();
  content.call(builder);
  host.appendChild(builder.fragment);
  Object.assign(host, builder.outlets);
  host.__contentBuilt = true;
}

function subscribeTo(target, selector, handlers) {
  if (handlers == null) {
    handlers = selector;
    selector = null;
  }
  const listeners = [];
  for (const [eventName, handler] of Object.entries(handlers)) {
    const listener = (event) => {
      if (!selector) return handler.call(target, event);
      const match = event.target.closest?.(selector);
      if (match && target.contains(match)) return handler.call(match, event);
    };
    target.addEventListener(eventName, listener);
    listeners.push([eventName, listener]);
  }
  return new Disposable(() => {
    for (const [eventName, listener] of listeners)
      target.removeEventListener(eventName, listener);
  });
}

module.exports = function defineElement(ElementClass, name) {
  class ModernElement extends ElementClass {
    constructor() {
      super();
      this.createdCallback?.();
    }

    buildContent() {
      buildContent(this, this.constructor.content);
    }

    subscribeTo(target, selector, handlers) {
      return subscribeTo(target, selector, handlers);
    }

    connectedCallback() {
      this.attachedCallback?.();
    }

    disconnectedCallback() {
      this.detachedCallback?.();
    }
  }

  const existing = customElements.get(name);
  if (existing) return existing;
  customElements.define(name, ModernElement);
  return ModernElement;
};

module.exports.DomBuilder = DomBuilder;
module.exports.buildContent = buildContent;
module.exports.subscribeTo = subscribeTo;
