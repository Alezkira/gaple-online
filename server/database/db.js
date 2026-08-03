const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const dbPath = path.resolve(__dirname, '..', config.DB_PATH);

let db = null;

async function initDatabase() {
    const SQL = await initSqlJs();

    // Load existing database or create new one
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    // Create tables
    db.run(`
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT,
            elo_rating INTEGER DEFAULT 1000,
            games_played INTEGER DEFAULT 0,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            draws INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            host_id INTEGER NOT NULL,
            status TEXT DEFAULT 'waiting',
            max_players INTEGER DEFAULT 4,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (host_id) REFERENCES players(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS room_players (
            room_id TEXT NOT NULL,
            player_id INTEGER,
            seat_index INTEGER NOT NULL,
            is_bot INTEGER DEFAULT 0,
            is_ready INTEGER DEFAULT 0,
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (room_id, seat_index),
            FOREIGN KEY (room_id) REFERENCES rooms(id),
            FOREIGN KEY (player_id) REFERENCES players(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL,
            winner_team INTEGER,
            team_a_score INTEGER,
            team_b_score INTEGER,
            rounds_played INTEGER,
            started_at DATETIME,
            finished_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (room_id) REFERENCES rooms(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS match_players (
            match_id INTEGER NOT NULL,
            player_id INTEGER,
            seat_index INTEGER NOT NULL,
            team INTEGER NOT NULL,
            is_bot INTEGER DEFAULT 0,
            elo_before INTEGER,
            elo_after INTEGER,
            elo_change INTEGER,
            PRIMARY KEY (match_id, seat_index),
            FOREIGN KEY (match_id) REFERENCES matches(id),
            FOREIGN KEY (player_id) REFERENCES players(id)
        )
    `);

    // Save database
    saveDatabase();

    return db;
}

function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);
    }
}

function getDb() {
    return db;
}

// Helper functions to mimic better-sqlite3 API
function prepare(sql) {
    return {
        run(...params) {
            db.run(sql, params);
            saveDatabase();
            return {
                lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] || 0,
                changes: db.getRowsModified()
            };
        },
        get(...params) {
            const stmt = db.prepare(sql);
            stmt.bind(params);
            if (stmt.step()) {
                const row = stmt.getAsObject();
                stmt.free();
                return row;
            }
            stmt.free();
            return undefined;
        },
        all(...params) {
            const results = [];
            const stmt = db.prepare(sql);
            stmt.bind(params);
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
            stmt.free();
            return results;
        }
    };
}

module.exports = { initDatabase, getDb, prepare, saveDatabase };
