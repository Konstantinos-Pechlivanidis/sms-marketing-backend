const bcrypt = require('bcrypt');
const hashPassword = (plain) => bcrypt.hash(plain, 12);
const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);
module.exports = { hashPassword, verifyPassword };
