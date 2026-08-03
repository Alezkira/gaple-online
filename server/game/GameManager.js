const Deck = require('./Deck');

class GameManager {
    constructor(players) {
        this.players = players;
        this.hands = Deck.deal();
        this.chain = [];
        this.centerIdx = 0;
        this.leftEnd = null;
        this.rightEnd = null;
        this.turn = 0;
        this.scores = [0, 0];
        this.passCount = 0;
        this.boardEmpty = true;
        this.lastPlayedTile = null;
        this.lastPlayedIndex = null;
        this.gameOver = false;
        this.winner = null;
        this.roundNumber = 1;

        // Find who has double blank
        const opener = Deck.findDoubleBlank(this.hands);
        if (opener) {
            this.turn = opener.playerIndex;
        }
    }

    getState(forPlayerIndex) {
        // Return state with hidden hands for other players
        const hands = this.hands.map((hand, idx) => {
            if (idx === forPlayerIndex) {
                return hand;
            }
            return hand.map(() => ({ hidden: true }));
        });

        return {
            hands,
            chain: this.chain,
            leftEnd: this.leftEnd,
            rightEnd: this.rightEnd,
            turn: this.turn,
            scores: this.scores,
            passCount: this.passCount,
            boardEmpty: this.boardEmpty,
            gameOver: this.gameOver,
            winner: this.winner,
            roundNumber: this.roundNumber,
            players: this.players.map(p => ({
                username: p.username,
                seat: p.seat,
                isBot: p.isBot,
                cardCount: this.hands[p.seat].length
            }))
        };
    }

    getFullState() {
        return {
            hands: this.hands,
            chain: this.chain,
            leftEnd: this.leftEnd,
            rightEnd: this.rightEnd,
            turn: this.turn,
            scores: this.scores,
            passCount: this.passCount,
            boardEmpty: this.boardEmpty,
            gameOver: this.gameOver,
            winner: this.winner,
            roundNumber: this.roundNumber
        };
    }

    legalMovesFor(playerIndex) {
        const hand = this.hands[playerIndex];
        const moves = [];

        if (this.boardEmpty) {
            hand.forEach((tile, idx) => {
                moves.push({ idx, tile, side: 'any' });
            });
            return moves;
        }

        hand.forEach((tile, idx) => {
            const matchesLeft = tile.a === this.leftEnd || tile.b === this.leftEnd;
            const matchesRight = tile.a === this.rightEnd || tile.b === this.rightEnd;

            if (matchesLeft) {
                moves.push({ idx, tile, side: 'left' });
            }
            if (matchesRight) {
                moves.push({ idx, tile, side: 'right' });
            }
        });

        return moves;
    }

    playTile(playerIndex, tileIndex, side) {
        // Validasi giliran
        if (playerIndex !== this.turn) {
            throw new Error('Bukan giliranmu');
        }

        const hand = this.hands[playerIndex];
        const tile = hand[tileIndex];

        if (!tile) {
            throw new Error('Kartu tidak ada');
        }

        // Validasi legal move
        const legalMoves = this.legalMovesFor(playerIndex);
        const isLegal = legalMoves.some(m =>
            m.idx === tileIndex && (m.side === side || side === 'any')
        );

        if (!isLegal && !this.boardEmpty) {
            throw new Error('Move tidak valid');
        }

        const isDouble = tile.a === tile.b;

        if (this.boardEmpty) {
            this.chain = [{
                a: tile.a,
                b: tile.b,
                isDouble,
                playedBy: playerIndex
            }];
            this.centerIdx = 0;
            this.leftEnd = tile.a;
            this.rightEnd = tile.b;
            this.boardEmpty = false;
            this.lastPlayedIndex = 0;
        } else if (side === 'right') {
            let leftPip, rightPip;
            if (tile.a === this.rightEnd) {
                leftPip = tile.a;
                rightPip = tile.b;
            } else {
                leftPip = tile.b;
                rightPip = tile.a;
            }
            this.chain.push({
                a: leftPip,
                b: rightPip,
                isDouble,
                playedBy: playerIndex
            });
            this.rightEnd = rightPip;
            this.lastPlayedIndex = this.chain.length - 1;
        } else if (side === 'left') {
            let leftPip, rightPip;
            if (tile.a === this.leftEnd) {
                rightPip = tile.a;
                leftPip = tile.b;
            } else {
                rightPip = tile.b;
                leftPip = tile.a;
            }
            this.chain.unshift({
                a: leftPip,
                b: rightPip,
                isDouble,
                playedBy: playerIndex
            });
            this.centerIdx += 1;
            this.leftEnd = leftPip;
            this.lastPlayedIndex = 0;
        }

        // Remove tile from hand
        hand.splice(tileIndex, 1);
        this.passCount = 0;
        this.lastPlayedTile = tile;

        // Check win
        if (hand.length === 0) {
            this.gameOver = true;
            this.winner = playerIndex;
            return {
                success: true,
                gameOver: true,
                winner: playerIndex,
                winnerTeam: playerIndex % 2,
                tile,
                side
            };
        }

        // Next turn
        this.turn = (this.turn + 1) % 4;

        // Skip to next player if needed (shouldn't happen in normal game)
        while (this.hands[this.turn].length === 0 && !this.gameOver) {
            this.turn = (this.turn + 1) % 4;
        }

        return {
            success: true,
            gameOver: false,
            tile,
            side,
            nextTurn: this.turn
        };
    }

    passTurn(playerIndex) {
        if (playerIndex !== this.turn) {
            throw new Error('Bukan giliranmu');
        }

        // Validasi memang tidak bisa jalan
        const moves = this.legalMovesFor(playerIndex);
        if (moves.length > 0) {
            throw new Error('Masih bisa jalan, tidak boleh pass');
        }

        this.passCount += 1;

        // Check buntu (4 pass berturut-turut)
        if (this.passCount >= 4) {
            this.gameOver = true;
            return {
                success: true,
                buntu: true,
                gameOver: true
            };
        }

        // Next turn
        this.turn = (this.turn + 1) % 4;

        return {
            success: true,
            buntu: false,
            gameOver: false,
            nextTurn: this.turn
        };
    }

    calculateBuntuScores() {
        const playerPips = this.hands.map(hand => Deck.pipSum(hand));

        // Find player with smallest pip count (individual winner)
        let minPip = Infinity;
        let winnerIndex = 0;
        for (let i = 0; i < 4; i++) {
            if (playerPips[i] < minPip) {
                minPip = playerPips[i];
                winnerIndex = i;
            }
        }

        const winnerTeam = winnerIndex % 2;
        const loserTeam = winnerTeam === 0 ? 1 : 0;

        // Calculate losing team's total pips
        const loserPips = loserTeam === 0
            ? playerPips[0] + playerPips[2]
            : playerPips[1] + playerPips[3];

        // Score is loser's pips if > 10, else 0
        const scoredPips = loserPips > 10 ? loserPips : 0;

        return {
            winnerIndex,
            winnerTeam,
            loserTeam,
            playerPips,
            loserPips,
            scoredPips
        };
    }
}

module.exports = GameManager;
