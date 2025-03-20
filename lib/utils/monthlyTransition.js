import { Accomplishment } from '../models/Accomplishment.js';
import { getSlackClient } from './slack.js';

// System constants
const BETA_START_DATE = new Date(2025, 2, 24); // March 24, 2025
const FIRST_RESET_DATE = new Date(2025, 4, 1); // May 1, 2025

// Enable testing mode - set to true to bypass date checks for testing
export const TESTING_MODE = true;

// Month names for display
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", 
                     "July", "August", "September", "October", "November", "December"];

// Check if a date is before the beta launch
export function isBeforeLaunch(date = new Date()) {
  // In testing mode, always return false (meaning we're past the launch date)
  if (TESTING_MODE) return false;
  return date < BETA_START_DATE;
}

// Check if a date is in the beta period
export function isInBetaPeriod(date = new Date()) {
  // In testing mode, always return true (meaning we're in the beta period)
  if (TESTING_MODE) return true;
  return date >= BETA_START_DATE && date < FIRST_RESET_DATE;
}

// Check for month transition and announce winners
export async function checkMonthTransition() {
  const now = new Date();
  const slackClient = getSlackClient();
  const announcementsChannel = process.env.ANNOUNCEMENTS_CHANNEL_ID;
  
  // Skip transition handling if we're before the launch date
  if (isBeforeLaunch(now)) {
    console.log("Skipping month transition - before beta launch date");
    return;
  }
  
  // Special handling for the day of the beta launch
  if (now.getDate() === BETA_START_DATE.getDate() && 
      now.getMonth() === BETA_START_DATE.getMonth() && 
      now.getFullYear() === BETA_START_DATE.getFullYear()) {
    
    // Check if we've already sent a launch announcement
    const launchAnnouncement = await getLaunchAnnouncement();
    
    if (!launchAnnouncement) {
      // Send beta launch announcement if we haven't already
      await sendLaunchAnnouncement(slackClient, announcementsChannel);
      await storeLaunchAnnouncement();
      return;
    }
  }
  
  // Special handling for the first monthly reset (May 1, 2025)
  if (now.getDate() === FIRST_RESET_DATE.getDate() && 
      now.getMonth() === FIRST_RESET_DATE.getMonth() && 
      now.getFullYear() === FIRST_RESET_DATE.getFullYear()) {
    
    // Check if we've already announced beta period winners
    const betaAnnouncement = await getBetaWinnersAnnouncement();
    
    if (!betaAnnouncement) {
      // Get beta period winners (Mar 24 - Apr 30)
      const betaWinners = await getBetaPeriodWinners();
      
      if (betaWinners.length > 0) {
        // Announce beta period winners
        await announceBetaWinners(slackClient, announcementsChannel, betaWinners);
        await storeBetaWinnersAnnouncement();
      }
      
      return;
    }
  }
  
  // For regular months after beta (From June 1, 2025 onward)
  if (now >= new Date(2025, 5, 1)) { // June 1, 2025 or later
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // Check if it's the first day of the month
    if (now.getDate() === 1) {
      // Get the previous month and year
      let prevMonth = currentMonth - 1;
      let prevYear = currentYear;
      if (prevMonth < 0) {
        prevMonth = 11; // December
        prevYear--;
      }
      
      // Check if we've already announced winners for the previous month
      const lastAnnouncement = await getLastMonthAnnouncement(prevMonth, prevYear);
      
      // If we haven't announced the previous month's winners yet
      if (!lastAnnouncement) {
        // Get leaderboard for previous month
        const winners = await getMonthWinners(prevMonth, prevYear);
        
        if (winners.length > 0) {
          // Announce winners
          await announceMonthWinners(slackClient, announcementsChannel, winners, prevMonth, prevYear);
          
          // Store that we've announced this month
          await storeMonthAnnouncement(prevMonth, prevYear);
        }
      }
    }
  }
}

