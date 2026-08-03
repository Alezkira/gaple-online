const jwt = require('jsonwebtoken');
const config = require('../config');

function authenticateSocket(socket, next) {
    const token = socket.handshake.auth.token;

    if (!token) {
        return next(new Error('Authentication required'));
    }

    try {
        const decoded = jwt.verify(token, config.JWT_SECRET);
        socket.userId = decoded.id;
        socket.username = decoded.username;
        next();
    } catch (err) {
        next(new Error('Invalid token'));
    }
}

function authenticateHTTP(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token tidak ada' });
    }

    try {
        const decoded = jwt.verify(token, config.JWT_SECRET);
        req.userId = decoded.id;
        req.username = decoded.username;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Token tidak valid' });
    }
}

module.exports = { authenticateSocket, authenticateHTTP };
