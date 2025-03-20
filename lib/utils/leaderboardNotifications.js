import { Accomplishment } from '../models/Accomplishment.js';
import { getSlackClient } from './slack.js';
import { isBeforeLaunch, isInBetaPeriod } from './monthlyTransition.js';

// Class to handle leaderboard state and changes
class LeaderboardTracker {
  constructor() {
    // Store last known leaderboard state
    this.lastLeaderboardState = null;
    this.currentMonth = new Date().getMonth();
    this.currentYear = new Date().getFullYear();
  }
  
  // Check for leaderboard changes after new accomplishment
  async checkForChanges() {
    // Check if we're before the beta launch
    if (isBeforeLaunch()) {
      return null; // Don't track changes before launch
    }
    
    // Get current top users
    const currentLeaderboard = await this.getCurrentLeaderboard();
    
    // If no previous state, just store current state
    if (!this.lastLeaderboardState) {
      this.lastLeaderboardState = currentLeaderboard;
      return null;
    }
    
    // Check if the #1 position has changed
    if (currentLeaderboard.length > 0 && 
        this.lastLeaderboardState.length > 0 &&
        currentLeaderboard[0]._id !== this.lastLeaderboardState[0]._id) {
      
      // We have a new leader!
      const changeInfo = {
        newLeader: currentLeaderboard[0],
        previousLeader: this.lastLeaderboardState[0],
        isNewLeader: true
      };
      
      // Update stored state
      this.lastLeaderboardState = currentLeaderboard;
      
      return changeInfo;
    }
    
    // Check for other position changes in top 3
    const positionChanges = [];
    for (let i = 0; i < Math.min(3, currentLeaderboard.length); i++) {
      const currentUser = currentLeaderboard[i];
      
      // Find where this user was in the previous leaderboard
      const previousIndex = this.lastLeaderboardState.findIndex(u => u._id === currentUser._id);
      
      // If they moved up in rank (excluding new #1 which we already handled)
      if (previousIndex > i && i > 0) {
        positionChanges.push({
          user: currentUser,
          newPosition: i + 1,
          previousPosition: previousIndex + 1,
          isNewLeader: false
        });
      }
    }
    
    // Update stored state
    this.lastLeaderboardState = currentLeaderboard;
    
    return positionChanges.length > 0 ? positionChanges : null;
  }
  
  // Get current leaderboard data
  async getCurrentLeaderboard() {
    // Get current month/year
    const now = new Date();
    const isNewMonth = (now.getMonth() !== this.currentMonth || now.getFullYear() !== this.currentYear);
    
    if (isNewMonth) {
      // Month changed, reset tracker
      this.currentMonth = now.getMonth();
      this.currentYear = now.getFullYear();
      this.lastLeaderboardState = null;
    }
    
    // Special handling for beta period
    if (isInBetaPeriod()) {
      return await this.getBetaLeaderboard();
    }
    
    // Regular monthly leaderboard
    return await Accomplishment.aggregate([
      { 
        $match: { month: this.currentMonth, year: this.currentYear } 
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
      },
      {
        $limit: 5 // Track top 5 positions
      }
    ]);
  }
  
  // Get beta period leaderboard data (Mar 24-Apr 30)
  async getBetaLeaderboard() {
    return await Accomplishment.aggregate([
      { 
        $match: { 
          $or: [
            // March 24-31, 2025
            { year: 2025, month: 2, createdAt: { $gte: new Date(2025, 2, 24) } },
            // All of April 2025
            { year: 2025, month: 3 }
          ]
        } 
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
      },
      {
        $limit: 5 // Track top 5 positions
      }
    ]);
  }
}

// Create a singleton instance
const leaderboardTracker = new LeaderboardTracker();

// Function to announce new leader
export async function announceLeaderChange(changeInfo) {
  if (!changeInfo) return;
  
  // Skip if we're before launch
  if (isBeforeLaunch()) return;
  
  const slackClient = getSlackClient();
  const announcementsChannel = process.env.ANNOUNCEMENTS_CHANNEL_ID;
  
  // Handle new #1 leader
  if (changeInfo.isNewLeader) {
    const newLeaderInfo = await slackClient.users.info({ user: changeInfo.newLeader._id });
    const previousLeaderInfo = await slackClient.users.info({ user: changeInfo.previousLeader._id });
    
    const newLeaderName = newLeaderInfo?.user?.real_name || `<@${changeInfo.newLeader._id}>`;
    const previousLeaderName = previousLeaderInfo?.user?.real_name || `<@${changeInfo.previousLeader._id}>`;
    
    // Create an exciting message
    const message = {
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "👑 NEW LEADERBOARD CHAMPION! 👑",
            emoji: true
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${newLeaderName}* has taken the #1 spot with *${changeInfo.newLeader.totalXp} XP*!`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `They've overtaken ${previousLeaderName} in an exciting turn of events! The competition is heating up!`
          }
        }
      ]
    };
    
    // Add period-specific message
    if (isInBetaPeriod()) {
      message.blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "We're in the launch period! The leaderboard runs from March 24 to April 30. Check your standing with `/howlo leaderboard`"
          }
        ]
      });
    } else {
      message.blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "View the full monthly leaderboard with `/howlo leaderboard`"
          }
        ]
      });
    }
    
    // Send to channel
    await slackClient.chat.postMessage({
      channel: announcementsChannel,
      text: `${newLeaderName} has taken the #1 spot on the HOWLO leaderboard!`,
      blocks: message.blocks
    });
  } 
  // Handle other position changes
  else if (Array.isArray(changeInfo) && changeInfo.length > 0) {
    // This is optional and can be implemented for more detailed notifications
    // We'll skip this for now to avoid too many notifications
  }
}

// Export functions and tracker for use in achievement recording flow
export {
  leaderboardTracker
};