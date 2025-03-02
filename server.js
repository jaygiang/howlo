require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { WebClient } = require('@slack/web-api');
const mongoose = require('mongoose');

// Connect to MongoDB using the connection string in your environment variable
const mongoURI = process.env.MONGODB_URI;
mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Import the Accomplishment model (ensure you have defined this in Accomplishment.js)
const Accomplishment = require('./Accomplishment');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// Initialize Slack Web API with your OAuth token
const slackToken = process.env.SLACK_BOT_TOKEN;
const slackClient = new WebClient(slackToken);

app.get('/', (req, res) => {
  res.send('Server is running!');
});

// Slash command endpoint for /bingo
app.post('/slack/commands', async (req, res) => {
  const { user_id, text, channel_id } = req.body;
  console.log('Received slash command:', req.body);

  const trimmedText = text.trim();

  // Check if the command is to view progress
  if (trimmedText.toLowerCase() === 'progress') {
    try {
      const userAccomplishments = await Accomplishment.find({ userId: user_id }).sort({ timestamp: -1 });
      let message = '*Your Bingo Progress:*\n';

      if (userAccomplishments.length === 0) {
        message += "You haven't recorded any accomplishments yet!";
      } else {
        message += `You have ${userAccomplishments.length} accomplishment(s):\n\n`;
        userAccomplishments.forEach((acc, i) => {
          message += `${i + 1}. ${acc.challenge} (with ${acc.taggedUser}) - ${acc.timestamp.toLocaleDateString()}\n`;
        });
      }
      
      await slackClient.chat.postMessage({
        channel: channel_id,
        text: message,
      });
      return res.status(200).send();
    } catch (error) {
      console.error('Error retrieving progress:', error);
      return res.status(500).send('Error retrieving progress');
    }
  }

  // For logging a new accomplishment, expecting the format: "@username Challenge description"
  const parts = trimmedText.split(' ');
  
  // If the command text does not include at least two parts, consider it an unknown command
  if (parts.length < 2) {
    const message = 'Unrecognized command. Please use one of the following:\n' +
                    '- To check your progress, type: `progress`\n' +
                    '- To record an accomplishment, type: `@username Challenge description`';
    try {
      await slackClient.chat.postMessage({
        channel: channel_id,
        text: message,
      });
      return res.status(200).send();
    } catch (error) {
      console.error('Error posting unknown command message:', error);
      return res.status(500).send('Error posting unknown command message');
    }
  }
  
  // Otherwise, process the accomplishment command
  const taggedUser = parts[0]; // e.g., "@username"
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
    
    // Send a confirmation message back to the channel
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