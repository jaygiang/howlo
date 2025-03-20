import express from 'express';
import bodyParser from 'body-parser';
import { Accomplishment } from '../models/Accomplishment.js';
import { generateToken, validateToken } from '../utils/token.js';
import { bingoCard, checkForBingo, createGridFromAccomplishments, checkForBlackout, getAllChallenges } from '../utils/bingoCard.js';
import { getSlackClient } from '../utils/slack.js';
import { buildUrl } from '../utils/url.js';
import { generateCardBlocks } from '../utils/cardImage.js';
import { leaderboardTracker, announceLeaderChange } from '../utils/leaderboardNotifications.js';
import { isBeforeLaunch, isInBetaPeriod, TESTING_MODE } from '../utils/monthlyTransition.js';

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
      // Get current month/year
      const now = new Date();
      const month = now.getMonth(); 
      const year = now.getFullYear();
      
      // Month names for display
      const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
      
      // Format leaderboard based on current period
      let leaderboardMessage;
      
      // Check if we're before the beta launch
      if (isBeforeLaunch()) {
        leaderboardMessage = {
          text: "The HOWLO XP system will launch on March 24, 2025! Check back then to see the leaderboard.",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "*🚀 Coming Soon: HOWLO XP System*\n\nThe leaderboard will launch on March 24, 2025! Keep recording achievements to earn XP that will count when the competition begins."
              }
            }
          ]
        };
      } 
      // Check if we're in the beta period
      else if (isInBetaPeriod()) {
        // Match query for beta period
        let matchQuery;
        
        // For testing mode, use current data instead of specific dates
        if (TESTING_MODE) {
          // In testing mode, show all data regardless of month/year
          matchQuery = {};
        } else {
          // In production, only show data from beta period date range
          matchQuery = { 
            $or: [
              // March 24-31, 2025
              { year: 2025, month: 2, createdAt: { $gte: new Date(2025, 2, 24) } },
              // All of April 2025
              { year: 2025, month: 3 }
            ]
          };
        }
        
        // Debug - log total number of accomplishments
        const accomplishmentCount = await Accomplishment.countDocuments();
        console.log(`Total accomplishments in database: ${accomplishmentCount}`);
        
        // Beta period leaderboard aggregation
        console.log('Leaderboard match query:', JSON.stringify(matchQuery, null, 2));
        const userXpAggregation = await Accomplishment.aggregate([
          { 
            $match: matchQuery
          },
          {
            $group: {
              _id: "$userId",
              totalXp: { $sum: "$xp" },
              accomplishmentCount: { $sum: 1 },
              hasBingo: { 
                $max: { $cond: [{ $eq: ["$bingoBonus", true] }, 1, 0] }
              },
              hasBlackout: { 
                $max: { $cond: [{ $eq: ["$blackoutBonus", true] }, 1, 0] }
              }
            }
          },
          { 
            $sort: { totalXp: -1, accomplishmentCount: -1 } 
          },
          {
            $limit: 10 // Top 10 users
          }
        ]);
        
        // Debug - log aggregation results
        console.log('Leaderboard aggregation results:', JSON.stringify(userXpAggregation, null, 2));
        
        // Format the leaderboard
        let message = `*🏆 HOWLO Launch Leaderboard - March 24 to April 30, 2025 🏆*\n\n`;
        
        if (userXpAggregation.length === 0) {
          message += "No achievements recorded yet. Be the first to score!";
        } else {
          // Get user info for all winners
          const userPromises = userXpAggregation.map(user => 
            slackClient.users.info({ user: user._id })
          );
          const userInfos = await Promise.all(userPromises);
          
          userXpAggregation.forEach((user, index) => {
            const userInfo = userInfos[index].user;
            const userName = userInfo?.real_name || `<@${user._id}>`;
            
            // Determine achievements
            let achievementBadge = "";
            if (user.hasBlackout) achievementBadge = "👑 BLACKOUT";
            else if (user.hasBingo) achievementBadge = "🎮 BINGO";
            
            // Create leaderboard entry
            message += `${index + 1}. *${userName}* - ${user.totalXp} XP`;
            if (achievementBadge) message += ` (${achievementBadge})`;
            message += `\n`;
          });
        }
        
        // Add note about reset
        message += "\n_Note: This extended launch period runs from March 24 to April 30. The first monthly reset will occur on May 1._";
        
        leaderboardMessage = {
          text: message,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: message
              }
            }
          ]
        };
      } 
      // Regular monthly leaderboard (May 2025 onward)
      else {
        // Monthly leaderboard aggregation
        const userXpAggregation = await Accomplishment.aggregate([
          { 
            $match: { month: month, year: year } 
          },
          {
            $group: {
              _id: "$userId",
              totalXp: { $sum: "$xp" },
              accomplishmentCount: { $sum: 1 },
              hasBingo: { 
                $max: { $cond: [{ $eq: ["$bingoBonus", true] }, 1, 0] }
              },
              hasBlackout: { 
                $max: { $cond: [{ $eq: ["$blackoutBonus", true] }, 1, 0] }
              }
            }
          },
          { 
            $sort: { totalXp: -1, accomplishmentCount: -1 } 
          },
          {
            $limit: 10 // Top 10 users
          }
        ]);
        
        // Format the leaderboard
        let message = `*🏆 HOWLO Leaderboard - ${monthNames[month]} ${year} 🏆*\n\n`;
        
        if (userXpAggregation.length === 0) {
          message += "No achievements recorded yet this month. Be the first to score!";
        } else {
          // Get user info for all winners
          const userPromises = userXpAggregation.map(user => 
            slackClient.users.info({ user: user._id })
          );
          const userInfos = await Promise.all(userPromises);
          
          userXpAggregation.forEach((user, index) => {
            const userInfo = userInfos[index].user;
            const userName = userInfo?.real_name || `<@${user._id}>`;
            
            // Determine achievements
            let achievementBadge = "";
            if (user.hasBlackout) achievementBadge = "👑 BLACKOUT";
            else if (user.hasBingo) achievementBadge = "🎮 BINGO";
            
            // Create leaderboard entry
            message += `${index + 1}. *${userName}* - ${user.totalXp} XP`;
            if (achievementBadge) message += ` (${achievementBadge})`;
            message += `\n`;
          });
        }
        
        leaderboardMessage = {
          text: message,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: message
              }
            }
          ]
        };
      }
      
      // Send the leaderboard message
      await slackClient.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: leaderboardMessage.text,
        blocks: leaderboardMessage.blocks
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
    // Get user's accomplishments to filter out completed challenges
    const userAccomplishments = await Accomplishment.find({ userId: user_id }).exec();
    const completedChallenges = userAccomplishments.map(acc => acc.challenge.trim());
    
    // Filter available challenges
    const availableChallenges = bingoCard
      .filter(challenge => challenge !== "FREE" && !completedChallenges.includes(challenge.trim()))
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
      });
    
    // If no challenges are available, show a message
    if (availableChallenges.length === 0) {
      await slackClient.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: "Congratulations! 🎉 You've unlocked all Challenges on the HOWLO card! View your progress with `/howlo progress`."
      });
      return res.status(200).send();
    }
    
    await slackClient.views.open({
      trigger_id,
      view: {
        type: "modal",
        callback_id: "bingo_accomplishment",
        private_metadata: channel_id,
        title: {
          type: "plain_text",
          text: "Record your Achievement"
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
              text: "Choose a challenge *"
            },
            element: {
              type: "static_select",
              action_id: "challenge_select",
              placeholder: {
                type: "plain_text",
                text: "Select a challenge..."
              },
              options: availableChallenges
            }
          },
          {
            type: "section",
            block_id: "tag_info_block",
            text: {
              type: "mrkdwn",
              text: "*Who did you meet? * *\nPlease use *exactly one* of the below methods to tag someone"
            }
          },
          {
            type: "input",
            block_id: "tag_input_block",
            optional: true,
            label: {
              type: "plain_text",
              text: "Tag someone"
            },
            element: {
              type: "users_select",
              action_id: "tag_workspace_input",
              placeholder: {
                type: "plain_text",
                text: "Select a workspace member"
              }
            }
          },
          {
            type: "input", 
            block_id: "external_name_block",
            optional: true,
            label: {
              type: "plain_text",
              text: "Or enter a name"
            },
            element: {
              type: "plain_text_input",
              action_id: "external_name_input",
              placeholder: {
                type: "plain_text",
                text: "For someone outside the workspace"
              }
            }
          },
          // {
          //   type: "context",
          //   block_id: "tag_help_block",
          //   elements: [
          //     {
          //       type: "mrkdwn",
          //       text: "*Note:* Please use *exactly one* of the above methods to tag someone."
          //     }
          //   ]
          // },
          {
            type: "actions",
            block_id: "invite_action_block",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Invite to Workspace",
                  emoji: true
                },
                url: process.env.SLACK_INVITE_CODE ? process.env.SLACK_INVITE_CODE.trim() : "https://slack.com/join",
                action_id: "invite_button"
              }
            ]
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
  
  // Handle block actions (for radio button selection)
  if (payload.type === "block_actions") {
    const action = payload.actions[0];
    
    // Handle tag field selections
    if (action.action_id === "tag_workspace_input" || action.action_id === "external_name_input") {
      try {
        // Get current view state
        const viewState = payload.view.state.values;
        const blocks = payload.view.blocks;
        
        // Determine which field was just used
        const workspaceFieldUsed = action.action_id === "tag_workspace_input";
        
        // Find and get the blocks to update
        const updatedBlocks = blocks.map(block => {
          if (workspaceFieldUsed && block.block_id === "external_name_block") {
            // If workspace field was used, clear external name field
            if (block.element && block.element.type === "plain_text_input") {
              // Create a new element with empty initial value
              block.element = {
                ...block.element,
                initial_value: ""
              };
            }
          } 
          else if (!workspaceFieldUsed && block.block_id === "tag_input_block") {
            // If external name field was used, clear workspace field
            // Note: We can't directly clear users_select, but we'll handle this
            // in the submission validation instead
          }
          return block;
        });
        
        // Only update if we need to
        if (workspaceFieldUsed) {
          await getSlackClient().views.update({
            view_id: payload.view.id,
            hash: payload.view.hash,
            view: {
              type: "modal",
              callback_id: payload.view.callback_id,
              title: payload.view.title,
              submit: payload.view.submit,
              blocks: updatedBlocks
            }
          });
        }
        
        return res.status(200).send();
      } catch (err) {
        console.error('Error handling tag field selection:', err);
        return res.status(200).send();
      }
    }
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
      
      // Check both tag input options
      const workspaceUser = payload.view.state.values.tag_input_block?.tag_workspace_input?.selected_user;
      const externalName = payload.view.state.values.external_name_block?.external_name_input?.value;
      
      // Validate that exactly one tagging method was used
      if (!workspaceUser && (!externalName || externalName.trim() === '')) {
        return res.json({
          response_action: "errors",
          errors: {
            tag_input_block: "Please either select a workspace member or enter a name"
          }
        });
      } else if (workspaceUser && externalName && externalName.trim() !== '') {
        return res.json({
          response_action: "errors",
          errors: {
            external_name_block: "Please use only one tagging method - either select a workspace member OR enter a name"
          }
        });
      }
      
      // Set taggedUser based on which method was used
      if (workspaceUser) {
        taggedUser = `<@${workspaceUser}>`;
      } else {
        // Format external name
        taggedUser = externalName.startsWith('@') ? externalName : '@' + externalName;
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
      
      // Get current month and year for XP tracking
      const now = new Date();
      const currentMonth = now.getMonth(); // 0-11 for Jan-Dec
      const currentYear = now.getFullYear();
      
      console.log(`Creating accomplishment for user ${user_id} with month=${currentMonth}, year=${currentYear}`);
      
      // Base XP for accomplishment
      let xpEarned = 100;
      let bingoAchieved = false;
      let blackoutAchieved = false;
      
      // Create accomplishment with time period tracking
      const newAcc = new Accomplishment({
        userId: user_id,
        taggedUser,
        challenge,
        eventLocation: eventLocation,
        xp: xpEarned,
        month: currentMonth,
        year: currentYear
      });
      
      console.log('About to save accomplishment:', JSON.stringify(newAcc, null, 2));
      await newAcc.save();
      console.log('Saved accomplishment with ID:', newAcc._id);
      
      // Get all accomplishments to check for bingo
      const userAccomplishments = await Accomplishment.find({ 
        userId: user_id,
        month: currentMonth,
        year: currentYear 
      }).exec();
      
      // Create grid representation
      const grid = createGridFromAccomplishments(userAccomplishments);
      
      // Get completed challenges for this user
      const completedChallenges = userAccomplishments.map(a => a.challenge);
      
      // Check for bingo
      const bingoResult = checkForBingo(grid);
      
      // Check if this is the first time user achieved bingo
      let isNewBingo = false;
      if (bingoResult.bingo) {
        const existingBingo = await Accomplishment.findOne({
          userId: user_id,
          month: currentMonth,
          year: currentYear,
          bingoBonus: true
        });
        
        if (!existingBingo) {
          // This is a new bingo
          isNewBingo = true;
          bingoAchieved = true;
          xpEarned += 500;
          
          // Update the accomplishment to include the bingo bonus
          await Accomplishment.findByIdAndUpdate(newAcc._id, {
            bingoBonus: true,
            bingoAchieved: true,
            bingoTimestamp: now,
            xp: xpEarned
          });
        }
      }
      
      // Check for blackout (all challenges completed except FREE)
      const allChallenges = getAllChallenges();
      const hasBlackout = allChallenges.every(challenge => 
        completedChallenges.some(completed => completed.trim() === challenge.trim())
      );
      
      if (hasBlackout) {
        // Check if blackout bonus was already awarded
        const existingBlackout = await Accomplishment.findOne({
          userId: user_id,
          month: currentMonth,
          year: currentYear,
          blackoutBonus: true
        });
        
        if (!existingBlackout) {
          // Award blackout bonus
          blackoutAchieved = true;
          xpEarned += 1000;
          
          // Update the accomplishment to include the blackout bonus
          await Accomplishment.findByIdAndUpdate(newAcc._id, {
            blackoutBonus: true,
            blackoutTimestamp: now,
            xp: xpEarned
          });
        }
      }
      
      // Only attempt to post messages if channel_id is available
      if (channel_id) {
        // Remove HTML tags from challenge text for the message
        const cleanChallenge = challenge.replace(/<\/?strong>/g, '');
        
        // Add XP information to the accomplishment message
        let accomplishmentText = `Accomplishment recorded for <@${user_id}>: *"${cleanChallenge}"* with *${taggedUser}*`;
        
        // Add event/location if provided
        if (eventLocation && eventLocation.trim() !== '') {
          accomplishmentText += ` at *${eventLocation}*`;
        }
        
        // Add XP information
        accomplishmentText += `! *+${xpEarned} XP gained!*`;
        
        // Add special messages for bingo and blackout
        if (bingoAchieved) {
          accomplishmentText += "\n🎮 *BINGO BONUS!* +500 XP for completing a row!";
        }
        
        if (blackoutAchieved) {
          accomplishmentText += "\n🏆 *BLACKOUT BONUS!* +1000 XP for unlocking all challenges!";
        }
        
        // Post the message
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
            
            // Create and send the DM with XP information
            const notificationMessage = `Hey there! *${taggerName}* (<@${user_id}>) just tagged you in a HOWLO challenge: *"${cleanChallenge}"* at *${eventLocation}*.\n\nThey earned *${xpEarned} XP* for this achievement.\n\nWant to record your own achievements? Use \`/howlo\` to get started!`;
            
            await slackClient.chat.postMessage({
              channel: taggedUserId,
              text: notificationMessage,
            });
          }
        } catch (dmError) {
          // If DM fails, just log it but don't stop the process
          console.error('Failed to send DM to tagged user:', dmError);
        }
        
        // If bingo achieved, post celebration message
        if (bingoAchieved) {
          await slackClient.chat.postMessage({
            channel: channel_id,
            text: `🎉 *HOWLO!* 🎉 <@${user_id}> has completed a line! *+500 XP Bonus!* View their card here: ${buildUrl(process.env.APP_BASE_URL, `howlo/card?token=${generateToken(user_id)}`)}`,
          });
        }
        
        // If blackout achieved, post celebration message
        if (blackoutAchieved) {
          await slackClient.chat.postMessage({
            channel: channel_id,
            text: `👑 *BLACKOUT ACHIEVED!* 👑 <@${user_id}> has completed ALL challenges! *+1000 XP Bonus!* View their card here: ${buildUrl(process.env.APP_BASE_URL, `howlo/card?token=${generateToken(user_id)}`)}`,
          });
        }
        
        // Check for leaderboard changes and announce if needed
        if (!isBeforeLaunch()) {
          const leaderboardChanges = await leaderboardTracker.checkForChanges();
          if (leaderboardChanges) {
            await announceLeaderChange(leaderboardChanges);
          }
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

