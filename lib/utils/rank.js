import { Accomplishment } from '../models/Accomplishment.js';

/**
 * Gets a user's current rank on the leaderboard for a specific month/year
 * @param {string} userId - The user ID to get the rank for
 * @param {number} month - Month index (0-11)
 * @param {number} year - Year (e.g., 2023)
 * @returns {number|null} - The user's rank (1-based) or null if not ranked
 */
export async function getUserRank(userId, month, year) {
  try {
    // Query to get all users sorted by XP
    const leaderboard = await Accomplishment.aggregate([
      { 
        $match: { month: month, year: year } 
      },
      {
        $group: {
          _id: "$userId",
          totalXp: { $sum: "$xp" },
          accomplishmentCount: { $sum: 1 }
        }
      },
      { 
        $sort: { totalXp: -1, accomplishmentCount: -1 } 
      }
    ]);
    
    // Find the user's position in the leaderboard
    const userIndex = leaderboard.findIndex(user => user._id === userId);
    
    // Return the rank (add 1 because array indices start at 0)
    // Return null if user is not on the leaderboard
    return userIndex !== -1 ? userIndex + 1 : null;
  } catch (error) {
    console.error('Error getting user rank:', error);
    return null;
  }
}

/**
 * Gets formatted rank display string with appropriate suffix and emoji
 * @param {number|null} userRank - The numeric rank or null
 * @returns {string} - Formatted rank display string
 */
export function getFormattedRank(userRank) {
  if (!userRank) {
    return "Not ranked yet";
  }
  
  // Add appropriate suffix
  let rankSuffix;
  if (userRank % 10 === 1 && userRank % 100 !== 11) rankSuffix = "st";
  else if (userRank % 10 === 2 && userRank % 100 !== 12) rankSuffix = "nd";
  else if (userRank % 10 === 3 && userRank % 100 !== 13) rankSuffix = "rd";
  else rankSuffix = "th";
  
  // Add rank emoji based on position
  let rankEmoji = '🏆';
  if (userRank === 1) rankEmoji = '🥇';
  else if (userRank === 2) rankEmoji = '🥈';
  else if (userRank === 3) rankEmoji = '🥉';
  
  return `${rankEmoji} ${userRank}${rankSuffix} Place`;
} 