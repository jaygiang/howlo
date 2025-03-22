import mongoose from 'mongoose';

const accomplishmentSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  taggedUser: { type: String, required: true },
  challenge: { type: String, required: true },
  eventLocation: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now },
  bingoAchieved: { type: Boolean, default: false },
  bingoTimestamp: { type: Date },
  
  // XP system fields
  xp: { type: Number, default: 100 }, // Base XP for an accomplishment
  bingoBonus: { type: Boolean, default: false }, // Tracks if bingo bonus was awarded
  blackoutBonus: { type: Boolean, default: false }, // Tracks if blackout bonus was awarded
  blackoutTimestamp: { type: Date }, // When blackout was achieved
  
  // Time period tracking for monthly leaderboards
  month: { type: Number }, // 0-11 for Jan-Dec
  year: { type: Number },
  
  // Add this new field to track reactions
  reactions: {
    kudos: [String],    // Array of user IDs who gave kudos
    amazing: [String],  // Array of user IDs who reacted with "amazing"
    greatJob: [String]  // Array of user IDs who reacted with "great job"
  }
}, { 
  timestamps: true // Add createdAt and updatedAt fields
});

// Add indexes for efficient time-based queries
accomplishmentSchema.index({ userId: 1, month: 1, year: 1 });
accomplishmentSchema.index({ month: 1, year: 1, xp: -1 });

// Check if the model already exists to prevent model overwrite errors in serverless environment
export const Accomplishment = mongoose.models.Accomplishment || mongoose.model('Accomplishment', accomplishmentSchema);
