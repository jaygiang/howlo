const mongoose = require('mongoose');

const accomplishmentSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  taggedUser: { type: String, required: true },
  challenge: { type: String, required: true },
  eventLocation: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now },
  bingoAchieved: { type: Boolean, default: false },
  bingoTimestamp: { type: Date },
});

module.exports = mongoose.model('Accomplishment', accomplishmentSchema);
