require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { WebClient } = require('@slack/web-api');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// Initialize Slack Web API with your OAuth token
const slackToken = process.env.SLACK_BOT_TOKEN;
const slackClient = new WebClient(slackToken);

// In-memory storage for accomplishments
// Structure: { userId: [ { challenge, taggedUser, timestamp }, ... ] }
const accomplishments = {};

app.get('/', (req, res) => {
  res.send('Server is running!');
});

// Slash command endpoint for /bingo
app.post('/slack/commands', async (req, res) => {
  const { user_id, text, channel_id } = req.body;
  console.log('Received slash command:', req.body);

  // Check if the command is a request for the leaderboard
  if (text.trim().toLowerCase() === 'leaderboard') {
    // Aggregate accomplishments per user
    const leaderboard = Object.entries(accomplishments).map(([uid, entries]) => ({
      uid,
      count: entries.length,
    })).sort((a, b) => b.count - a.count);

    let message = '*Bingo Leaderboard:*\n';
    leaderboard.forEach((entry, index) => {
      message += `${index + 1}. <@${entry.uid}> - ${entry.count} accomplishments\n`;
    });

    // Respond with the leaderboard as a public message
    try {
      await slackClient.chat.postMessage({
        channel: channel_id,
        text: message,
      });
      return res.status(200).send();
    } catch (error) {
      console.error('Error posting leaderboard message:', error);
      return res.status(500).send('Error posting leaderboard message');
    }
  }

  // Otherwise, log a new accomplishment
  // Expecting input format like: "@username Challenge description"
  // For a simple MVP, we take the first word as the tagged user and the rest as the challenge description.
  const parts = text.trim().split(' ');
  const taggedUser = parts[0]; // e.g., "@username" or a challenge ID reference
  const challenge = parts.slice(1).join(' ');

  // Initialize the array for the user if not already set
  if (!accomplishments[user_id]) {
    accomplishments[user_id] = [];
  }

  // Save the accomplishment with a timestamp
  accomplishments[user_id].push({
    taggedUser,
    challenge,
    timestamp: new Date().toISOString(),
  });

  console.log(`Stored accomplishment for ${user_id}:`, accomplishments[user_id]);

  // Send a confirmation message back to the channel
  try {
    await slackClient.chat.postMessage({
      channel: channel_id,
      text: `Accomplishment recorded for <@${user_id}>: "${challenge}" with ${taggedUser}!`,
    });
    res.status(200).send();
  } catch (error) {
    console.error('Error posting confirmation message:', error);
    res.status(500).send('Error posting confirmation message');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
