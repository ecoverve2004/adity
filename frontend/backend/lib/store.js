'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Tiny JSON-file store. Everything is loaded into memory on first use and
 * persisted atomically (write temp file, then rename) with a per-file queue.
 * Sized for a single-author portfolio, not a database replacement.
 */
function createStore(directory) {
  fs.mkdirSync(directory, { recursive: true });

  const cache = new Map();
  const queues = new Map();

  const fileFor = (name) => path.join(directory, `${name}.json`);

  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const file = fileFor(name);
    let data = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      data = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`[store] Could not read ${name}.json — starting empty.`, error.message);
      }
      data = [];
    }
    cache.set(name, data);
    return data;
  }

  function save(name) {
    const data = load(name);
    const file = fileFor(name);
    const previous = queues.get(name) || Promise.resolve();
    const job = previous
      .then(
        () =>
          new Promise((resolve, reject) => {
            const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
            fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf8', (writeError) => {
              if (writeError) return reject(writeError);
              fs.rename(temp, file, (renameError) => (renameError ? reject(renameError) : resolve()));
            });
          })
      )
      .catch((error) => {
        console.error(`[store] Failed to save ${name}.json`, error.message);
      });
    queues.set(name, job);
    return job;
  }

  return { load, save, directory };
}

module.exports = { createStore };
