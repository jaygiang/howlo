require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { WebClient } = require('@slack/web-api');
const mongoose = require('mongoose');

// Connect to MongoDB using the connection string in your environment variable
const mongoURI = process.env.MONGODB_URI;
mongoose.connect(mongoURI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Import the Accomplishment model (ensure you have defined this in Accomplishment.js)
const Accomplishment = require('./Accomplishment');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// Initialize Slack Web API with your OAuth token
const slackToken = process.env.SLACK_BOT_TOKEN;
const slackClient = new WebClient(slackToken);

// Define a fixed bingo card layout (25 items, center is "FREE")
const bingoCard = [
  "Introduce two people who haven’t met yet",
  "Schedule a follow-up coffee chat",
  "Find someone with a shared hobby and plan to do it together",
  "Share a personal story (non-work related)",
  "Send a message to someone you just met",
  "Ask someone about their favorite local spot",
  "Find someone who grew up in a different region",
  "Exchange a book, podcast, or movie recommendation",
  "Take a selfie with a new connection",
  "Add a new contact to your phone",
  "Make a plan to attend another event together",
  "Ask someone what they're passionate about outside work",
  "FREE", // Center spot is always marked as done
  "Invite someone to join you for a meal or coffee",
  "Find someone who enjoys the same music and swap playlists",
  "Talk about a personal goal you're working on",
  "Share something meaningful you've learned recently",
  "Discover a unique talent of someone you just met",
  "Talk about a childhood dream",
  "Find someone who's made a career pivot and learn their story",
  "Ask someone how they unwind and recharge",
  "Discuss your favorite way to give back to the community",
  "Find someone who recently traveled somewhere interesting",
  "Plan to check in with a new connection in a month",
  "Share a local secret spot"
];

app.get('/', (req, res) => {
  res.send('Server is running!');
});

// GET route to display a visual bingo card for a user
// Example: GET /bingo/card?user=U12345678
app.get('/bingo/card', async (req, res) => {
  const userId = req.query.user;
  if (!userId) {
    return res.status(400).send("Missing user query parameter.");
  }
  try {
    // Get user info from Slack
    const userInfo = await slackClient.users.info({ user: userId });
    const userName = userInfo.user.real_name.split(' ')[0]; // Get first name
    
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
        <title>${userName}'s Bingo Card</title>
        <style>
          table { border-collapse: collapse; margin: auto; }
          td { border: 1px solid #333; width: 150px; height: 100px; text-align: center; vertical-align: middle; padding: 5px; }
          .checked { background-color: #c8e6c9; }
        </style>
      </head>
      <body>
        <h1 style="text-align: center;">${userName}'s Bingo Card</h1>
        <table>`;
    
    for (let row = 0; row < 5; row++) {
      html += `<tr>`;
      for (let col = 0; col < 5; col++) {
        const index = row * 5 + col;
        const challenge = bingoCard[index];
        // Find the accomplishment for this challenge if it exists
        const accomplishment = userAccomplishments.find(a => a.challenge.trim() === challenge);
        let isChecked = (challenge === "FREE") || accomplishment;
        
        html += `<td class="${isChecked ? 'checked' : ''}">
                  <div>${challenge}</div>
                  ${isChecked ? `
                    <div style="color: green; font-size: 24px;">&#10004;</div>
                    ${accomplishment ? `<div style="color: #666; font-size: 12px;">${accomplishment.taggedUser}</div>` : ''}
                  ` : ''}
                 </td>`;
      }
      html += `</tr>`;
    }
    html += `</table>`;

    // Add accomplishments list below the card
    html += `
      <div style="margin: 20px auto; max-width: 800px;">
        <h2 style="text-align: center;">Your Accomplishments</h2>
        <ol style="line-height: 1.6;">
    `;

    // Sort accomplishments by timestamp in descending order
    userAccomplishments.sort((a, b) => b.timestamp - a.timestamp);
    
    userAccomplishments.forEach(acc => {
      html += `<li>${acc.challenge} (with ${acc.taggedUser}) - ${acc.timestamp.toLocaleDateString()}</li>`;
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

// Slash command endpoint for /bingo
app.post('/slack/commands', async (req, res) => {
  const { user_id, text, channel_id, trigger_id } = req.body;
  const trimmedText = text.trim();

  // Handle progress command
  if (trimmedText.toLowerCase() === 'progress') {
    const cardUrl = `${process.env.APP_BASE_URL || 'https://your-app.herokuapp.com'}/bingo/card?user=${user_id}`;
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
    let challenge, taggedUser;
    try {
      challenge = payload.view.state.values.challenge_block.challenge_select.selected_option.value;
      taggedUser = payload.view.state.values.tag_block.tag_input.value;
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

    try {
      const newAcc = new Accomplishment({
        userId: user_id,
        taggedUser,
        challenge,
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
        await slackClient.chat.postMessage({
          channel: channel_id,
          text: `Accomplishment recorded for <@${user_id}>: "${challenge}" with ${taggedUser}!`,
        });
        
        // If bingo achieved, post celebration message
        if (hasBingo) {
          await slackClient.chat.postMessage({
            channel: channel_id,
            text: `🎉 *BINGO!* 🎉 <@${user_id}> has completed a line! View their card here: ${process.env.APP_BASE_URL || 'https://your-app.herokuapp.com'}/bingo/card?user=${user_id}`,
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
