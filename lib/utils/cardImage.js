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
    
    // Build the blocks - use full-width image layout for larger display
    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: isBlank ? "HOWLO Card" : `${userName}'s HOWLO Progress`,
          emoji: true
        }
      },
      {
        type: "image",
        title: {
          type: "plain_text",
          text: " ", // Empty title to prevent unnecessary space
          emoji: true
        },
        image_url: imageUrl,
        alt_text: "HOWLO Card",
        block_id: "bingo_card_image" // Adding a block_id helps with consistency
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${cardUrl}|Open Interactive Card>*`
        }
      }
    ];
    
    // Add an image-only fallback approach that displays larger
    // This uses a different block arrangement that gives the image more space
    const imageFallback = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: isBlank ? "HOWLO Card" : `${userName}'s HOWLO Progress`,
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
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `*<${cardUrl}|Open Interactive Card>*`
          }
        ]
      }
    ];
    
    // Choose which block format to use
    return imageFallback; // This layout gives the image more space
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
          text: `*View your HOWLO Card:*\n${cardUrl}`
        }
      }
    ];
  }
}
