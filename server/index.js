const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { initDatabase, prepare } = require('./database/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Routes
const authRoutes = require('./auth/auth');
app.use('/api/auth', authRoutes);

// API routes
app.get('/api/leaderboard', (req, res) => {
    try {
        const players = prepare(`
            SELECT id, username, display_name, elo_rating, games_played, wins, losses
            FROM players
            WHERE games_played > 0
            ORDER BY elo_rating DESC
            LIMIT 50
        `).all();
        res.json(players);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/stats/:username', (req, res) => {
    try {
        const player = prepare(`
            SELECT id, username, display_name, elo_rating, games_played, wins, losses, draws
            FROM players
            WHERE username = ?
        `).get(req.params.username);

        if (!player) {
            return res.status(404).json({ error: 'Player not found' });
        }
        res.json(player);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Gaple Online Server' });
});

// Initialize database and start server
async function start() {
    try {
        await initDatabase();
        console.log('Database initialized');

        // Socket.io setup
        require('./socket/index')(io, { prepare });

        server.listen(config.PORT, () => {
            console.log(`Server running on port ${config.PORT}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

start();
