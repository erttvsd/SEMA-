'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.SEMA_DATA_DIR || path.join(__dirname, '..', 'storage');
const DB_PATH = path.join(DATA_DIR, 'sema.db');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const fresh = !fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

if (fresh) {
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}

module.exports = { db, DATA_DIR, UPLOAD_DIR: path.join(DATA_DIR, 'uploads'), DB_PATH, wasFresh: fresh };