// Send beta launch announcement
async function sendLaunchAnnouncement(slackClient, channel) {
  const message = `*🚀 HOWLO XP System is Now Live! 🚀*\n\n
The HOWLO XP system has officially launched! From March 24 to April 30, 2025:
• Earn 100 XP for each achievement you record
• Get 500 XP bonus for completing a bingo
• Unlock 1000 XP bonus for completing all challenges

This extended launch period will run until April 30, with the first monthly reset on May 1.

Good luck and have fun competing! Check the current standings with \`/howlo leaderboard\``;

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: message
      }
    }
  ];
  
  try {
    if (channel) {
      await slackClient.chat.postMessage({
        channel: channel,
        text: "HOWLO XP System is Now Live!",
        blocks: blocks
      });
    } else {
      console.warn('No announcements channel set for launch announcement');
    }
  } catch (postError) {
    console.error('Error posting launch announcement to channel:', postError);
    // No fallback for this system-wide announcement if channel is invalid
  }
}

// Get winners for the beta period
async function getBetaPeriodWinners() {
  const winners = await Accomplishment.aggregate([
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
        accomplishmentCount: { $sum: 1 },
        hasBingo: { 
          $max: { $cond: [{ $eq: ["$bingoBonus", true] }, 1, 0] }
        },
        hasBlackout: { 
          $max: { $cond: [{ $eq: ["$blackoutBonus", true] }, 1, 0] }
        }
      }
    },
    { 
      $sort: { totalXp: -1, accomplishmentCount: -1 } 
    },
    { 
      $limit: 3 // Top 3 winners
    }
  ]);
  
  return winners;
}

// Announce beta period winners
async function announceBetaWinners(slackClient, channel, winners) {
  // Format announcement message
  let message = `*🏆 HOWLO Launch Period Results - March 24 to April 30, 2025 🏆*\n\n`;
  
  // Add winners to message
  for (let i = 0; i < winners.length; i++) {
    const userInfo = await slackClient.users.info({ user: winners[i]._id });
    const userName = userInfo?.user?.real_name || `<@${winners[i]._id}>`;
    
    let trophy = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
    message += `${trophy} *${userName}* - ${winners[i].totalXp} XP\n`;
  }
  
  // Add monthly reset message
  message += `\n*The first monthly competition has started!* The May 2025 leaderboard is now active.\n`;
  message += `All XP counters have been reset for the new month, but your achievements are preserved in the records!`;
  
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: message
      }
    }
  ];
  
  // Try to send to announcement channel
  try {
    if (channel) {
      await slackClient.chat.postMessage({
        channel: channel,
        text: "HOWLO Launch Period Winners Announced!",
        blocks: blocks
      });
    } else {
      console.warn('No announcements channel set for beta winners announcement');
    }
  } catch (postError) {
    console.error('Error posting beta winners announcement to channel:', postError);
    
    // Send individual DMs to winners as fallback
    for (let i = 0; i < winners.length; i++) {
      try {
        const trophy = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
        const position = i === 0 ? "1st" : i === 1 ? "2nd" : "3rd";
        
        // Open DM with winner
        const dmResponse = await slackClient.conversations.open({
          users: winners[i]._id
        });
        
        // Send personalized message
        await slackClient.chat.postMessage({
          channel: dmResponse.channel.id,
          text: `Congratulations! You placed ${position} in the HOWLO Launch Period!`,
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: `${trophy} Congratulations on Your Achievement! ${trophy}`,
                emoji: true
              }
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `You placed *${position}* in the HOWLO Launch Period with *${winners[i].totalXp} XP*!\n\n*The first monthly competition has started!* The May 2025 leaderboard is now active. All XP counters have been reset for the new month.`
              }
            }
          ]
        });
      } catch (dmError) {
        console.error(`Failed to DM winner ${winners[i]._id}:`, dmError);
      }
    }
  }
}

// Get winners for a regular month
async function getMonthWinners(month, year) {
  const winners = await Accomplishment.aggregate([
    { 
      $match: { month: month, year: year } 
    },
    {
      $group: {
        _id: "$userId",
        totalXp: { $sum: "$xp" },
        accomplishmentCount: { $sum: 1 },
        hasBingo: { 
          $max: { $cond: [{ $eq: ["$bingoBonus", true] }, 1, 0] }
        },
        hasBlackout: { 
          $max: { $cond: [{ $eq: ["$blackoutBonus", true] }, 1, 0] }
        }
      }
    },
    { 
      $sort: { totalXp: -1, accomplishmentCount: -1 } 
    },
    { 
      $limit: 3 // Top 3 winners
    }
  ]);
  
  return winners;
}

