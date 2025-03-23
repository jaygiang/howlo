import { buildUrl } from './url.js';
import { bingoCard } from './bingoCard.js';
import { Accomplishment } from '../models/Accomplishment.js';
import { getSlackClient } from './slack.js';

/**
 * Generates blocks for a bingo card in Slack
 * @param {string} userId - The Slack user ID
 * @param {string} token - The authentication token
 * @param {boolean} includeImage - Whether to include the card image
 * @param {number} userRank - The user's current rank
 * @returns {Promise<Array>} - A promise that resolves to Slack blocks for the card
 */
export async function generateCardBlocks(userId, token, includeImage = true, userRank = null) {
  try {
    console.log('Generating card blocks with base URL:', process.env.APP_BASE_URL);
    
    // Get user info from Slack
    const slackClient = getSlackClient();
    const userInfo = await slackClient.users.info({ user: userId });
    const userName = userInfo.user.real_name || `<@${userId}>`;
    
    // Create the card URLs
    const cardPath = 'howlo/card';
    const cardUrl = buildUrl(process.env.APP_BASE_URL, `${cardPath}?token=${token}`);
    
    // Create the image URL - use direct rendering by default (lighter on serverless)
    const imageUrl = buildUrl(
      process.env.APP_BASE_URL, 
      `howlo/card-image?token=${token}&method=direct`
    );
    
    // Build the blocks - use full-width image layout for larger display
    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🎮 HOWLO Card",
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${userName}'s Progress*\n${bingoCard.bingo ? "🎮 *HOWLO LINE Achieved!*\n" : ""}${bingoCard.allCompleted ? "👑 *DENOUT Achieved!*\n" : ""}`
        }
      }
    ];
    
    // Add user's rank information if available
    if (userRank) {
      // Format the rank with appropriate suffix (1st, 2nd, 3rd, etc.)
      let rankSuffix;
      if (userRank % 10 === 1 && userRank % 100 !== 11) rankSuffix = "st";
      else if (userRank % 10 === 2 && userRank % 100 !== 12) rankSuffix = "nd";
      else if (userRank % 10 === 3 && userRank % 100 !== 13) rankSuffix = "rd";
      else rankSuffix = "th";
      
      // Add rank display with appropriate medal for top 3
      let rankDisplay;
      if (userRank === 1) rankDisplay = `🥇 *Current Rank: ${userRank}${rankSuffix} Place* - Leading the pack!`;
      else if (userRank === 2) rankDisplay = `🥈 *Current Rank: ${userRank}${rankSuffix} Place* - Silver status!`;
      else if (userRank === 3) rankDisplay = `🥉 *Current Rank: ${userRank}${rankSuffix} Place* - Bronze tier!`;
      else rankDisplay = `🏆 *Current Rank: ${userRank}${rankSuffix} Place*`;
      
      // Add the rank section
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: rankDisplay
        }
      });
    } else {
      // If user has no rank yet
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "🏆 *Current Rank: Not ranked yet* - Log some achievements to get on the leaderboard!"
        }
      });
    }
    
    // Add XP information if you have it
    // ... existing code for XP display ...
    
    // Add the card image if requested
    if (includeImage) {
      blocks.push({
        type: "image",
        title: {
          type: "plain_text",
          text: "Your HOWLO Card",
          emoji: true
        },
        image_url: imageUrl,
        alt_text: "HOWLO Bingo Card Progress"
      });
    }
    
    // Add an image-only fallback approach that displays larger
    // This uses a different block arrangement that gives the image more space
    const imageFallback = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🎮 HOWLO Card",
          emoji: true
        }
      },
      {
        type: "divider"
      },
      {
        type: "image",
        image_url: imageUrl,
        alt_text: "HOWLO Card"
      },
    ];
    
    // Choose which block format to use
    return imageFallback; // This layout gives the image more space
  } catch (error) {
    console.error('Error generating card blocks:', error);
    
    // Return a simple fallback message with the card link
    return [{
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Error displaying card. Please try again later."
      }
    }];
  }
}
