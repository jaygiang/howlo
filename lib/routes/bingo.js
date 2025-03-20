import express from 'express';
import { Accomplishment } from '../models/Accomplishment.js';
import { validateToken } from '../utils/token.js';
import { bingoCard } from '../utils/bingoCard.js';
import { getSlackClient } from '../utils/slack.js';
import { captureCardScreenshot } from '../utils/screenshot.js';
import { renderBingoCardImage } from '../utils/renderCard.js';

const router = express.Router();

/**
 * Get username from Slack user ID
 * Parses a Slack user ID like <@U123ABC> and returns the user's display name
 * @param {string} taggedUserText - The text containing a Slack user ID
 * @returns {Promise<string>} - A promise that resolves to the username
 */
async function getUsernameFromSlackId(taggedUserText) {
  try {
    // Check if the text is a Slack user ID format: <@U...>
    if (taggedUserText && taggedUserText.startsWith('<@') && taggedUserText.endsWith('>')) {
      // Extract the user ID
      const userId = taggedUserText.substring(2, taggedUserText.length - 1);
      
      // Get user info from Slack
      const slackClient = getSlackClient();
      const response = await slackClient.users.info({ user: userId });
      
      // Return the user's display name or real name
      return response.user.real_name || response.user.name || taggedUserText;
    }
    
    // If it's not a Slack user ID format, return the original text
    return taggedUserText;
  } catch (error) {
    console.warn(`Error getting username from Slack ID ${taggedUserText}:`, error.message);
    // Return the original text if there's an error
    return taggedUserText;
  }
}

