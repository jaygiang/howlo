import express from 'express';
import bodyParser from 'body-parser';
import { Accomplishment } from '../models/Accomplishment.js';
import { generateToken, validateToken } from '../utils/token.js';
import { bingoCard, checkForBingo, createGridFromAccomplishments } from '../utils/bingoCard.js';
import { getSlackClient } from '../utils/slack.js';
import { buildUrl } from '../utils/url.js';
import { generateCardBlocks } from '../utils/cardImage.js';

const router = express.Router();

// Use urlencoded middleware for parsing Slack payloads
router.use(bodyParser.urlencoded({ extended: true }));

// Slash command endpoint for /bingo
router.post('/commands', async (req, res) => {
  const { user_id, text, channel_id, trigger_id } = req.body;
  const trimmedText = text.trim();
  const slackClient = getSlackClient();

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
    const cardUrl = buildUrl(process.env.APP_BASE_URL, `howlo/card?token=${token}`);
    
    try {
      // Generate the progress card blocks
      const progressBlocks = await generateCardBlocks(user_id, token, false);
      
      // Post the progress card
      try {
        console.log('Attempting to post progress card with blocks to Slack');
        await slackClient.chat.postEphemeral({
          channel: channel_id,
          user: user_id,
          blocks: progressBlocks,
          text: `View your HOWLO Bingo progress: ${cardUrl}`
        });
        console.log('Successfully posted progress card with blocks');
      } catch (blockError) {
        console.error('Error posting progress with blocks, falling back to text-only:', blockError);
        // Fallback to text-only message if blocks fail
        try {
          await slackClient.chat.postEphemeral({
            channel: channel_id,
            user: user_id,
            text: `View your HOWLO Bingo progress: ${cardUrl}`
          });
          console.log('Successfully posted fallback text-only progress message');
        } catch (textError) {
          console.error('Error posting text-only fallback for progress:', textError);
        }
      }
      
      return res.status(200).send();
    } catch (error) {
      console.error('Error posting progress:', error);
      
      // Ultimate fallback - just send a simple text message
      try {
        await slackClient.chat.postEphemeral({
          channel: channel_id,
          user: user_id,
          text: `View your Bingo Card here: ${cardUrl}`
        });
      } catch (fallbackError) {
        console.error('Error with fallback message:', fallbackError);
      }
      
      return res.status(200).send();
    }
  } else if (trimmedText.toLowerCase() === 'card') {
    // Generate a visual representation of the bingo card for Slack
    const token = generateToken(user_id);
    const cardUrl = buildUrl(process.env.APP_BASE_URL, `howlo/blank-card?token=${token}`);
    
    try {
      // Generate the card blocks
      const cardBlocks = await generateCardBlocks(user_id, token, true);
      console.log('Card blocks generated:', JSON.stringify(cardBlocks, null, 2));
      
      // Post the card
      try {
        console.log('Attempting to post card with blocks to Slack');
        await slackClient.chat.postEphemeral({
          channel: channel_id,
          user: user_id,
          blocks: cardBlocks,
          text: `View your HOWLO Card: ${cardUrl}`
        });
        console.log('Successfully posted card with blocks');
      } catch (blockError) {
        console.error('Error posting with blocks, falling back to text-only:', blockError);
        // Fallback to text-only message if blocks fail
        try {
          await slackClient.chat.postEphemeral({
            channel: channel_id,
            user: user_id,
            text: `View your HOWLO Card: ${cardUrl}`
          });
          console.log('Successfully posted fallback text-only message');
        } catch (textError) {
          console.error('Error posting text-only fallback:', textError);
        }
      }
      
      return res.status(200).send();
    } catch (error) {
      console.error('Error posting card:', error);
      
      // Ultimate fallback - just send a simple text message
      try {
        await slackClient.chat.postEphemeral({
          channel: channel_id,
          user: user_id,
          text: `View your HOWLO Card here: ${cardUrl}`
        });
      } catch (fallbackError) {
        console.error('Error with fallback message:', fallbackError);
      }
      
      return res.status(200).send();
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
                .map(challenge => {
                  // Strip HTML tags for dropdown and truncate if needed
                  let cleanText = challenge.replace(/<\/?strong>/g, '');
                  // Ensure text is under 75 chars for Slack's limits
                  if (cleanText.length > 75) {
                    cleanText = cleanText.substring(0, 72) + '...';
                  }
                  return {
                    text: {
                      type: "plain_text",
                      text: cleanText
                    },
                    value: challenge
                  };
                })
            }
          },
          {
            type: "input",
            block_id: "tag_block",
            label: {
              type: "plain_text",
              text: "Tag someone"
            },
            element: {
              type: "users_select",
              action_id: "tag_input",
              placeholder: {
                type: "plain_text",
                text: "Select a user or type a custom name"
              },
              optional: true
            },
            hint: {
              type: "plain_text",
              text: "Select from workspace users or type any name for people outside Slack"
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
                text: "Where did this happen? (e.g., SD Startup Week, Coffee Chat)"
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
router.post('/interactions', async (req, res) => {
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
      
      // Get the tag input value - could be a selected user or custom text
      const tagValues = payload.view.state.values.tag_block.tag_input;
      
      // Check if a workspace user was selected
      if (tagValues.selected_user) {
        // This is a workspace user selected from the dropdown
        taggedUser = `<@${tagValues.selected_user}>`;
      } 
      // Check if there's custom text input
      else if (tagValues.value && tagValues.value.trim() !== '') {
        const customName = tagValues.value.trim();
        // Add @ prefix if it doesn't already have one
        taggedUser = customName.startsWith('@') ? customName : '@' + customName;
      } 
      else {
        return res.json({
          response_action: "errors",
          errors: {
            tag_block: "Please select a user or enter a name"
          }
        });
      }
      
      // Get eventLocation 
      eventLocation = '';
      if (payload.view.state.values.event_location_block && 
          payload.view.state.values.event_location_block.event_location_input) {
        eventLocation = payload.view.state.values.event_location_block.event_location_input.value || '';
      }
    } catch (err) {
      console.error('Error retrieving values from modal state:', err, payload.view.state);
      return res.status(400).send('Error retrieving input values');
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
      const slackClient = getSlackClient();
      const newAcc = new Accomplishment({
        userId: user_id,
        taggedUser,
        challenge,
        eventLocation: eventLocation,
      });
      await newAcc.save();
      
      // Get all accomplishments to check for bingo
      const userAccomplishments = await Accomplishment.find({ userId: user_id }).exec();
      
      // Create grid representation and check for bingo
      const grid = createGridFromAccomplishments(userAccomplishments);
      const hasBingo = checkForBingo(grid);

      // Only attempt to post messages if channel_id is available
      if (channel_id) {
        // Remove HTML tags from challenge text for the message
        const cleanChallenge = challenge.replace(/<\/?strong>/g, '');
        
        // Post accomplishment message
        let accomplishmentText = `Accomplishment recorded for <@${user_id}>: *"${cleanChallenge}"* with *${taggedUser}*`;
        
        // Add event/location if provided
        if (eventLocation && eventLocation.trim() !== '') {
          accomplishmentText += ` at *${eventLocation}*`;
        }
        accomplishmentText += "!";
        
        await slackClient.chat.postMessage({
          channel: channel_id,
          text: accomplishmentText,
        });

        // Send a DM to the tagged user if it's a workspace user
        try {
          // Only send a DM if the user is a workspace user (starts with <@ and ends with >)
          if (taggedUser.startsWith('<@') && taggedUser.endsWith('>')) {
            // Get the user_id from the taggedUser format <@USER_ID>
            const taggedUserId = taggedUser.substring(2, taggedUser.length - 1);
            
            // Get user info for mentioning by name
            const taggerInfo = await slackClient.users.info({ user: user_id });
            const taggerName = taggerInfo.user.real_name || taggerInfo.user.name;
            
            // Create and send the DM
            const notificationMessage = `Hey there! *${taggerName}* (<@${user_id}>) just tagged you in a HOWLO challenge: *"${cleanChallenge}"* at *${eventLocation}*. Check out <#${channel_id}> to see their progress!`;
            
            await slackClient.chat.postMessage({
              channel: taggedUserId,
              text: notificationMessage,
            });
          }
        } catch (dmError) {
          // If DM fails, just log it but don't stop the process
          console.error('Failed to send DM to tagged user:', dmError);
        }
        
        // If bingo achieved, update record and post celebration message
        if (hasBingo) {
          // Update the accomplishment to mark the bingo
          await Accomplishment.findByIdAndUpdate(newAcc._id, {
            bingoAchieved: true,
            bingoTimestamp: new Date()
          });

          await slackClient.chat.postMessage({
            channel: channel_id,
            text: `🎉 *HOWLO!* 🎉 <@${user_id}> has completed a line! View their card here: ${buildUrl(process.env.APP_BASE_URL, `howlo/card?token=${generateToken(user_id)}`)}`,
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

export const slackRoutes = router;
