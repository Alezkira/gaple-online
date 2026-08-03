const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { prepare } = require('../database/db');
const config = require('../config');

// Register
router.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validasi
        if (!username || !password) {
            return res.status(400).json({ error: 'Username & password wajib diisi' });
        }

        if (username.length < 3 || username.length > 20) {
            return res.status(400).json({ error: 'Username harus 3-20 karakter' });
        }

        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).json({ error: 'Username hanya boleh huruf, angka, dan underscore' });
        }

        if (password.length < 4) {
            return res.status(400).json({ error: 'Password minimal 4 karakter' });
        }

        // Cek username sudah ada
        const existing = prepare('SELECT id FROM players WHERE username = ?').get(username);
        if (existing) {
            return res.status(400).json({ error: 'Username sudah dipakai' });
        }

        // Hash password & insert
        const hash = await bcrypt.hash(password, 10);
        const result = prepare('INSERT INTO players (username, password_hash, display_name) VALUES (?, ?, ?)').run(username, hash, username);

        // Generate token
        const token = jwt.sign(
            { id: result.lastInsertRowid, username },
            config.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: result.lastInsertRowid,
                username,
                elo_rating: 1000,
                games_played: 0,
                wins: 0,
                losses: 0
            }
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username & password wajib diisi' });
        }

        // Cari user
        const user = prepare('SELECT * FROM players WHERE username = ?').get(username);
        if (!user) {
            return res.status(401).json({ error: 'Username tidak ditemukan' });
        }

        // Cek password
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Password salah' });
        }

        // Update last_seen
        prepare('UPDATE players SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

        // Generate token
        const token = jwt.sign(
            { id: user.id, username },
            config.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                display_name: user.display_name,
                elo_rating: user.elo_rating,
                games_played: user.games_played,
                wins: user.wins,
                losses: user.losses,
                draws: user.draws
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Verify token
router.get('/verify', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token tidak ada' });
    }

    try {
        const decoded = jwt.verify(token, config.JWT_SECRET);
        const user = prepare('SELECT id, username, display_name, elo_rating, games_played, wins, losses, draws FROM players WHERE id = ?').get(decoded.id);

        if (!user) {
            return res.status(401).json({ error: 'User tidak ditemukan' });
        }

        res.json({ success: true, user });
    } catch (err) {
        res.status(401).json({ error: 'Token tidak valid' });
    }
});

module.exports = router;
