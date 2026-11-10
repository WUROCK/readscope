const fs = require('node:fs');
const path = require('node:path');
const { format } = require('node:util');

/** Desktop launchers can close inherited pipes. Logging must never crash the app. */
function installFileLogging(file) {
  const append = (level, args) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${format(...args)}\n`, 'utf8');
    } catch { /* Failure to write a log does not change application behavior. */ }
  };
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    console[level] = (...args) => append(level, args);
  }
  for (const stream of [process.stdout, process.stderr]) {
    stream?.on('error', (error) => {
      if (error.code !== 'EPIPE') append('stream-error', [error.message]);
    });
  }
  return file;
}

module.exports = { installFileLogging };
