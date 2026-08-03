"use strict";

/**
 * Production dependencies are copied and audited by package-windows.mjs.
 * Returning false tells electron-builder to use that physical closure as-is.
 */
exports.beforeBuild = async function beforeBuild() {
  return false;
};
