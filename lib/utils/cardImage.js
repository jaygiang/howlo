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
    
    // Check if we're running in development with ngrok
    const isNgrok = process.env.APP_BASE_URL && process.env.APP_BASE_URL.includes('ngrok');
    if (isNgrok) {
      console.log('Detected ngrok URL, using simplified blocks');
    }
    // Get user info from Slack
    const slackClient = getSlackClient();
    const userInfo = await slackClient.users.info({ user: userId });
    const userName = userInfo.user.real_name || userInfo.user.name;
    
    // Create the card URL
    const cardPath = isBlank ? 'howlo/blank-card' : 'howlo/card';
    const cardUrl = buildUrl(process.env.APP_BASE_URL, `${cardPath}?token=${token}`);
    
    // Use the bingo card image instead of the coyote
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: isBlank ? "*HOWLO Bingo Card*" : `*${userName}'s HOWLO Progress*`
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*View your interactive HOWLO Bingo Card:*\n${cardUrl}`
        }
      }
    ];
    
    // Always add the image block with a reliable public URL
    try {
      // Use a reliable, publicly accessible image URL
      const imageUrl = "https://howlo.vercel.app/images/bingo-card.png";
      console.log('Adding image block with URL:', imageUrl);
      
      blocks.splice(1, 0, {
        type: "image",
        title: {
          type: "plain_text",
          text: "HOWLO Bingo",
          emoji: true
        },
        image_url: imageUrl,
        alt_text: "HOWLO Bingo Card"
      });
    } catch (error) {
      console.error('Error adding image block:', error);
      // Continue without the image if there's an error
    }
    
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
