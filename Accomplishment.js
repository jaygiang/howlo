const mongoose = require('mongoose');

const accomplishmentSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  taggedUser: { type: String, required: true },
  challenge: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Accomplishment', accomplishmentSchema);