// Announce regular month winners
async function announceMonthWinners(slackClient, channel, winners, month, year) {
  // Format announcement message
  let message = `*🏆 HOWLO Leaderboard - ${MONTH_NAMES[month]} ${year} FINAL RESULTS 🏆*\n\n`;
  
  // Add winners to message
  for (let i = 0; i < winners.length; i++) {
    const userInfo = await slackClient.users.info({ user: winners[i]._id });
    const userName = userInfo?.user?.real_name || `<@${winners[i]._id}>`;
    
    let trophy = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
    message += `${trophy} *${userName}* - ${winners[i].totalXp} XP\n`;
  }
  
  // Add new month message
  const newMonthName = MONTH_NAMES[month + 1 > 11 ? 0 : month + 1];
  const newYear = month === 11 ? year + 1 : year;
  message += `\n*A new month has begun! The ${newMonthName} ${newYear} leaderboard is now active.*\n`;
  message += `All XP counters have been reset for the new month, but your achievements are preserved in the records!`;
  
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: message
      }
    }
  ];
  
  // Try to send to announcement channel
  try {
    if (channel) {
      await slackClient.chat.postMessage({
        channel: channel,
        text: `HOWLO ${MONTH_NAMES[month]} Winners Announced!`,
        blocks: blocks
      });
    } else {
      console.warn(`No announcements channel set for ${MONTH_NAMES[month]} ${year} winners announcement`);
    }
  } catch (postError) {
    console.error(`Error posting ${MONTH_NAMES[month]} ${year} winners announcement to channel:`, postError);
    
    // Send individual DMs to winners as fallback
    for (let i = 0; i < winners.length; i++) {
      try {
        const trophy = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
        const position = i === 0 ? "1st" : i === 1 ? "2nd" : "3rd";
        
        // Open DM with winner
        const dmResponse = await slackClient.conversations.open({
          users: winners[i]._id
        });
        
        // Send personalized message
        await slackClient.chat.postMessage({
          channel: dmResponse.channel.id,
          text: `Congratulations! You placed ${position} in the HOWLO ${MONTH_NAMES[month]} ${year} competition!`,
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: `${trophy} Congratulations on Your Achievement! ${trophy}`,
                emoji: true
              }
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `You placed *${position}* in the HOWLO ${MONTH_NAMES[month]} ${year} competition with *${winners[i].totalXp} XP*!\n\n*A new month has begun!* The ${newMonthName} ${newYear} leaderboard is now active. All XP counters have been reset for the new month.`
              }
            }
          ]
        });
      } catch (dmError) {
        console.error(`Failed to DM winner ${winners[i]._id}:`, dmError);
      }
    }
  }
}

// Supporting functions for storing announcement state
// In a real implementation, these would use a database
// For now, we'll use placeholder implementations

// Create or get a model to store announcement state
async function getLaunchAnnouncement() {
  try {
    // This would check a database collection for a launch announcement record
    // For now, just return null to always send announcements in development
    return null;
  } catch (error) {
    console.error('Error getting launch announcement:', error);
    return null;
  }
}

async function storeLaunchAnnouncement() {
  try {
    // This would store a record in the database that we've sent the launch announcement
    console.log('Launch announcement sent and recorded');
    return true;
  } catch (error) {
    console.error('Error storing launch announcement:', error);
    return false;
  }
}

async function getBetaWinnersAnnouncement() {
  try {
    // This would check a database collection for a beta winners announcement record
    return null;
  } catch (error) {
    console.error('Error getting beta winners announcement:', error);
    return null;
  }
}

async function storeBetaWinnersAnnouncement() {
  try {
    // This would store a record in the database that we've sent the beta winners announcement
    console.log('Beta winners announcement sent and recorded');
    return true;
  } catch (error) {
    console.error('Error storing beta winners announcement:', error);
    return false;
  }
}

async function getLastMonthAnnouncement(month, year) {
  try {
    // This would check a database collection for a monthly announcement record
    return null;
  } catch (error) {
    console.error('Error getting monthly announcement:', error);
    return null;
  }
}

async function storeMonthAnnouncement(month, year) {
  try {
    // This would store a record in the database that we've sent a monthly announcement
    console.log(`${MONTH_NAMES[month]} ${year} winners announcement sent and recorded`);
    return true;
  } catch (error) {
    console.error('Error storing monthly announcement:', error);
    return false;
  }
}