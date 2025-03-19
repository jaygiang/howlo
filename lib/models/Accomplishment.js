import mongoose from 'mongoose';

const accomplishmentSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  taggedUser: { type: String, required: true },
  challenge: { type: String, required: true },
  eventLocation: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now },
  bingoAchieved: { type: Boolean, default: false },
  bingoTimestamp: { type: Date },
});

// Check if the model already exists to prevent model overwrite errors in serverless environment
export const Accomplishment = mongoose.models.Accomplishment || mongoose.model('Accomplishment', accomplishmentSchema);
