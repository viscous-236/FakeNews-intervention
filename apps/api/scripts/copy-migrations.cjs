const { cpSync } = require('node:fs');
const path = require('node:path');

cpSync(
  path.join(__dirname, '../src/db/migrations'),
  path.join(__dirname, '../dist/db/migrations'),
  {
    recursive: true,
  },
);
