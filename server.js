require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { WebClient } = require('@slack/web-api');
const mongoose = require('mongoose');
const crypto = require('crypto');

// Connect to MongoDB using the connection string in your environment variable
const mongoURI = process.env.MONGODB_URI;
mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
  socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Handle MongoDB connection errors
mongoose.connection.on('error', err => {
  console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('reconnected', () => {
  console.log('MongoDB reconnected');
});

// Import the Accomplishment model (ensure you have defined this in Accomplishment.js)
const Accomplishment = require('./Accomplishment');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public')); // Serve static files from public directory

// Function to generate a secure token
function generateToken(userId) {
  const timestamp = Date.now();
  const data = `${userId}-${timestamp}-${process.env.SECRET_KEY}`;
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  return `${userId}.${timestamp}.${hash}`;
}

// Function to validate token
function validateToken(token) {
  const [userId, timestamp, hash] = token.split('.');
  
  // Check if token is expired (1 hour)
  if (Date.now() - parseInt(timestamp) > 3600000) {
    return null;
  }
  
  // Verify hash
  const data = `${userId}-${timestamp}-${process.env.SECRET_KEY}`;
  const expectedHash = crypto.createHash('sha256').update(data).digest('hex');
  
  return hash === expectedHash ? userId : null;
}

// Initialize Slack Web API with your OAuth token
const slackToken = process.env.SLACK_BOT_TOKEN;
const slackClient = new WebClient(slackToken);

// Define a fixed bingo card layout (25 items, center is "FREE")
const bingoCard = [
  "<strong>Find someone who's new to San Diego</strong> (Bonus: Ask what brought them here!)",
  "<strong>Introduce yourself to someone outside your industry</strong>",
  "<strong>Meet someone who works remotely</strong> (Bonus: Ask about their favorite workspace!)",
  "<strong>Find someone looking for a co-founder or collaborator</strong> (Bonus: Ask about their dream project!)",
  "<strong>Meet someone who's attended 3+ networking events this month</strong> (They're a super-connector!)",
  "<strong>Find someone who moved here for a job or startup</strong> (What's their story?)",
  "<strong>Thank the event organizer</strong> (Do it in person or via social media)",
  "<strong>Post a photo with the event organizer thanking them</strong> (Bonus: Tag them and The Social Coyote!)",
  "<strong>Make 2 intros between people who haven't met before</strong> (Be the connection hero!)",
  "<strong>Snap a photo with someone you just met</strong> (Bonus: Post it on LinkedIn or Slack)",
  "<strong>Ask someone what their biggest 2025 goal is</strong> (Listen, then offer support!)",
  "<strong>Share a favorite local coffee shop or co-working spot with someone</strong>",
  "FREE", // Center spot is always marked as done
  "<strong>Ask someone about the best event they've attended this year</strong> (Why was it great?)",
  "<strong>Go to an event you haven't been to before</strong>",
  "<strong>Go to an event in a new part of town you haven't explored</strong>",
  "<strong>Ask someone for their best networking tip</strong> (Write it down and share later!)",
  "<strong>Find someone who has launched a startup</strong> (Bonus: Ask what stage they're at)",
  "<strong>Find someone who has raised funding for their business</strong> (Bonus: Ask about their biggest lesson)",
  "<strong>Find someone who bootstrapped their business</strong> (Bonus: Ask about a key challenge they overcame)",
  "<strong>Schedule a follow-up meeting with someone you met</strong> (Coffee, Zoom, or a walk!)",
  "<strong>Find another Social Coyote in the wild</strong> (Meet another event regular!)",
  "<strong>Howl or say \"Ahwoo!\" at another Social Coyote</strong> (Bonus: Get them to howl back!)",
  "<strong>Wildcard: Come up with your own networking challenge and complete it!</strong>",
  "<strong>Attend 3 events</strong> (Track your progress and keep the streak alive!)"
];

app.get('/', (req, res) => {
  res.send('Server is running!');
});

// GET route to display a visual bingo card for a user
// Example: GET /bingo/card?user=U12345678
app.get('/bingo/card', async (req, res) => {
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
app.get('/bingo/blank-card', async (req, res) => {
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

// Slash command endpoint for /bingo
app.post('/slack/commands', async (req, res) => {
  const { user_id, text, channel_id, trigger_id } = req.body;
  const trimmedText = text.trim();

  // Handle progress, leaderboard, or card commands
  if (trimmedText.toLowerCase() === 'leaderboard') {
    try {
      // Get all accomplishments with bingos
      const bingoWinners = await Accomplishment.aggregate([
        { $match: { bingoAchieved: true } },
        { 
          $group: {
            _id: { 
              userId: "$userId",
              month: { $month: "$bingoTimestamp" },
              year: { $year: "$bingoTimestamp" }
            },
            firstBingoDate: { $min: "$bingoTimestamp" }
          }
        },
        { $sort: { "firstBingoDate": -1 } },
        { $limit: 10 }
      ]);

      if (bingoWinners.length === 0) {
        await slackClient.chat.postEphemeral({
          channel: channel_id,
          user: user_id,
          text: "No bingos achieved yet! Be the first to complete a line! 🎯"
        });
        return res.status(200).send();
      }

      // Get user info for all winners
      const userPromises = bingoWinners.map(winner => 
        slackClient.users.info({ user: winner._id.userId })
      );
      const userInfos = await Promise.all(userPromises);

      let message = "*🏆 Bingo Leaderboard 🏆*\n\n";
      bingoWinners.forEach((winner, index) => {
        const userInfo = userInfos[index].user;
        const date = new Date(winner.firstBingoDate);
        message += `${index + 1}. <@${winner._id.userId}> (${date.toLocaleDateString()} - ${date.toLocaleString('default', { month: 'long' })} ${date.getFullYear()})\n`;
      });

      await slackClient.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: message
      });
      return res.status(200).send();
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      return res.status(500).send('Error fetching leaderboard');
    }
  } else if (trimmedText.toLowerCase() === 'progress') {
    const token = generateToken(user_id);
    const cardUrl = `${process.env.APP_BASE_URL || 'https://your-app.herokuapp.com'}/bingo/card?token=${token}`;
    try {
      await slackClient.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: `View your Bingo Card here: ${cardUrl}`,
      });
      return res.status(200).send();
    } catch (error) {
      console.error('Error posting progress message:', error);
      return res.status(500).send('Error posting progress message');
    }
  } else if (trimmedText.toLowerCase() === 'card') {
    // New 'card' command that shows just the link to view the blank bingo card
    const token = generateToken(user_id);
    const cardUrl = `${process.env.APP_BASE_URL || 'https://your-app.herokuapp.com'}/bingo/blank-card?token=${token}`;
    try {
      await slackClient.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: `${cardUrl}`,
      });
      return res.status(200).send();
    } catch (error) {
      console.error('Error posting card link:', error);
      return res.status(500).send('Error posting card link');
    }
  } else if (trimmedText.toLowerCase() === 'rules') {
    // New 'rules' command that displays the game rules in markdown format
    try {
      const rulesMarkdown = `

      *How to Play HOWLO*
      
      Hey Social Coyotes! 🤝🐺
      We're launching *HOWLO BINGO*—a fun way to meet new pack members at San Diego tech events!
      
      *🎮 How to Play:*
        • Type \`/howlo\` in @howlo channel to record your first challenge and get started  
        • Use \`/howlo rules\` to review commands and game details  
        • Log a challenge with \`/howlo\`  
        • See the blank howlo card with with \`/howlo card\` 
        • Check your progress with \`/howlo progress\`  
        • View the leaderboard with \`/howlo leaderboard\`  
      
      *🏆 Challenges:*
      Each challenge asks you to connect with someone new in a meaningful way:
        - "Share a personal story"
        - "Find someone with a shared hobby"
        - "Schedule a follow-up coffee chat" ☕
      
      *✅ Logging a Challenge:*
        1. Type \`/howlo\` in this Slack channel  
        2. Select your completed challenge  
        3. Tag the person you connected with (they may not be pinged)  
        4. Input the event location  
      
      *📊 Viewing Your HOWLO Board:*
        - Use \`/howlo progress\`  
        - Click the link provided to see your current card  
      
      *🎯 Getting a BINGO:*
      You know how BINGO works, right? If not:
        - Complete a row of 5, a column of 5, or a diagonal of 5
        - Let out a victory HOWL! 🐺  
      
      *🏅 Get Competitive!*
        - Use \`/howlo leaderboard\` to see the top coyotes 🏆  
      
      *🔕 Too Many Notifications?*
        - Right-click on this channel > *"Change notifications"*
        - Select *"Only @mentions and keywords"*
        - Or mute it completely with **"Nothing"*
      
      *🖨️ Analog Option:*
      - Print your HOWLO card and bring it to events!  
      - Nothing says "I'm here to connect!" like pulling out a physical bingo card and asking someone to initial a square. The confused looks are half the fun! 🤣 
      
      ---
      
      So what are you waiting for? The pack that plays together, stays together!  
      Let's make some noise and build our community one HOWL YEAH at a time! 🐺  
      
      Share all feedback, ideas, notes, and growls with @jonah and @Jay
      `;
      
      
      await slackClient.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: rulesMarkdown,
        mrkdwn: true
      });
      return res.status(200).send();
    } catch (error) {
      console.error('Error posting rules:', error);
      return res.status(500).send('Error posting rules');
    }
  }

  // Open modal for new accomplishment
  try {
    await slackClient.views.open({
      trigger_id,
      view: {
        type: "modal",
        callback_id: "bingo_accomplishment",
        private_metadata: channel_id,
        title: {
          type: "plain_text",
          text: "Record Accomplishment"
        },
        submit: {
          type: "plain_text",
          text: "Submit"
        },
        close: {
          type: "plain_text",
          text: "Cancel"
        },
        blocks: [
          {
            type: "input",
            block_id: "challenge_block",
            label: {
              type: "plain_text",
              text: "Choose a challenge"
            },
            element: {
              type: "static_select",
              action_id: "challenge_select",
              placeholder: {
                type: "plain_text",
                text: "Select a challenge..."
              },
              options: bingoCard
                .filter(challenge => challenge !== "FREE")
                .map(challenge => ({
                  text: {
                    type: "plain_text",
                    text: challenge
                  },
                  value: challenge
                }))
            }
          },
          {
            type: "input",
            block_id: "tag_block",
            label: {
              type: "plain_text",
              text: "Tag someone (e.g., @username)"
            },
            element: {
              type: "plain_text_input",
              action_id: "tag_input",
              placeholder: {
                type: "plain_text",
                text: "@username"
              }
            }
          },
          {
            type: "input",
            block_id: "event_location_block",
            label: {
              type: "plain_text",
              text: "Event or Location *"
            },
            element: {
              type: "plain_text_input",
              action_id: "event_location_input",
              placeholder: {
                type: "plain_text",
                text: "Where did this happen? (e.g., SD Startup Week, Coffee Chat, etc.)"
              }
            }
          }
        ]
      }
    });
    return res.status(200).send();
  } catch (error) {
    console.error('Error opening modal:', error);
    return res.status(500).send('Error opening modal');
  }
});


