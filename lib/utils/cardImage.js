import { buildUrl } from './url.js';
import { bingoCard } from './bingoCard.js';
import { Accomplishment } from '../models/Accomplishment.js';
import { getSlackClient } from './slack.js';

/**
 * Generates blocks for a bingo card in Slack
 * @param {string} userId - The Slack user ID
 * @param {string} token - The authentication token
 * @param {boolean} isBlank - Whether to generate a blank card or the user's progress card
 * @returns {Promise<Array>} - A promise that resolves to Slack blocks for the card
 */
export async function generateCardBlocks(userId, token, isBlank = false) {
  try {
    console.log('Generating card blocks with base URL:', process.env.APP_BASE_URL);
    
    // Get user info from Slack
    const slackClient = getSlackClient();
    const userInfo = await slackClient.users.info({ user: userId });
    const userName = userInfo.user.real_name || userInfo.user.name;
    
    // Create the card URLs
    const cardPath = isBlank ? 'howlo/blank-card' : 'howlo/card';
    const cardUrl = buildUrl(process.env.APP_BASE_URL, `${cardPath}?token=${token}`);
    
    // Create the image URL - use direct rendering by default (lighter on serverless)
    const imageUrl = buildUrl(
      process.env.APP_BASE_URL, 
      `howlo/card-image?token=${token}&blank=${isBlank}&method=direct`
    );
    
    // Build the blocks with the dynamic image
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: isBlank ? "*HOWLO Bingo Card*" : `*${userName}'s HOWLO Progress*`
        }
      },
      {
        type: "image",
        title: {
          type: "plain_text",
          text: isBlank ? "HOWLO Bingo Card" : `${userName}'s Progress`,
          emoji: true
        },
        image_url: imageUrl,
        alt_text: "HOWLO Bingo Card"
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Interactive Card:*\n${cardUrl}`
        }
      }
    ];
    
    return blocks;
  } catch (error) {
    console.error('Error generating card blocks:', error);
    
    // Return a simple fallback message with the card link
    const cardPath = isBlank ? 'howlo/blank-card' : 'howlo/card';
    const cardUrl = buildUrl(process.env.APP_BASE_URL, `${cardPath}?token=${token}`);
    
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*View your HOWLO Bingo Card:*\n${cardUrl}`
        }
      }
    ];
  }
}
