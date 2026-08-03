class Room {
    constructor(code, hostId, hostUsername) {
        this.code = code;
        this.hostId = hostId;
        this.players = [{
            id: hostId,
            username: hostUsername,
            seat: 0,
            isBot: false,
            isReady: true,
            socketId: null
        }];
        this.status = 'waiting';
        this.game = null;
        this.chatHistory = [];
        this.createdAt = Date.now();
    }

    addPlayer(playerId, username, socketId) {
        if (this.players.length >= 4) {
            throw new Error('Room penuh');
        }

        if (this.status !== 'waiting') {
            throw new Error('Game sudah dimulai');
        }

        // Cek sudah join
        if (this.players.some(p => p.id === playerId)) {
            throw new Error('Sudah di room');
        }

        // Cari seat kosong
        const occupiedSeats = this.players.map(p => p.seat);
        let seat = 0;
        while (occupiedSeats.includes(seat)) seat++;

        this.players.push({
            id: playerId,
            username,
            seat,
            isBot: false,
            isReady: false,
            socketId
        });

        return seat;
    }

    removePlayer(playerId) {
        const index = this.players.findIndex(p => p.id === playerId);
        if (index !== -1) {
            this.players.splice(index, 1);
        }
    }

    setPlayerSocket(playerId, socketId) {
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            player.socketId = socketId;
        }
    }

    toggleReady(playerId) {
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            player.isReady = !player.isReady;
            return player.isReady;
        }
        return false;
    }

    addBots() {
        const botNames = ['Bot Kiri', 'Bot Atas', 'Bot Kanan'];
        const occupiedSeats = this.players.map(p => p.seat);

        for (let seat = 0; seat < 4; seat++) {
            if (!occupiedSeats.includes(seat)) {
                this.players.push({
                    id: `bot_${seat}`,
                    username: botNames[seat] || `Bot ${seat}`,
                    seat,
                    isBot: true,
                    isReady: true,
                    socketId: null
                });
            }
        }
    }

    canStart() {
        const humanPlayers = this.players.filter(p => !p.isBot);
        return humanPlayers.length >= 1;
    }

    startGame() {
        if (this.status !== 'waiting') {
            throw new Error('Game sudah dimulai');
        }

        // Tambah bot jika kurang
        if (this.players.length < 4) {
            this.addBots();
        }

        // Sort by seat
        this.players.sort((a, b) => a.seat - b.seat);

        this.status = 'playing';
    }

    getPublicInfo() {
        return {
            code: this.code,
            hostId: this.hostId,
            status: this.status,
            players: this.players.map(p => ({
                id: p.id,
                username: p.username,
                seat: p.seat,
                isBot: p.isBot,
                isReady: p.isReady
            })),
            createdAt: this.createdAt
        };
    }

    toJSON() {
        return {
            code: this.code,
            hostId: this.hostId,
            status: this.status,
            players: this.players,
            chatHistory: this.chatHistory.slice(-50)
        };
    }
}

module.exports = Room;
