class Deck {
    static create() {
        const tiles = [];
        for (let a = 0; a <= 6; a++) {
            for (let b = a; b <= 6; b++) {
                tiles.push({ a, b });
            }
        }
        return tiles;
    }

    static shuffle(tiles) {
        const shuffled = [...tiles];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    static deal() {
        const tiles = this.shuffle(this.create());
        return [
            tiles.slice(0, 7),
            tiles.slice(7, 14),
            tiles.slice(14, 21),
            tiles.slice(21, 28)
        ];
    }

    static pipSum(hand) {
        return hand.reduce((sum, tile) => sum + tile.a + tile.b, 0);
    }

    static findDoubleBlank(hands) {
        for (let i = 0; i < hands.length; i++) {
            const idx = hands[i].findIndex(t => t.a === 0 && t.b === 0);
            if (idx !== -1) {
                return { playerIndex: i, tileIndex: idx };
            }
        }
        return null;
    }
}

module.exports = Deck;
