module.exports = {
    JWT_SECRET: process.env.JWT_SECRET || 'gaple-secret-key-2024',
    PORT: process.env.PORT || 3000,
    DB_PATH: process.env.DB_PATH || './gaple.db'
};
