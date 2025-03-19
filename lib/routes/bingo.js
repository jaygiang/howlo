import express from 'express';
import { Accomplishment } from '../models/Accomplishment.js';
import { validateToken } from '../utils/token.js';
import { bingoCard } from '../utils/bingoCard.js';
import { getSlackClient } from '../utils/slack.js';

const router = express.Router();

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
    
    // Build a simple HTML table representing a 5x5 bingo card
    let html = `<html>
      <head>
        <title>${userName}</title>     
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
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
            background-color: #D3D3D3;
            border: 2px solid gray;
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
            <td style="background: none; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px;">H</td>
            <td style="background: none; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px;">O</td>
            <td style="background: none; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px;">W</td>
            <td style="background: none; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px;">L</td>
            <td style="background: none; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px;">O</td>
          </tr>
        </table>
        <table style="margin-top: 0;">`;

    for (let row = 0; row < 5; row++) {
      html += `<tr>`;
      for (let col = 0; col < 5; col++) {
        const index = row * 5 + col;
        const challenge = bingoCard[index];
        // Find the accomplishment for this challenge if it exists
        const accomplishment = userAccomplishments.find(a => a.challenge.trim() === challenge);
        let isChecked = (challenge === "FREE") || accomplishment;
        
        html += `<td class="${isChecked ? 'checked' : ''}">
                  ${isChecked ? `
                    <div class="wolf-marker">
                      <img src="/images/coyote.png" class="wolf-image" alt="Wolf">
                    </div>
                  ` : ''}
                  <div class="td-content">
                    <div>${challenge}</div>
                    ${isChecked ? `
                      <div class="check-mark">&#10004;</div>
                      ${accomplishment ? `
                        <div class="tagged-user">${accomplishment.taggedUser}</div>
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

    // Sort accomplishments by timestamp in descending order
    userAccomplishments.sort((a, b) => b.timestamp - a.timestamp);
    
    userAccomplishments.forEach(acc => {
      html += `<li>
        <div>
          <span class="accomplishment-label">Challenge:</span>
          <span class="accomplishment-value">${acc.challenge}</span>
        </div>
        <div>
          <span class="accomplishment-label">With:</span>
          <span class="accomplishment-value">${acc.taggedUser}</span>
        </div>
        ${acc.eventLocation ? `
        <div>
          <span class="accomplishment-label">Where:</span>
          <span class="accomplishment-value">${acc.eventLocation}</span>
        </div>
        ` : ''}
        <div>
          <span class="accomplishment-label">Date:</span>
          <span class="accomplishment-value">${acc.timestamp.toLocaleDateString()}</span>
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
        <title>HOWLO Bingo Card</title>     
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
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
            background-color: #D3D3D3;
            border: 2px solid gray;
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
            <td style="background: none; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px;">H</td>
            <td style="background: none; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px;">O</td>
            <td style="background: none; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px;">W</td>
            <td style="background: none; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px;">L</td>
            <td style="background: none; box-shadow: none; font-size: 100px; font-weight: bold; width: 180px;">O</td>
          </tr>
        </table>
        <table style="margin-top: 0;">`;

    for (let row = 0; row < 5; row++) {
      html += `<tr>`;
      for (let col = 0; col < 5; col++) {
        const index = row * 5 + col;
        const challenge = bingoCard[index];
        const isFree = (challenge === "FREE");
        
        html += `<td class="${isFree ? 'free-cell' : ''}">
                  <div class="td-content">
                    <div>${challenge}</div>
                    ${isFree ? `<div style="color: #2e7d32; font-size: 24px; margin: 8px 0;">✓</div>` : ''}
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

export const bingoRoutes = router;
