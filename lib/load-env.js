const fs = require("fs");
const path = require("path");

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseEnvFile(content) {
  const parsed = {};
  const lines = String(content || "").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());

    if (key) {
      parsed[key] = value;
    }
  }

  return parsed;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const parsed = parseEnvFile(fs.readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }

  return true;
}

function loadLocalEnv(baseDir = process.cwd()) {
  const candidates = [
    path.join(baseDir, ".env.local"),
    path.join(baseDir, ".env"),
  ];

  return candidates.filter((filePath) => loadEnvFile(filePath));
}

module.exports = {
  loadLocalEnv,
};