// Handle modal submissions
// Use urlencoded middleware to parse the payload (Slack sends it as x-www-form-urlencoded)
app.post('/slack/interactions', bodyParser.urlencoded({ extended: true }), async (req, res) => {
  if (!req.body.payload) {
    console.error('No payload received in interaction');
    return res.status(400).send('No payload received');
  }

  let payload;
  try {
    payload = JSON.parse(req.body.payload);
  } catch (error) {
    console.error('Error parsing payload:', error, req.body);
    return res.status(400).send('Invalid payload');
  }
  
  if (payload.type === "view_submission" && payload.view.callback_id === "bingo_accomplishment") {
    const user_id = payload.user.id;
    // Ensure that private_metadata is set when opening the modal.
    const channel_id = payload.view.private_metadata; 
    if (!channel_id) {
      console.error('Missing private_metadata (channel_id) in payload.');
    }
    
    // Retrieve values from modal state
    let challenge, taggedUser, eventLocation;
    try {
      challenge = payload.view.state.values.challenge_block.challenge_select.selected_option.value;
      taggedUser = payload.view.state.values.tag_block.tag_input.value;
      
      // Get eventLocation if it exists (it's optional)
      eventLocation = '';
      if (payload.view.state.values.event_location_block && 
          payload.view.state.values.event_location_block.event_location_input) {
        eventLocation = payload.view.state.values.event_location_block.event_location_input.value || '';
      }
    } catch (err) {
      console.error('Error retrieving values from modal state:', err, payload.view.state);
      return res.status(400).send('Error retrieving input values');
    }
    
    // Validate taggedUser format
    if (!taggedUser.startsWith('@')) {
      return res.json({
        response_action: "errors",
        errors: {
          tag_block: "Must start with @ symbol"
        }
      });
    }
    
    // Validate eventLocation is not empty
    if (!eventLocation || eventLocation.trim() === '') {
      return res.json({
        response_action: "errors",
        errors: {
          event_location_block: "Please enter an event or location"
        }
      });
    }

    try {
      const newAcc = new Accomplishment({
        userId: user_id,
        taggedUser,
        challenge,
        eventLocation: eventLocation,
      });
      await newAcc.save();
      
      // Get all accomplishments to check for bingo
      const userAccomplishments = await Accomplishment.find({ userId: user_id }).exec();
      
      // Create grid representation
      const grid = Array(5).fill().map(() => Array(5).fill(false));
      userAccomplishments.forEach(acc => {
        const index = bingoCard.indexOf(acc.challenge.trim());
        if (index !== -1) {
          const row = Math.floor(index / 5);
          const col = index % 5;
          grid[row][col] = true;
        }
      });
      // Mark FREE space
      const freeIndex = bingoCard.indexOf("FREE");
      if (freeIndex !== -1) {
        grid[Math.floor(freeIndex / 5)][freeIndex % 5] = true;
      }

      // Check for bingo
      let hasBingo = false;
      
      // Check rows
      hasBingo = hasBingo || grid.some(row => row.every(cell => cell));
      
      // Check columns
      for (let col = 0; col < 5; col++) {
        if (grid.every(row => row[col])) {
          hasBingo = true;
          break;
        }
      }
      
      // Check diagonals
      if (!hasBingo) {
        // Top-left to bottom-right
        hasBingo = [0,1,2,3,4].every(i => grid[i][i]);
        // Top-right to bottom-left
        if (!hasBingo) {
          hasBingo = [0,1,2,3,4].every(i => grid[i][4-i]);
        }
      }

      // Only attempt to post messages if channel_id is available
      if (channel_id) {
        // Post accomplishment message
        let accomplishmentText = `Accomplishment recorded for <@${user_id}>: "${challenge}" with ${taggedUser}`;
        
        // Add event/location if provided
        if (eventLocation && eventLocation.trim() !== '') {
          accomplishmentText += ` at ${eventLocation}`;
        }
        accomplishmentText += "!";
        
        await slackClient.chat.postMessage({
          channel: channel_id,
          text: accomplishmentText,
        });
        
        // If bingo achieved, update record and post celebration message
        if (hasBingo) {
          // Update the accomplishment to mark the bingo
          await Accomplishment.findByIdAndUpdate(newAcc._id, {
            bingoAchieved: true,
            bingoTimestamp: new Date()
          });

          await slackClient.chat.postMessage({
            channel: channel_id,
            text: `🎉 *HOWLO!* 🎉 <@${user_id}> has completed a line! View their card here: ${process.env.APP_BASE_URL || 'https://your-app.herokuapp.com'}/bingo/card?token=${generateToken(user_id)}`,
          });
        }
      }

      // Return a clear response to close the modal
      return res.status(200).json({ response_action: "clear" });
    } catch (error) {
      console.error('Error recording accomplishment:', error);
      console.error('Payload that caused error:', payload);
      return res.status(500).json({ 
        response_action: "errors",
        errors: {
          challenge_block: "Failed to save accomplishment. Please try again."
        }
      });
    }
  }
  
  // For other interaction types, send a basic 200 response
  res.status(200).send();
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
