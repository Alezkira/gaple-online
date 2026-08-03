class Bot {
    static pickMove(gameState, botIndex) {
        const hand = gameState.hands[botIndex];
        const legalMoves = this.getLegalMoves(hand, gameState);

        if (legalMoves.length === 0) {
            return null; // Pass
        }

        if (legalMoves.length === 1) {
            return legalMoves[0];
        }

        // Advanced scoring
        const scored = legalMoves.map(move => {
            let score = 0;
            const tile = move.tile;
            const isDouble = tile.a === tile.b;

            // Calculate opponent pips deduction
            const opponentPips = this.deduceOpponentPips(gameState, botIndex);
            const partnerIndex = this.getPartnerIndex(botIndex);
            const partner = gameState.hands[partnerIndex];

            // Determine new end
            let newEnd;
            if (move.side === 'left') {
                newEnd = (tile.a === gameState.leftEnd) ? tile.b : tile.a;
            } else if (move.side === 'right') {
                newEnd = (tile.a === gameState.rightEnd) ? tile.b : tile.a;
            } else {
                newEnd = tile.b;
            }

            // === BLOCKING ===
            const opCanMatchNewEnd = opponentPips[newEnd] || 0;
            score -= opCanMatchNewEnd * 22;

            if (opCanMatchNewEnd === 0 && !gameState.boardEmpty) {
                score += 35; // Hard lock
            }

            // === TEAMWORK ===
            if (this.partnerCanMatch(newEnd, partner)) {
                score += 16;
                if (partner.length <= 2) score += 20;
                else if (partner.length <= 4) score += 10;
            }

            // === DUMP HEAVY TILES ===
            score += (tile.a + tile.b) * 2.0;

            // === DOUBLE STRATEGY ===
            if (isDouble) {
                const opMinLen = this.getMinOpponentLength(gameState, botIndex);
                if (opMinLen <= 2) {
                    score -= 30;
                } else if (opMinLen <= 3) {
                    score -= 15;
                } else {
                    score += 6;
                }
            }

            // === END GAME BLOCKING ===
            const opMinLen = this.getMinOpponentLength(gameState, botIndex);
            if (opMinLen <= 2) {
                if (opCanMatchNewEnd === 0) score += 40;
                else if (opCanMatchNewEnd === 1) score += 15;
                else score -= 20;
            }

            // === SAFE PIPS ===
            const played = this.countPlayedPips(gameState);
            if (played[newEnd] >= 4) {
                score += 10;
            }

            return { ...move, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored[0];
    }

    static getLegalMoves(hand, gameState) {
        const moves = [];

        if (gameState.boardEmpty) {
            hand.forEach((tile, idx) => {
                moves.push({ idx, tile, side: 'any' });
            });
            return moves;
        }

        hand.forEach((tile, idx) => {
            const matchesLeft = tile.a === gameState.leftEnd || tile.b === gameState.leftEnd;
            const matchesRight = tile.a === gameState.rightEnd || tile.b === gameState.rightEnd;

            if (matchesLeft) {
                moves.push({ idx, tile, side: 'left' });
            }
            if (matchesRight) {
                moves.push({ idx, tile, side: 'right' });
            }
        });

        return moves;
    }

    static getPartnerIndex(botIndex) {
        return (botIndex + 2) % 4;
    }

    static getOpponentIndices(botIndex) {
        const partner = this.getPartnerIndex(botIndex);
        return [0, 1, 2, 3].filter(i => i !== botIndex && i !== partner);
    }

    static getMinOpponentLength(gameState, botIndex) {
        const opponents = this.getOpponentIndices(botIndex);
        return Math.min(...opponents.map(i => gameState.hands[i].length));
    }

    static deduceOpponentPips(gameState, botIndex) {
        const played = this.countPlayedPips(gameState);
        const partnerIndex = this.getPartnerIndex(botIndex);

        const ownPips = new Array(7).fill(0);
        gameState.hands[botIndex].forEach(t => {
            if (!t.hidden) {
                ownPips[t.a]++;
                ownPips[t.b]++;
            }
        });
        gameState.hands[partnerIndex].forEach(t => {
            if (!t.hidden) {
                ownPips[t.a]++;
                ownPips[t.b]++;
            }
        });

        const remaining = new Array(7).fill(0);
        for (let v = 0; v <= 6; v++) {
            remaining[v] = Math.max(0, 7 - played[v] - ownPips[v]);
        }
        return remaining;
    }

    static countPlayedPips(gameState) {
        const played = new Array(7).fill(0);
        gameState.chain.forEach(t => {
            played[t.a]++;
            played[t.b]++;
        });
        return played;
    }

    static partnerCanMatch(pipVal, partnerHand) {
        return partnerHand.some(t => t.a === pipVal || t.b === pipVal);
    }
}

module.exports = Bot;
