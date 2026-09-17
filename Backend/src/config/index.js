// Stage 4 — Config module entry point. Routes/scripts should require
// this file, not the schema/service files directly.

const { CONFIG_VERSION, DEFAULT_CONFIG, validateConfig } = require("./config.schema");
const { getConfig, resetConfigCacheForTests } = require("./config.service");

module.exports = {
  CONFIG_VERSION,
  DEFAULT_CONFIG,
  validateConfig,
  getConfig,
  resetConfigCacheForTests,
};