// GET route to display a visual bingo card for a user
// Example: GET /bingo/card?token=TOKEN
router.get('/card', async (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.status(400).send("Missing token parameter.");
  }
  
  const userId = validateToken(token);
  if (!userId) {
    return res.status(401).send("Invalid or expired token.");
  }
  
  try {
    // Get user info from Slack
    const slackClient = getSlackClient();
    const userInfo = await slackClient.users.info({ user: userId });
    const userName = userInfo.user.real_name; // Get full name
    
    // Get all accomplishments for this user
    const userAccomplishments = await Accomplishment.find({ userId }).exec();
    
    // Create a 5x5 grid representation of completed challenges
    const grid = Array(5).fill().map(() => Array(5).fill(false));
    userAccomplishments.forEach(acc => {
      const index = bingoCard.indexOf(acc.challenge.trim());
      if (index !== -1) {
        const row = Math.floor(index / 5);
        const col = index % 5;
        grid[row][col] = true;
      }
    });
    // Mark FREE space as completed
    const freeIndex = bingoCard.indexOf("FREE");
    if (freeIndex !== -1) {
      grid[Math.floor(freeIndex / 5)][freeIndex % 5] = true;
    }
    
    // Sort accomplishments by timestamp in descending order
    userAccomplishments.sort((a, b) => b.timestamp - a.timestamp);

    // Process all the tagged users first to get their display names
    const processedAccomplishments = await Promise.all(userAccomplishments.map(async (acc) => {
      try {
        if (!acc) {
          console.warn('Found undefined accomplishment, skipping');
          return null;
        }
        
        // Ensure challenge exists and is a string
        const challenge = acc.challenge ? acc.challenge.toString().trim() : '';
        
        // Get tagged user display name
        const taggedUserDisplay = await getUsernameFromSlackId(acc.taggedUser || '');
        
        // Create a safer object with all properties checked
        return {
          ...acc,
          _doc: acc._doc || {}, // Ensure _doc exists
          challenge: challenge,
          taggedUser: acc.taggedUser || '',
          taggedUserDisplay: taggedUserDisplay,
          eventLocation: acc.eventLocation || '',
          timestamp: acc.timestamp || null
        };
      } catch (error) {
        console.error('Error processing accomplishment:', error);
        return null;
      }
    }).filter(acc => acc !== null)); // Filter out any null entries

    // Add debug logging
    console.log(`Processed ${processedAccomplishments.length} accomplishments out of ${userAccomplishments.length} total`);

    // Process all challenge cells to get display names for tagged users
    let processedGrid = [];

    // Print out all challenges in the bingo card
    console.log('Bingo card challenges:');
    bingoCard.forEach((challenge, index) => {
      console.log(`${index}: "${challenge.trim()}"`);
    });

    // Create a challenge lookup for quick reference
    let completedChallenges = new Set();

    // Add all completed challenges
    console.log('User completed challenges:');
    userAccomplishments.forEach(acc => {
      if (acc && acc.challenge) {
        const trimmedChallenge = acc.challenge.trim();
        completedChallenges.add(trimmedChallenge);
        console.log(`- "${trimmedChallenge}"`);
      }
    });

    // Mark the FREE space as completed
    completedChallenges.add("FREE");
    console.log('Added FREE space to completed challenges');
    console.log(`User has completed ${completedChallenges.size} challenges (including FREE)`);

    // Debug log - when looking up challenges from the grid
    for (let row = 0; row < 5; row++) {
      const processedRow = [];
      
      for (let col = 0; col < 5; col++) {
        try {
          const challenge = bingoCard[row * 5 + col];
          const trimmedChallenge = challenge ? challenge.trim() : '';
          
          // Check if this challenge is completed
          const isCompleted = completedChallenges.has(trimmedChallenge);
          
          // Log the cell completion status
          console.log(`Cell [${row},${col}]: "${trimmedChallenge}" - Completed: ${isCompleted}`);
          
          let accomplishment = null;
          let taggedUserDisplay = '';
          
          if (isCompleted && trimmedChallenge !== "FREE") {
            // Find matching accomplishment
            accomplishment = userAccomplishments.find(a => {
              if (!a || !a.challenge) return false;
              return a.challenge.toString().trim() === trimmedChallenge;
            });
            
            if (accomplishment && accomplishment.taggedUser) {
              try {
                taggedUserDisplay = await getUsernameFromSlackId(accomplishment.taggedUser);
              } catch (err) {
                console.warn(`Error getting username for ${accomplishment.taggedUser}:`, err.message);
                taggedUserDisplay = accomplishment.taggedUser || 'Unknown user';
              }
            }
          }
          
          processedRow.push({
            challenge: trimmedChallenge,
            accomplishment,
            taggedUserDisplay,
            isCompleted
          });
        } catch (error) {
          console.error(`Error processing grid cell [${row},${col}]:`, error);
          // Push a default cell if there's an error
          processedRow.push({
            challenge: 'Error loading challenge',
            accomplishment: null,
            taggedUserDisplay: '',
            isCompleted: false
          });
        }
      }
      
      processedGrid.push(processedRow);
    }

    // Build the HTML with the processed display names
    let html = `<html>
      <head>
        <title>Howlo</title>     
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
        <link rel="icon" href="https://howlo.vercel.app/images/coyote.png" type="image/png">
        <script defer src="https://cdn.vercel-insights.com/v1/script.js"></script>
        <style>
          body {
            font-family: 'Inter', sans-serif;
            background-color: #f5f5f5;
            color: #333;
            line-height: 1.6;
          }
          table { 
            border-collapse: separate; 
            border-spacing: 12px;
            margin: 40px auto;
            max-width: 1200px;
          }
          tr {
            height: 150px;
          }
          td { 
            border-radius: 12px;
            width: 180px;
            height: 200px;
            text-align: center;
            vertical-align: middle;
            padding: 15px;
            background: white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
            font-size: 14px;
            position: relative;
            overflow: hidden;
          }
          td:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
          }
          .checked { 
            background-color: rgba(231, 56, 61, 0.25);
            border: 2px solid #E7383D;
            position: relative;
          }
          .checked::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: white;
            opacity: .9;
            pointer-events: none;
            z-index: 1;
          }
          .wolf-marker {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            transition: opacity 0.3s ease;
            z-index: 2; /* Places the wolf image above the opacity overlay */
          }
          .wolf-image {
            width: 70%;
            height: 70%;
            object-fit: contain;
          }
          td:hover .wolf-marker, 
          td:active .wolf-marker {
            opacity: 0;
            pointer-events: none;
          }
          td.checked:hover::before,
          td.checked:active::before {
            opacity: 0;
          }
          @media (max-width: 768px) {
            .td-content {
              pointer-events: none;
              position: relative;
              z-index: 3; /* Places content above both wolf image and opacity overlay */
            }
            /* Add touch-specific behavior for mobile */
            td:active .wolf-marker {
              opacity: 0;
            }
            /* Make sure the tap works on mobile */
            td {
              cursor: pointer;
              -webkit-tap-highlight-color: transparent;
            }
            /* Show cell content after tap */
            td:active .td-content {
              pointer-events: auto;
            }
          }
          h1 {
            color: #000000;
            font-weight: 600;
            margin: 40px 0;
          }
          .accomplishment-list {
            margin: 40px auto;
            max-width: 800px;
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .accomplishment-list h2 {
            color: #2e7d32;
            margin-bottom: 20px;
          }
          .accomplishment-list li {
            margin-bottom: 16px;
            padding: 16px;
            border-radius: 8px;
            background: #f8f9fa;
            font-size: 20px;
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          .accomplishment-label {
            color: #666;
            font-size: 18px;
            font-weight: normal;
            display: block;
            margin-bottom: 4px;
          }
          .accomplishment-value {
            color: #333;
            font-size: 20px;
            display: block;
          }
          .check-mark {
            color: #2e7d32;
            font-size: 24px;
            margin: 8px 0;
          }
          .tagged-user {
            color: #666;
            font-size: 12px;
            margin-top: 4px;
          }
          .event-location {
            color: #6a89cc;
            font-size: 12px;
            font-style: italic;
            margin-top: 2px;
          }
          @media (max-width: 768px) {
            .accomplishment-list li {
              font-size: 22px;
            }
            .accomplishment-label {
              font-size: 20px;
            }
            .accomplishment-value {
              font-size: 22px;
            }
          }
        </style>
      </head>
      <body style="margin-top: 35px;">
        <h2 style="text-align: center;"> Hi, ${userName}!</h2>
        <table style="margin-bottom: 0; border-spacing: 12px;">
          <tr>
            <td style="background: black; color: white; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px; border-radius: 10px;">H</td>
            <td style="background: black; color: white; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px; border-radius: 10px;">O</td>
            <td style="background: black; color: white; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px; border-radius: 10px;">W</td>
            <td style="background: black; color: white; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px; border-radius: 10px;">L</td>
            <td style="background: black; color: white; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px; border-radius: 10px;">O</td>
          </tr>
        </table>
        <table style="margin-top: 20px;">`;

    for (let row = 0; row < 5; row++) {
      html += `<tr>`;
      for (let col = 0; col < 5; col++) {
        const cell = processedGrid[row][col];
        const challenge = cell.challenge;
        const accomplishment = cell.accomplishment;
        const taggedUserDisplay = cell.taggedUserDisplay;
        const isCompleted = cell.isCompleted;
        
        // Add a class for completed challenges
        const tdClass = isCompleted ? "checked" : "";
        // Special class for FREE space
        const freeClass = challenge === "FREE" ? "free-cell" : "";
        
        html += `<td class="${tdClass} ${freeClass}">
                  ${isCompleted ? `
                    <div class="wolf-marker">
                      <img src="https://howlo.vercel.app/images/coyote.png" class="wolf-image" alt="Wolf">
                    </div>
                  ` : ''}
                  <div class="td-content">
                    <div>${challenge || ''}</div>
                    ${isCompleted ? `
                      ${accomplishment ? `
                        <div class="tagged-user">${taggedUserDisplay || ''}</div>
                        ${accomplishment.eventLocation ? `<div class="event-location">${accomplishment.eventLocation}</div>` : ''}
                      ` : ''}
                    ` : ''}
                  </div>
                 </td>`;
      }
      html += `</tr>`;
    }
    html += `</table>`;

    // Add accomplishments list below the card
    html += `
      <div class="accomplishment-list">
        <h2 style="text-align: center;">Your Accomplishments</h2>
        <ol>
    `;

    // When we build the HTML with processed accomplishments, filter out any null or undefined entries
    processedAccomplishments.filter(acc => acc !== null && acc !== undefined).forEach(acc => {
      // Format the date safely, handling potential undefined timestamp
      const formattedDate = acc.timestamp ? acc.timestamp.toLocaleDateString() : 'Unknown date';
      
      html += `<li>
        <div>
          <span class="accomplishment-label">Challenge:</span>
          <span class="accomplishment-value">${acc.challenge || 'Unknown challenge'}</span>
        </div>
        <div>
          <span class="accomplishment-label">With:</span>
          <span class="accomplishment-value">${acc.taggedUserDisplay || 'Unknown user'}</span>
        </div>
        ${acc.eventLocation ? `
        <div>
          <span class="accomplishment-label">Where:</span>
          <span class="accomplishment-value">${acc.eventLocation}</span>
        </div>
        ` : ''}
        <div>
          <span class="accomplishment-label">Date:</span>
          <span class="accomplishment-value">${formattedDate}</span>
        </div>
      </li>`;
    });

    html += `
        </ol>
      </div>
    </body></html>`;
    
    res.send(html);
  } catch (err) {
    console.error('Error generating bingo card:', err);
    res.status(500).send("Error generating bingo card.");
  }
});

