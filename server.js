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
    // Get all accomplishments for this user
    const userAccomplishments = await Accomplishment.find({ userId }).exec();
    // Get a list of the accomplished challenge texts (trimmed)
    const accomplishedChallenges = userAccomplishments.map(a => a.challenge.trim());
    
    // Build a simple HTML table representing a 5x5 bingo card
    let html = `<html>
      <head>
        <title>Your Bingo Card</title>
        <style>
          table { border-collapse: collapse; margin: auto; }
          td { border: 1px solid #333; width: 150px; height: 100px; text-align: center; vertical-align: middle; padding: 5px; }
          .checked { background-color: #c8e6c9; }
        </style>
      </head>
      <body>
        <h1 style="text-align: center;">Your Bingo Card</h1>
        <table>`;
    
    for (let row = 0; row < 5; row++) {
      html += `<tr>`;
      for (let col = 0; col < 5; col++) {
        const index = row * 5 + col;
        const challenge = bingoCard[index];
        // Mark the cell if it is "FREE" or if the challenge is in the accomplished list
        let isChecked = (challenge === "FREE") || (accomplishedChallenges.includes(challenge));
        html += `<td class="${isChecked ? 'checked' : ''}">
                  <div>${challenge}</div>
                  ${isChecked ? '<div style="color: green; font-size: 24px;">&#10004;</div>' : ''}
                 </td>`;
      }
      html += `</tr>`;
    }
    html += `</table></body></html>`;
    
    res.send(html);
  } catch (err) {
    console.error('Error generating bingo card:', err);
    res.status(500).send("Error generating bingo card.");
  }
});

// Slash command endpoint for /bingo
app.post('/slack/commands', async (req, res) => {
  const { user_id, text, channel_id } = req.body;
  console.log('Received slash command:', req.body);
  const trimmedText = text.trim();

  // If the command text is "progress", provide the user with a link to view their visual card (ephemerally)
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

  // For logging a new accomplishment, expecting the format: "@username Challenge description"
  const parts = trimmedText.split(' ');
  if (!parts[0].startsWith('@') || parts.length < 2) {
    await slackClient.chat.postMessage({
      channel: channel_id,
      text: 'Invalid command! Use either:\n• `/bingo @username Challenge description` to log an accomplishment\n• `/bingo progress` to see your Bingo Card',
    });
    return res.status(200).send();
  }
  
  const taggedUser = parts[0];
  const challenge = parts.slice(1).join(' ');

  try {
    // Create and save the new accomplishment to MongoDB
    const newAcc = new Accomplishment({
      userId: user_id,
      taggedUser,
      challenge,
    });
    await newAcc.save();
    console.log(`Stored accomplishment for ${user_id}:`, newAcc);
    
    // Public confirmation that logs the accomplishment
    await slackClient.chat.postMessage({
      channel: channel_id,
      text: `Accomplishment recorded for <@${user_id}>: "${challenge}" with ${taggedUser}!`,
    });
    return res.status(200).send();
  } catch (error) {
    console.error('Error recording accomplishment:', error);
    return res.status(500).send('Error recording accomplishment');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
