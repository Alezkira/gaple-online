const Room = require('../game/Room');
const GameManager = require('../game/GameManager');
const Bot = require('../game/Bot');
const Deck = require('../game/Deck');
const { authenticateSocket } = require('../auth/middleware');

// Store active rooms
const rooms = new Map();

module.exports = function(io, db) {
    // Authentication middleware
    io.use(authenticateSocket);

    io.on('connection', (socket) => {
        console.log(`Player connected: ${socket.username} (${socket.id})`);

        // CREATE ROOM
        socket.on('create-room', (callback) => {
            try {
                const code = generateRoomCode();

                // Insert room ke database
                db.prepare('INSERT INTO rooms (id, host_id) VALUES (?, ?)').run(code, socket.userId);
                db.prepare('INSERT INTO room_players (room_id, player_id, seat_index, is_bot) VALUES (?, ?, 0, 0)').run(code, socket.userId);

                // Buat room object
                const room = new Room(code, socket.userId, socket.username);
                room.players[0].socketId = socket.id;
                rooms.set(code, room);

                socket.join(code);
                socket.roomCode = code;

                callback({ success: true, room: room.getPublicInfo() });
            } catch (err) {
                console.error('Create room error:', err);
                callback({ success: false, error: err.message });
            }
        });

        // JOIN ROOM
        socket.on('join-room', (data, callback) => {
            try {
                const { roomCode } = data;
                const room = rooms.get(roomCode);

                if (!room) {
                    return callback({ success: false, error: 'Room tidak ditemukan' });
                }

                // Allow rejoin even if game is playing (for socket reconnect)
                const existingPlayer = room.players.find(p => p.id === socket.userId);
                if (existingPlayer) {
                    existingPlayer.socketId = socket.id;
                    socket.join(roomCode);
                    socket.roomCode = roomCode;
                    io.to(roomCode).emit('room-update', room.getPublicInfo());
                    return callback({ success: true, room: room.getPublicInfo(), seat: existingPlayer.seat });
                }

                if (room.status !== 'waiting') {
                    return callback({ success: false, error: 'Game sudah dimulai' });
                }

                if (room.players.length >= 4) {
                    return callback({ success: false, error: 'Room penuh' });
                }

                const seat = room.addPlayer(socket.userId, socket.username, socket.id);
                db.prepare('INSERT INTO room_players (room_id, player_id, seat_index, is_bot) VALUES (?, ?, ?, 0)').run(roomCode, socket.userId, seat);
                socket.join(roomCode);
                socket.roomCode = roomCode;
                io.to(roomCode).emit('room-update', room.getPublicInfo());
                callback({ success: true, room: room.getPublicInfo(), seat });
            } catch (err) {
                console.error('Join room error:', err);
                callback({ success: false, error: err.message });
            }
        });

        // LEAVE ROOM
        socket.on('leave-room', (callback) => {
            try {
                const room = rooms.get(socket.roomCode);

                if (room) {
                    room.removePlayer(socket.userId);

                    // Hapus dari database
                    db.prepare('DELETE FROM room_players WHERE room_id = ? AND player_id = ?').run(socket.roomCode, socket.userId);

                    socket.leave(socket.roomCode);

                    if (room.players.length === 0) {
                        // Hapus room jika kosong
                        db.prepare('DELETE FROM rooms WHERE id = ?').run(socket.roomCode);
                        rooms.delete(socket.roomCode);
                    } else {
                        // Update host jika perlu
                        if (room.hostId === socket.userId) {
                            room.hostId = room.players[0].id;
                            db.prepare('UPDATE rooms SET host_id = ? WHERE id = ?').run(room.hostId, socket.roomCode);
                        }

                        io.to(socket.roomCode).emit('room-update', room.getPublicInfo());
                    }
                }

                socket.roomCode = null;
                callback({ success: true });
            } catch (err) {
                console.error('Leave room error:', err);
                callback({ success: false, error: err.message });
            }
        });

        // TOGGLE READY
        socket.on('toggle-ready', (callback) => {
            try {
                const room = rooms.get(socket.roomCode);

                if (!room) {
                    return callback({ success: false, error: 'Room tidak ditemukan' });
                }

                const isReady = room.toggleReady(socket.userId);

                io.to(socket.roomCode).emit('room-update', room.getPublicInfo());

                callback({ success: true, isReady });
            } catch (err) {
                callback({ success: false, error: err.message });
            }
        });

        // START GAME
        socket.on('start-game', (callback) => {
            try {
                const room = rooms.get(socket.roomCode);

                if (!room) {
                    return callback({ success: false, error: 'Room tidak ditemukan' });
                }

                if (room.hostId !== socket.userId) {
                    return callback({ success: false, error: 'Hanya host yang bisa mulai game' });
                }

                // Mulai game
                room.startGame();
                room.game = new GameManager(room.players);

                // Update database
                db.prepare('UPDATE rooms SET status = ? WHERE id = ?').run('playing', socket.roomCode);

                // Kirim kartu ke masing-masing player
                room.players.forEach((player, index) => {
                    if (!player.isBot && player.socketId) {
                        const playerSocket = io.sockets.sockets.get(player.socketId);
                        if (playerSocket) {
                            playerSocket.emit('game-start', {
                                hand: room.game.hands[index],
                                players: room.players.map(p => ({
                                    username: p.username,
                                    seat: p.seat,
                                    isBot: p.isBot,
                                    cardCount: room.game.hands[p.seat].length
                                })),
                                turn: room.game.turn,
                                mySeat: index,
                                roomCode: socket.roomCode
                            });
                        }
                    }
                });

                // Delay turn-start to give players time to join room on new socket
                setTimeout(() => {
                    // Broadcast turn start
                    io.to(socket.roomCode).emit('turn-start', {
                        turn: room.game.turn,
                        player: room.players[room.game.turn].username
                    });

                    // Jika giliran bot, jalankan
                    if (room.players[room.game.turn].isBot) {
                        setTimeout(() => handleBotTurn(room, io, db), 1000);
                    }
                }, 2000);

                callback({ success: true });
            } catch (err) {
                console.error('Start game error:', err);
                callback({ success: false, error: err.message });
            }
        });

        // PLAY TILE
        socket.on('play-tile', (data, callback) => {
            try {
                const { tileIdx, side } = data;
                const room = rooms.get(socket.roomCode);

                if (!room || !room.game) {
                    return callback({ success: false, error: 'Game tidak aktif' });
                }

                const playerSeat = room.players.find(p => p.id === socket.userId)?.seat;

                if (playerSeat === undefined) {
                    return callback({ success: false, error: 'Pemain tidak ditemukan' });
                }

                const result = room.game.playTile(playerSeat, tileIdx, side);

                // Broadcast ke semua
                io.to(socket.roomCode).emit('tile-played', {
                    player: socket.username,
                    seat: playerSeat,
                    tile: result.tile,
                    side: result.side,
                    isBot: false
                });

                // Cek game over
                if (result.gameOver) {
                    handleGameOver(room, result, io, db);
                } else {
                    // Next turn
                    io.to(socket.roomCode).emit('turn-start', {
                        turn: result.nextTurn,
                        player: room.players[result.nextTurn].username
                    });

                    // Update card counts
                    io.to(socket.roomCode).emit('update-hands', {
                        hands: room.players.map((p, i) => ({
                            seat: i,
                            cardCount: room.game.hands[i].length
                        }))
                    });

                    // Jika bot, jalankan
                    if (room.players[result.nextTurn].isBot) {
                        setTimeout(() => handleBotTurn(room, io, db), 1000 + Math.random() * 1000);
                    }
                }

                callback({ success: true });
            } catch (err) {
                console.error('Play tile error:', err);
                callback({ success: false, error: err.message });
            }
        });

        // PASS TURN
        socket.on('pass-turn', (callback) => {
            try {
                const room = rooms.get(socket.roomCode);

                if (!room || !room.game) {
                    return callback({ success: false, error: 'Game tidak aktif' });
                }

                const playerSeat = room.players.find(p => p.id === socket.userId)?.seat;
                const result = room.game.passTurn(playerSeat);

                // Broadcast pass
                io.to(socket.roomCode).emit('player-pass', {
                    player: socket.username,
                    seat: playerSeat,
                    isBot: false
                });

                if (result.gameOver) {
                    // Buntu
                    handleGameOver(room, { buntu: true, gameOver: true }, io, db);
                } else {
                    // Next turn
                    io.to(socket.roomCode).emit('turn-start', {
                        turn: result.nextTurn,
                        player: room.players[result.nextTurn].username
                    });

                    // Jika bot, jalankan
                    if (room.players[result.nextTurn].isBot) {
                        setTimeout(() => handleBotTurn(room, io, db), 1000 + Math.random() * 1000);
                    }
                }

                callback({ success: true });
            } catch (err) {
                callback({ success: false, error: err.message });
            }
        });

        // CHAT MESSAGE
        socket.on('chat-message', (text) => {
            try {
                const room = rooms.get(socket.roomCode);

                if (!room) return;

                // Sanitize
                const cleanText = String(text).substring(0, 200).replace(/[<>]/g, '');

                const message = {
                    username: socket.username,
                    text: cleanText,
                    timestamp: Date.now()
                };

                room.chatHistory.push(message);
                if (room.chatHistory.length > 100) {
                    room.chatHistory.shift();
                }

                io.to(socket.roomCode).emit('chat-message', message);
            } catch (err) {
                console.error('Chat error:', err);
            }
        });

        // DISCONNECT
        socket.on('disconnect', () => {
            console.log(`Player disconnected: ${socket.username}`);

            if (socket.roomCode) {
                const room = rooms.get(socket.roomCode);

                if (room) {
                    room.removePlayer(socket.userId);

                    // Hapus dari database
                    db.prepare('DELETE FROM room_players WHERE room_id = ? AND player_id = ?').run(socket.roomCode, socket.userId);

                    if (room.players.length === 0) {
                        db.prepare('DELETE FROM rooms WHERE id = ?').run(socket.roomCode);
                        rooms.delete(socket.roomCode);
                    } else {
                        // Update host
                        if (room.hostId === socket.userId) {
                            room.hostId = room.players[0].id;
                            db.prepare('UPDATE rooms SET host_id = ? WHERE id = ?').run(room.hostId, socket.roomCode);
                        }

                        io.to(socket.roomCode).emit('room-update', room.getPublicInfo());
                        io.to(socket.roomCode).emit('player-disconnected', {
                            username: socket.username
                        });
                    }
                }
            }
        });
    });

    // Helper: Generate room code
    function generateRoomCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    // Helper: Handle bot turn
    function handleBotTurn(room, io, db) {
        if (!room.game || room.game.gameOver) return;

        const botIndex = room.game.turn;
        const botPlayer = room.players[botIndex];

        if (!botPlayer || !botPlayer.isBot) return;

        const gameState = room.game.getFullState();
        const move = Bot.pickMove(gameState, botIndex);

        if (move) {
            try {
                const result = room.game.playTile(botIndex, move.idx, move.side);

                // Broadcast
                io.to(room.code).emit('tile-played', {
                    player: botPlayer.username,
                    seat: botIndex,
                    tile: result.tile,
                    side: result.side,
                    isBot: true
                });

                if (result.gameOver) {
                    handleGameOver(room, result, io, db);
                } else {
                    // Next turn
                    io.to(room.code).emit('turn-start', {
                        turn: result.nextTurn,
                        player: room.players[result.nextTurn].username
                    });

                    // Update card counts
                    io.to(room.code).emit('update-hands', {
                        hands: room.players.map((p, i) => ({
                            seat: i,
                            cardCount: room.game.hands[i].length
                        }))
                    });

                    // Jika masih bot
                    if (room.players[result.nextTurn].isBot) {
                        setTimeout(() => handleBotTurn(room, io, db), 1000 + Math.random() * 1000);
                    }
                }
            } catch (err) {
                console.error('Bot play error:', err);
                // Bot pass
                try {
                    const passResult = room.game.passTurn(botIndex);

                    io.to(room.code).emit('player-pass', {
                        player: botPlayer.username,
                        seat: botIndex,
                        isBot: true
                    });

                    if (passResult.gameOver) {
                        handleGameOver(room, { buntu: true, gameOver: true }, io, db);
                    } else {
                        io.to(room.code).emit('turn-start', {
                            turn: passResult.nextTurn,
                            player: room.players[passResult.nextTurn].username
                        });

                        if (room.players[passResult.nextTurn].isBot) {
                            setTimeout(() => handleBotTurn(room, io, db), 1000 + Math.random() * 1000);
                        }
                    }
                } catch (passErr) {
                    console.error('Bot pass error:', passErr);
                }
            }
        } else {
            // Bot pass
            try {
                const passResult = room.game.passTurn(botIndex);

                io.to(room.code).emit('player-pass', {
                    player: botPlayer.username,
                    seat: botIndex,
                    isBot: true
                });

                if (passResult.gameOver) {
                    handleGameOver(room, { buntu: true, gameOver: true }, io, db);
                } else {
                    io.to(room.code).emit('turn-start', {
                        turn: passResult.nextTurn,
                        player: room.players[passResult.nextTurn].username
                    });

                    if (room.players[passResult.nextTurn].isBot) {
                        setTimeout(() => handleBotTurn(room, io, db), 1000 + Math.random() * 1000);
                    }
                }
            } catch (err) {
                console.error('Bot pass error:', err);
            }
        }
    }

    // Helper: Handle game over
    function handleGameOver(room, result, io, db) {
        room.status = 'finished';
        room.game.gameOver = true;

        let winnerTeam, loserTeam, scores, reason;

        if (result.buntu) {
            // Buntu - calculate scores
            const buntuResult = room.game.calculateBuntuScores();
            winnerTeam = buntuResult.winnerTeam;
            loserTeam = buntuResult.loserTeam;
            scores = room.game.scores;
            scores[loserTeam] += buntuResult.scoredPips;
            reason = `Buntu! ${room.players[buntuResult.winnerIndex].username} punya kartu paling kecil`;
        } else {
            winnerTeam = result.winnerTeam;
            loserTeam = winnerTeam === 0 ? 1 : 0;
            scores = room.game.scores;
            reason = `${room.players[result.winner].username} menghabiskan kartu!`;
        }

        // Update ELO ratings
        const eloChanges = updateEloRatings(room, winnerTeam, db);

        // Update database
        db.prepare('UPDATE rooms SET status = ? WHERE id = ?').run('finished', room.code);

        // Insert match record
        const matchResult = db.prepare(`
            INSERT INTO matches (room_id, winner_team, team_a_score, team_b_score, rounds_played)
            VALUES (?, ?, ?, ?, ?)
        `).run(room.code, winnerTeam, scores[0], scores[1], room.game.roundNumber);

        // Insert match players
        room.players.forEach((player, index) => {
            const team = index % 2;
            const eloBefore = player.isBot ? 1000 : (db.prepare('SELECT elo_rating FROM players WHERE id = ?').get(player.id)?.elo_rating || 1000);
            const eloChange = eloChanges[index] || 0;

            db.prepare(`
                INSERT INTO match_players (match_id, player_id, seat_index, team, is_bot, elo_before, elo_after, elo_change)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                matchResult.lastInsertRowid,
                player.isBot ? null : player.id,
                index,
                team,
                player.isBot ? 1 : 0,
                eloBefore,
                eloBefore + eloChange,
                eloChange
            );

            // Update player stats
            if (!player.isBot) {
                const isWinner = team === winnerTeam;
                db.prepare(`
                    UPDATE players
                    SET elo_rating = ?,
                        games_played = games_played + 1,
                        wins = wins + ?,
                        losses = losses + ?,
                        last_seen = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(eloBefore + eloChange, isWinner ? 1 : 0, isWinner ? 0 : 1, player.id);
            }
        });

        // Broadcast game over
        io.to(room.code).emit('game-over', {
            winnerTeam,
            loserTeam,
            scores,
            reason,
            eloChanges,
            players: room.players.map((p, i) => ({
                username: p.username,
                seat: i,
                isBot: p.isBot,
                eloChange: eloChanges[i] || 0
            }))
        });
    }

    // Helper: Update ELO ratings
    function updateEloRatings(room, winnerTeam, db) {
        const K_FACTOR = 32;
        const eloChanges = {};

        // Get current ratings
        const ratings = room.players.map(p => {
            if (p.isBot) return 1000;
            const row = db.prepare('SELECT elo_rating FROM players WHERE id = ?').get(p.id);
            return row ? row.elo_rating : 1000;
        });

        // Calculate team averages
        const teamA = [ratings[0], ratings[2]];
        const teamB = [ratings[1], ratings[3]];
        const avgA = (teamA[0] + teamA[1]) / 2;
        const avgB = (teamB[0] + teamB[1]) / 2;

        // Calculate changes
        room.players.forEach((p, i) => {
            const team = i % 2;
            const opponentAvg = team === 0 ? avgB : avgA;
            const score = team === winnerTeam ? 1 : 0;
            const expected = 1 / (1 + Math.pow(10, (opponentAvg - ratings[i]) / 400));
            const change = Math.round(K_FACTOR * (score - expected));

            eloChanges[i] = change;
        });

        return eloChanges;
    }
};