// GET route to display just a blank bingo card with challenges (no accomplishments)
// Example: GET /bingo/blank-card?token=TOKEN
router.get('/blank-card', async (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.status(400).send("Missing token parameter.");
  }
  
  const userId = validateToken(token);
  if (!userId) {
    return res.status(401).send("Invalid or expired token.");
  }
  
  try {
    // Get user info from Slack
    const slackClient = getSlackClient();
    const userInfo = await slackClient.users.info({ user: userId });
    const userName = userInfo.user.real_name; // Get full name
    
    // Build a simple HTML table representing a 5x5 bingo card (blank)
    let html = `<html>
      <head>
        <title>Howlo</title>     
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
        <link rel="icon" href="https://howlo.vercel.app/images/coyote.png" type="image/png">
        <script defer src="https://cdn.vercel-insights.com/v1/script.js"></script>
        <style>
          body {
            font-family: 'Inter', sans-serif;
            background-color: #f5f5f5;
            color: #333;
            line-height: 1.6;
          }
          table { 
            border-collapse: separate; 
            border-spacing: 12px;
            margin: 40px auto;
            max-width: 1200px;
          }
          tr {
            height: 150px;
          }
          td { 
            border-radius: 12px;
            width: 180px;
            height: 200px;
            text-align: center;
            vertical-align: middle;
            padding: 15px;
            background: white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
            font-size: 14px;
            position: relative;
            overflow: hidden;
          }
          td:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
          }
          .free-cell {
            background-color: rgba(231, 56, 61, 0.25);
            border: 2px solid #E7383D;
            position: relative;
          }
          @media (max-width: 768px) {
            .td-content {
              position: relative;
              z-index: 3;
            }
            td {
              cursor: pointer;
              -webkit-tap-highlight-color: transparent;
            }
          }
          h1 {
            color: #000000;
            font-weight: 600;
            margin: 40px 0;
          }
        </style>
      </head>
      <body style="margin-top: 35px;">
        <h2 style="text-align: center;">HOWLO Bingo Challenge</h2>
        <table style="margin-bottom: 0; border-spacing: 12px;">
          <tr>
            <td style="background: black; color: white; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px; border-radius: 10px;">H</td>
            <td style="background: black; color: white; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px; border-radius: 10px;">O</td>
            <td style="background: black; color: white; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px; border-radius: 10px;">W</td>
            <td style="background: black; color: white; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px; border-radius: 10px;">L</td>
            <td style="background: black; color: white; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px; border-radius: 10px;">O</td>
          </tr>
        </table>
        <table style="margin-top: 20px;">`;

    for (let row = 0; row < 5; row++) {
      html += `<tr>`;
      for (let col = 0; col < 5; col++) {
        const index = row * 5 + col;
        const challenge = bingoCard[index];
        const isFree = (challenge === "FREE");
        
        html += `<td class="${isFree ? 'free-cell' : ''}">
                  <div class="td-content">
                    <div>${challenge}</div>
                  </div>
                 </td>`;
      }
      html += `</tr>`;
    }
    html += `</table>
    </body></html>`;
    
    res.send(html);
  } catch (err) {
    console.error('Error generating blank bingo card:', err);
    res.status(500).send("Error generating blank bingo card.");
  }
});

// GET route to serve a screenshot of the bingo card
// Example: GET /bingo/card-image?token=TOKEN&blank=false
router.get('/card-image', async (req, res) => {
  const token = req.query.token;
  const isBlank = req.query.blank === 'true';
  const renderMethod = req.query.method || 'direct'; // 'screenshot' or 'direct'
  
  if (!token) {
    return res.status(400).send("Missing token parameter.");
  }
  
  const userId = validateToken(token);
  if (!userId) {
    return res.status(401).send("Invalid or expired token.");
  }
  
  try {
    let imageBuffer;
    
    // Choose rendering method
    if (renderMethod === 'screenshot') {
      // Use Puppeteer to capture a screenshot
      imageBuffer = await captureCardScreenshot(userId, token, isBlank);
    } else {
      // Use direct rendering with Sharp
      imageBuffer = await renderBingoCardImage(userId, isBlank);
    }
    
    // Set appropriate headers
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
    
    // Send the image buffer
    res.status(200).send(imageBuffer);
  } catch (error) {
    console.error('Error generating card image:', error);
    res.status(500).send("Error generating card image.");
  }
});

export const bingoRoutes = router;
