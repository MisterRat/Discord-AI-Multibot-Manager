// Container entrypoint. Starts as root only long enough to make the data folder
// writable by the unprivileged "node" user (installs from before 1.3.0 created
// their files as root), then drops privileges and starts the app as "node".
'use strict';
const fs = require('fs');
const path = require('path');

// The "node" user in the official Node.js images.
const NODE_UID = 1000;
const NODE_GID = 1000;

function chownTree(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return;
  }
  if (stat.uid !== NODE_UID || stat.gid !== NODE_GID) {
    try {
      fs.lchownSync(target, NODE_UID, NODE_GID);
    } catch (err) {
      console.warn(`Could not change owner of ${target}: ${err.message}`);
    }
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target)) chownTree(path.join(target, name));
  }
}

if (typeof process.getuid === 'function' && process.getuid() === 0) {
  const dataDir = path.dirname(path.resolve(process.env.CONFIG_PATH || '/app/data/config.json'));
  fs.mkdirSync(dataDir, { recursive: true });
  chownTree(dataDir);
  process.setgroups([NODE_GID]);
  process.setgid(NODE_GID);
  process.setuid(NODE_UID);
}

require('./dist/server.cjs');
