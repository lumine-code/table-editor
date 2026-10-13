"use strict";

let encoding, parser, stringifier;

module.exports = {
  loadEncoding() {
    return (encoding ||= import("iconv-lite")
      .then((namespace) => namespace.default ?? namespace)
      .catch((error) => {
        encoding = null;
        throw error;
      }));
  },
  loadParser() {
    return (parser ||= import("csv-parse")
      .then((namespace) => namespace.parse)
      .catch((error) => {
        parser = null;
        throw error;
      }));
  },
  loadStringifier() {
    return (stringifier ||= import("csv-stringify")
      .then((namespace) => namespace.stringify)
      .catch((error) => {
        stringifier = null;
        throw error;
      }));
  },
};
