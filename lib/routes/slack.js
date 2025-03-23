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

// Define helpMarkdown at the top level so it's available to all command handlers
const helpMarkdown = `
      *How to Play HOWLO*

      Hey Social Coyotes! 🤝🐺
      
      We're launching *HOWLO BINGO* - a fun way to meet new pack members at San Diego tech events!
      
      
      *🎮 1. What is HOWLO BINGO?*
      
          • HOWLO BINGO is a networking game where you connect with others in meaningful ways
          • Each square has an achievement that prompts conversation (examples below)
          • Complete a row of 5, column of 5, or diagonal of 5 to get BINGO!
          • Let out a victory HOWL when you win! 🐺
          • Examples of achievements:
              • "Share a personal story"
              • "Find someone with a shared hobby"
              • "Schedule a follow-up coffee chat" ☕
      
      
      *2. Available Commands:*
      
          *Log Achievements:*
          • \`/howlo\` or \`/howlo log\` or \`/howlo achievement\` - Record a new achievement
          
          *View Your Progress:*
          • \`/howlo card\` - See your HOWLO bingo card
          • \`/howlo stats\` or \`/howlo profile\` - View your stats and recent activity
          • \`/howlo leaderboard\` - See who's leading this month
          
          *Help & Info:*
          • \`/howlo help\` or \`/howlo rules\` - View this guide
      
      
      *3. Log a completed achievement:*
      
          • Type \`/howlo\`, \`/howlo log\`, or \`/howlo achievement\` in this channel 
          • Select your achievement 
          • Tag the person you connected with (they may not be pinged)
          • Input the event location
      
      *4. To see your HOWLO board:*
      
          • Command \`/howlo card\`
          • Click on the link provided
      
      *5. To see your profile stats and achievements:*
      
          • Command \`/howlo stats\` or \`/howlo profile\`
          • View your current month stats, all-time stats, and recent activity
      
      *6. Let's get competitive!*
      
          • Command \`/howlo leaderboard\` to see the top coyotes


      *📊 Experience Points (XP) System:*
      
          • Each completed achievement: *+100 XP*
          • Getting a BINGO (completing a row/column/diagonal): *+500 XP HOWLO Bonus*
          • Achieving DENOUT (all achievements completed): *+1000 XP Bonus*
          • XP is used to determine your rank on the leaderboard


      *🔄 Monthly Resets:*
      
          • The leaderboard resets at the beginning of each month
          • Your achievements are recorded permanently on your profile
          • Monthly winners are announced and celebrated
          • After reset, you can complete achievements again to earn XP for the new month
          • Your all-time stats will continue to grow across months
      
      
      *🔕 Too many notifications?*
      
          • Right-click on this channel > "Change notifications"
          • Select "Only @mentions and keywords"
          • Or tune it all out by selecting "Nothing" 
      
      *🖨️ Analog Option*
      
          • Print your HOWLO card and bring it to events! 
          • Nothing says "I'm here to connect!" like pulling out a physical bingo card and asking someone to initial a square.
            The confused looks are half the fun! 🤣
      
      ---
      
      So what are you waiting for? The pack that plays together, stays together! 
      
      Let's make some noise and build our community one HOWL YEAH at a time! 🐺
      
      Share all feedbacks, ideas, notes and growls with @jonah and @Jay
      `;

// Slash command endpoint for /bingo
router.post('/commands', async (req, res) => {
  const { user_id, text, channel_id, trigger_id } = req.body;
  const trimmedText = text.trim();
  const slackClient = getSlackClient();

  // Check for command aliases for logging achievements
  if (trimmedText.toLowerCase() === 'log' || trimmedText.toLowerCase() === 'achievement') {
    // Treat these as empty command (same as just typing /howlo with no arguments)
    // Open the achievement logging modal
    return openAchievementModal(trigger_id, user_id, channel_id, res);
  }

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
        
        // Create enhanced leaderboard blocks with better visual structure
        const leaderboardBlocks = [
          {
            "type": "header",
            "text": {
              "type": "plain_text",
              "text": `🏆 HOWLO Leaderboard - ${monthNames[month]} ${year}`,
              "emoji": true
            }
          },
          {
            "type": "divider"
          }
        ];

        // Add explanation block if there are no users
        if (userXpAggregation.length === 0) {
          leaderboardBlocks.push({
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "No achievements recorded yet this month. Be the first to score!"
            }
          });
        } else {
          // Add a context block explaining what this is
          leaderboardBlocks.push({
            "type": "context",
            "elements": [
              {
                "type": "mrkdwn",
                "text": "Top scorers this month based on XP earned from achievements, BINGOs, and blackouts"
              }
            ]
          });
          
          // Get user info for all winners - IMPORTANT: Define userInfos here before using it
          const userPromises = userXpAggregation.map(user => 
            slackClient.users.info({ user: user._id })
      );
      const userInfos = await Promise.all(userPromises);

          // Format the leaderboard text version
          let message = `*🏆 HOWLO Leaderboard - ${monthNames[month]} ${year} 🏆*\n\n`;
          
          // Add user entries to both message and blocks with better formatting
          userXpAggregation.forEach((user, index) => {
        const userInfo = userInfos[index].user;
            const userName = userInfo?.real_name || `<@${user._id}>`;
            
            // Use higher quality image source (192px)
            const userAvatar = userInfo?.profile?.image_192 || "https://howlo.vercel.app/images/coyote.png";
            
            // Determine rank emoji/indicator
            let rankIndicator;
            if (index === 0) rankIndicator = "🥇";
            else if (index === 1) rankIndicator = "🥈";
            else if (index === 2) rankIndicator = "🥉";
            else rankIndicator = `${index + 1}.`;
            
            // Determine achievements
            let achievementBadge = "";
            if (user.hasBlackout) achievementBadge = "👑 DENOUT";
            else if (user.hasBingo) achievementBadge = "🎮 HOWLO LINE";
            
            // Create leaderboard text entry
            message += `${rankIndicator} *${userName}* • ${user.totalXp} XP`;
            if (achievementBadge) message += ` • ${achievementBadge}`;
            message += `\n`;
            
            // Use context blocks which display images smaller
            leaderboardBlocks.push({
              "type": "context",
              "elements": [
                {
                  "type": "image",
                  "image_url": userAvatar,
                  "alt_text": userName
                },
                {
                  "type": "mrkdwn",
                  "text": `${rankIndicator} *${userName}* • ${user.totalXp} XP${achievementBadge ? ` • ${achievementBadge}` : ''}${index === 0 ? ' • 👑 Current Leader' : ''}`
                }
              ]
            });
          });
          
          // Set the message text for the leaderboard
          leaderboardMessage = {
            text: message,
            blocks: leaderboardBlocks
          };
        }

        // Add motivational footer if we have users
        if (userXpAggregation.length > 0) {
          leaderboardBlocks.push(
            {
              "type": "divider"
            },
            {
              "type": "context",
              "elements": [
                {
                  "type": "mrkdwn",
                  "text": "Complete achievements to earn XP and climb the leaderboard! Use `/howlo` to log a new achievement."
                }
              ]
            }
          );
        }

        // Set the leaderboard message if not already set (like in the empty case)
        if (!leaderboardMessage) {
          leaderboardMessage = {
            text: "No achievements recorded yet this month. Be the first to score!",
            blocks: leaderboardBlocks
          };
        }
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
            
            // Use higher quality image source (192px)
            const userAvatar = userInfo?.profile?.image_192 || "https://howlo.vercel.app/images/coyote.png";
            
            // Determine achievements
            let achievementBadge = "";
            if (user.hasBlackout) achievementBadge = "👑 DENOUT";
            else if (user.hasBingo) achievementBadge = "🎮 HOWLO LINE";
            
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
    // Redirect to card command since we're consolidating them
    return res.status(200).send({ text: "The progress command is now merged with the card command. Please use `/howlo card` instead." });
  } else if (trimmedText.toLowerCase() === 'card') {
    // Generate a visual representation of the user's progress card for Slack
    const token = generateToken(user_id);
    const cardUrl = buildUrl(process.env.APP_BASE_URL, `howlo/card?token=${token}`);
    
    try {
      // Get the user's current rank to include in the card
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      const userRank = await getUserRank(user_id, currentMonth, currentYear);
      
      // Generate the card blocks for the user's progress
      // Pass the userRank to the generateCardBlocks function
      const cardBlocks = await generateCardBlocks(user_id, token, false, userRank);
      
      // Add a button to the end of the card blocks
      cardBlocks.push(
        {
          "type": "actions",
          "elements": [
            {
              "type": "button",
              "text": {
                "type": "plain_text",
                "text": "View Your Card",
                "emoji": true
              },
              "url": cardUrl,
              "style": "primary"
            }
          ]
        }
      );
      
      // Post the card
      try {
        console.log('Attempting to post card with blocks to Slack');
        await slackClient.chat.postEphemeral({
          channel: channel_id,
          user: user_id,
          blocks: cardBlocks,
          text: `View your HOWLO progress: ${cardUrl}`
        });
        console.log('Successfully posted card with blocks');
      } catch (blockError) {
        console.error('Error posting with blocks, falling back to text-only:', blockError);
        // Fallback to text-only message if blocks fail
        try {
          await slackClient.chat.postEphemeral({
            channel: channel_id,
            user: user_id,
            text: `View your HOWLO progress: ${cardUrl}`
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
    // 'rules' command now displays the same help content
    try {
      // Use the helpMarkdown defined at the top level
      await slackClient.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: helpMarkdown,
        mrkdwn: true
      });
      return res.status(200).send();
    } catch (error) {
      console.error('Error posting rules:', error);
      return res.status(500).send('Error posting rules');
    }
  } else if (trimmedText.toLowerCase() === 'help') {
    // Display a help message with all available commands
    try {
      // Use the helpMarkdown defined at the top level
      await slackClient.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: helpMarkdown,
        mrkdwn: true
      });
      return res.status(200).send();
    } catch (error) {
      console.error('Error posting help:', error);
      return res.status(500).send('Error posting help information');
    }
  } else if (trimmedText.toLowerCase() === 'stats' || trimmedText.toLowerCase() === 'profile') {
    try {
      // Generate token for the user
      const token = generateToken(user_id);
      const cardUrl = buildUrl(process.env.APP_BASE_URL, `howlo/card?token=${token}`);
      
      // Get user info from Slack
      const userInfo = await slackClient.users.info({ user: user_id });
      const userName = userInfo.user.real_name || userInfo.user.name || `<@${user_id}>`;
      const userAvatar = userInfo.user.profile.image_192 || userInfo.user.profile.image_72 || userInfo.user.profile.image_32;
      
      // Get current month and year
      const now = new Date();
      const currentMonth = now.getMonth(); // 0-11 for Jan-Dec
      const currentYear = now.getFullYear();
      const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
      
      // Get all accomplishments for this user
      const allUserAccomplishments = await Accomplishment.find({ userId: user_id }).exec();
      
      // Get current month accomplishments
      const currentMonthAccomplishments = allUserAccomplishments.filter(acc => 
        acc.month === currentMonth && acc.year === currentYear
      );
      
      // Calculate stats
      const totalXp = allUserAccomplishments.reduce((sum, acc) => sum + (acc.xp || 0), 0);
      const totalAccomplishments = allUserAccomplishments.length;
      const currentMonthXp = currentMonthAccomplishments.reduce((sum, acc) => sum + (acc.xp || 0), 0);
      const currentMonthCount = currentMonthAccomplishments.length;
      
      // Check for achievements
      const hasBingo = allUserAccomplishments.some(acc => acc.bingoBonus === true);
      const hasBlackout = allUserAccomplishments.some(acc => acc.blackoutBonus === true);
      
      // Get recent activity (last 3 accomplishments from current month)
      const recentActivity = currentMonthAccomplishments
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 3);
      
      // Process tagged users to get display names
      const processedActivity = await Promise.all(recentActivity.map(async (acc) => {
        let taggedUserDisplay = 'Unknown user';
        try {
          if (acc.taggedUser && acc.taggedUser.startsWith('<@') && acc.taggedUser.endsWith('>')) {
            const taggedUserId = acc.taggedUser.substring(2, acc.taggedUser.length - 1);
            const taggedUserInfo = await slackClient.users.info({ user: taggedUserId });
            taggedUserDisplay = taggedUserInfo.user.real_name || taggedUserInfo.user.name || acc.taggedUser;
          } else if (acc.taggedUser) {
            taggedUserDisplay = acc.taggedUser;
          }
        } catch (error) {
          console.warn(`Error getting display name for ${acc.taggedUser}:`, error.message);
        }
        
        // Use a regular object with explicitly copied properties
        return {
          challenge: acc.challenge ? acc.challenge.replace(/<\/?strong>/g, '') : 'Unknown challenge', // Clean HTML tags
          taggedUserDisplay,
          formattedDate: acc.timestamp ? new Date(acc.timestamp).toLocaleDateString() : 'Unknown date'
        };
      }));
      
      // Get the user's current rank on the leaderboard
      const userRank = await getUserRank(user_id, currentMonth, currentYear);
      
      // Create the profile card blocks
      const profileBlocks = [
        {
          "type": "header",
          "text": {
            "type": "plain_text",
            "text": "📊 HOWLO Profile Stats",
            "emoji": true
          }
        },
        {
          "type": "divider"
        },
        {
          "type": "section",
          "accessory": {
            "type": "image",
            "image_url": userAvatar || "https://howlo.vercel.app/images/coyote.png",
            "alt_text": userName
          },
          "text": {
            "type": "mrkdwn",
            "text": `*${userName}*\n${hasBingo ? "🎮 *HOWLO LINE Achieved!*\n" : ""}${hasBlackout ? "👑 *DENOUT Achieved!*\n" : ""}`
          }
        },
        {
          "type": "divider"
        },
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": `*📅 ${monthNames[currentMonth]} ${currentYear} Stats*`
          }
        },
        {
          "type": "section",
          "fields": [
            {
              "type": "mrkdwn",
              "text": `*XP Earned:*\n${currentMonthXp} XP`
            },
            {
              "type": "mrkdwn",
              "text": `*Achievements:*\n${currentMonthCount}`
            }
          ]
        }
      ];
      
      // Add rank information if available
      if (userRank) {
        // Format the rank with appropriate suffix (1st, 2nd, 3rd, etc.)
        let rankSuffix;
        if (userRank % 10 === 1 && userRank % 100 !== 11) rankSuffix = "st";
        else if (userRank % 10 === 2 && userRank % 100 !== 12) rankSuffix = "nd";
        else if (userRank % 10 === 3 && userRank % 100 !== 13) rankSuffix = "rd";
        else rankSuffix = "th";
        
        // Add rank display
        profileBlocks.push({
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": `*🏆 Current Rank: ${userRank}${rankSuffix} Place*`
          }
        });
        
        // Add special recognition for top 3
        if (userRank === 1) {
          profileBlocks.push({
            "type": "context",
            "elements": [
              {
                "type": "mrkdwn",
                "text": "🥇 *You're currently in FIRST PLACE!* Keep up the great work!"
              }
            ]
          });
        } else if (userRank === 2) {
          profileBlocks.push({
            "type": "context",
            "elements": [
              {
                "type": "mrkdwn",
                "text": "🥈 *You're in SECOND PLACE!* So close to the top!"
              }
            ]
          });
        } else if (userRank === 3) {
          profileBlocks.push({
            "type": "context",
            "elements": [
              {
                "type": "mrkdwn",
                "text": "🥉 *You're in THIRD PLACE!* On the podium!"
              }
            ]
          });
        } else if (userRank <= 10) {
          profileBlocks.push({
            "type": "context",
            "elements": [
              {
                "type": "mrkdwn",
                "text": "✨ *You're in the top 10!* Keep climbing!"
              }
            ]
          });
        }
      } else {
        // If user has no rank yet (no accomplishments this month)
        profileBlocks.push({
          "type": "section",
          "text": {
            "type": "mrkdwn", 
            "text": "*🏆 Current Rank: Not ranked yet*"
          }
        });
        
        profileBlocks.push({
          "type": "context",
          "elements": [
            {
              "type": "mrkdwn",
              "text": "Log some achievements this month to appear on the leaderboard!"
            }
          ]
        });
      }
      
      // Continue with all-time stats and the rest of the blocks
      profileBlocks.push(
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "*🏆 All-Time Stats*"
          }
        },
        {
          "type": "section",
          "fields": [
            {
              "type": "mrkdwn",
              "text": `*Total XP:*\n${totalXp} XP`
            },
            {
              "type": "mrkdwn",
              "text": `*Total Achievements:*\n${totalAccomplishments}`
            }
          ]
        }
      );
      
      // Add recent activity if available
      if (processedActivity.length > 0) {
        profileBlocks.push(
          {
            "type": "divider"
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*🔄 Recent Activity*"
            }
          }
        );
        
        processedActivity.forEach(acc => {
          profileBlocks.push({
            "type": "context",
            "elements": [
              {
                "type": "image",
                "image_url": "https://howlo.vercel.app/images/coyote.png",
                "alt_text": "Check mark"
              },
              {
                "type": "mrkdwn",
                "text": `*${acc.challenge || 'Unknown challenge'}*\nwith ${acc.taggedUserDisplay} • ${acc.formattedDate}`
              }
            ]
          });
        });
      }
      
      // Add view card button
      profileBlocks.push(
        {
          "type": "divider"
        },
        {
          "type": "actions",
          "elements": [
            {
              "type": "button",
              "text": {
                "type": "plain_text",
                "text": "View Your Full Card",
                "emoji": true
              },
              "url": cardUrl,
              "style": "primary",
              "action_id": "view_full_card"
            }
          ]
        }
      );
      
      // Send the profile message
      await slackClient.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        blocks: profileBlocks,
        text: `HOWLO Profile for ${userName}`
      });
      
      return res.status(200).send();
    } catch (error) {
      console.error('Error fetching profile stats:', error);
      return res.status(500).send('Error fetching profile stats');
    }
  }

  // If no command specified, open the achievement modal (default behavior)
  return openAchievementModal(trigger_id, user_id, channel_id, res);
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
    
    // Handle view_profile button click
    if (action.action_id === "view_profile") {
      try {
        // Get the user ID who clicked the button
        const user_id = payload.user.id;
        const channel_id = payload.channel.id;
        
        // Get Slack client
        const slackClient = getSlackClient();
        
        // Generate token for the user
        const token = generateToken(user_id);
        const cardUrl = buildUrl(process.env.APP_BASE_URL, `howlo/card?token=${token}`);
        
        // Get user info from Slack
        const userInfo = await slackClient.users.info({ user: user_id });
        const userName = userInfo.user.real_name || userInfo.user.name || `<@${user_id}>`;
        const userAvatar = userInfo.user.profile.image_192 || userInfo.user.profile.image_72 || userInfo.user.profile.image_32;
        
        // Get current month and year
        const now = new Date();
        const currentMonth = now.getMonth(); // 0-11 for Jan-Dec
        const currentYear = now.getFullYear();
        const monthNames = ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"];
        
        // Get all accomplishments for this user
        const allUserAccomplishments = await Accomplishment.find({ userId: user_id }).exec();
        
        // Get current month accomplishments
        const currentMonthAccomplishments = allUserAccomplishments.filter(acc => 
          acc.month === currentMonth && acc.year === currentYear
        );
        
        // Calculate stats
        const totalXp = allUserAccomplishments.reduce((sum, acc) => sum + (acc.xp || 0), 0);
        const totalAccomplishments = allUserAccomplishments.length;
        const currentMonthXp = currentMonthAccomplishments.reduce((sum, acc) => sum + (acc.xp || 0), 0);
        const currentMonthCount = currentMonthAccomplishments.length;
        
        // Check for achievements
        const hasBingo = allUserAccomplishments.some(acc => acc.bingoBonus === true);
        const hasBlackout = allUserAccomplishments.some(acc => acc.blackoutBonus === true);
        
        // Get recent activity (last 3 accomplishments from current month)
        const recentActivity = currentMonthAccomplishments
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 3);
        
        // Process tagged users to get display names
        const processedActivity = await Promise.all(recentActivity.map(async (acc) => {
          let taggedUserDisplay = 'Unknown user';
          try {
            if (acc.taggedUser && acc.taggedUser.startsWith('<@') && acc.taggedUser.endsWith('>')) {
              const taggedUserId = acc.taggedUser.substring(2, acc.taggedUser.length - 1);
              const taggedUserInfo = await slackClient.users.info({ user: taggedUserId });
              taggedUserDisplay = taggedUserInfo.user.real_name || taggedUserInfo.user.name || acc.taggedUser;
            } else if (acc.taggedUser) {
              taggedUserDisplay = acc.taggedUser;
            }
          } catch (error) {
            console.warn(`Error getting display name for ${acc.taggedUser}:`, error.message);
          }
          
          return {
            challenge: acc.challenge ? acc.challenge.replace(/<\/?strong>/g, '') : 'Unknown challenge',
            taggedUserDisplay,
            formattedDate: acc.timestamp ? new Date(acc.timestamp).toLocaleDateString() : 'Unknown date'
          };
        }));
        
        // Get the user's current rank on the leaderboard
        const userRank = await getUserRank(user_id, currentMonth, currentYear);
        
        // Create the profile card blocks
        const profileBlocks = [
          {
            "type": "header",
            "text": {
              "type": "plain_text",
              "text": "📊 HOWLO Profile Stats",
              "emoji": true
            }
          },
          {
            "type": "divider"
          },
          {
            "type": "section",
            "accessory": {
              "type": "image",
              "image_url": userAvatar || "https://howlo.vercel.app/images/coyote.png",
              "alt_text": userName
            },
            "text": {
              "type": "mrkdwn",
              "text": `*${userName}*\n${hasBingo ? "🎮 *HOWLO LINE Achieved!*\n" : ""}${hasBlackout ? "👑 *DENOUT Achieved!*\n" : ""}`
            }
          },
          {
            "type": "divider"
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": `*📅 ${monthNames[currentMonth]} ${currentYear} Stats*`
            }
          },
          {
            "type": "section",
            "fields": [
              {
                "type": "mrkdwn",
                "text": `*XP Earned:*\n${currentMonthXp} XP`
              },
              {
                "type": "mrkdwn",
                "text": `*Achievements:*\n${currentMonthCount}`
              }
            ]
          }
        ];
        
        // Add rank information if available
        if (userRank) {
          // Format the rank with appropriate suffix (1st, 2nd, 3rd, etc.)
          let rankSuffix;
          if (userRank % 10 === 1 && userRank % 100 !== 11) rankSuffix = "st";
          else if (userRank % 10 === 2 && userRank % 100 !== 12) rankSuffix = "nd";
          else if (userRank % 10 === 3 && userRank % 100 !== 13) rankSuffix = "rd";
          else rankSuffix = "th";
          
          // Add rank display
          profileBlocks.push({
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": `*🏆 Current Rank: ${userRank}${rankSuffix} Place*`
            }
          });
          
          // Add special recognition for top 3
          if (userRank === 1) {
            profileBlocks.push({
              "type": "context",
              "elements": [
                {
                  "type": "mrkdwn",
                  "text": "🥇 *You're currently in FIRST PLACE!* Keep up the great work!"
                }
              ]
            });
          } else if (userRank === 2) {
            profileBlocks.push({
              "type": "context",
              "elements": [
                {
                  "type": "mrkdwn",
                  "text": "🥈 *You're in SECOND PLACE!* So close to the top!"
                }
              ]
            });
          } else if (userRank === 3) {
            profileBlocks.push({
              "type": "context",
              "elements": [
                {
                  "type": "mrkdwn",
                  "text": "🥉 *You're in THIRD PLACE!* On the podium!"
                }
              ]
            });
          } else if (userRank <= 10) {
            profileBlocks.push({
              "type": "context",
              "elements": [
                {
                  "type": "mrkdwn",
                  "text": "✨ *You're in the top 10!* Keep climbing!"
                }
              ]
            });
          }
        } else {
          // If user has no rank yet (no accomplishments this month)
          profileBlocks.push({
            "type": "section",
            "text": {
              "type": "mrkdwn", 
              "text": "*🏆 Current Rank: Not ranked yet*"
            }
          });
          
          profileBlocks.push({
            "type": "context",
            "elements": [
              {
                "type": "mrkdwn",
                "text": "Log some achievements this month to appear on the leaderboard!"
              }
            ]
          });
        }
        
        // Continue with all-time stats and the rest of the blocks
        profileBlocks.push(
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*🏆 All-Time Stats*"
            }
          },
          {
            "type": "section",
            "fields": [
              {
                "type": "mrkdwn",
                "text": `*Total XP:*\n${totalXp} XP`
              },
              {
                "type": "mrkdwn",
                "text": `*Total Achievements:*\n${totalAccomplishments}`
              }
            ]
          }
        );
        
        // Add recent activity if available
        if (processedActivity.length > 0) {
          profileBlocks.push(
            {
              "type": "divider"
            },
            {
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": "*🔄 Recent Activity*"
              }
            }
          );
          
          processedActivity.forEach(acc => {
            profileBlocks.push({
              "type": "context",
              "elements": [
                {
                  "type": "image",
                  "image_url": "https://howlo.vercel.app/images/coyote.png",
                  "alt_text": "Check mark"
                },
                {
                  "type": "mrkdwn",
                  "text": `*${acc.challenge || 'Unknown challenge'}*\nwith ${acc.taggedUserDisplay} • ${acc.formattedDate}`
                }
              ]
            });
          });
        }
        
        // Add view card button
        profileBlocks.push(
          {
            "type": "divider"
          },
          {
            "type": "actions",
            "elements": [
              {
                "type": "button",
                "text": {
                  "type": "plain_text",
                  "text": "View Your Full Card",
                  "emoji": true
                },
                "url": cardUrl,
                "style": "primary",
                "action_id": "view_full_card"
              }
            ]
          }
        );
        
        // Send the profile message as an ephemeral message
        await slackClient.chat.postEphemeral({
          channel: channel_id,
          user: user_id,
          blocks: profileBlocks,
          text: `HOWLO Profile for ${userName}`
        });
        
    return res.status(200).send();
  } catch (error) {
        console.error('Error handling view_profile action:', error);
        return res.status(500).send('Error displaying profile');
      }
    }
    
    // Handle copy_invite_link button action
    if (action.action_id === "copy_invite_link") {
      try {
        console.log("Copy invite link button clicked");
        // Get the Slack client
        const slackClient = getSlackClient();
        
        // Get the Slack invite link from environment variables
        const inviteLink = process.env.SLACK_INVITE_CODE ? process.env.SLACK_INVITE_CODE.trim() : "https://slack.com/join";
        
        // For mobile users, we'll send a DM instead of opening a modal
        // This allows them to access the link from their DMs where it's easier to share
        await slackClient.chat.postMessage({
          channel: payload.user.id, // Send as DM to the user
          blocks: [
            {
              "type": "header",
              "text": {
                "type": "plain_text",
                "text": "Workspace Invite Link",
                "emoji": true
              }
            },
            {
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": "Here's the invite link to share:"
              }
            },
            {
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": inviteLink
              }
            },
            {
              "type": "context",
              "elements": [
                {
                  "type": "mrkdwn",
                  "text": "💡 *TIP FOR MOBILE:* This link has been sent to your DMs, making it easier to copy or share on mobile devices."
                }
              ]
            }
          ],
          text: `Workspace Invite Link: ${inviteLink}`
        });
        
        // Also respond in the channel with an ephemeral message
        await slackClient.chat.postEphemeral({
          channel: payload.channel.id,
          user: payload.user.id,
          text: "I've sent you the invite link as a direct message for easier sharing on mobile devices. Check your DMs!"
        });
        
    return res.status(200).send();
  } catch (error) {
        console.error('Error handling invite link sharing:', error);
        return res.status(200).send();
      }
    }
    
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

    // Handle reaction buttons (kudos, amazing, great job)
    else if (action.action_id === "give_kudos" || action.action_id === "reaction_amazing" || action.action_id === "reaction_greatjob") {
      try {
        // Extract the accomplishment ID from the value
        const parts = action.value.split('_');
        const accomplishmentId = parts[1];
        
        // Get the user who clicked the button
        const reactingUserId = payload.user.id;
        
        // Get the Slack client
        const slackClient = getSlackClient();
        
        // Get the original accomplishment
        const accomplishment = await Accomplishment.findById(accomplishmentId);
        if (!accomplishment) {
          console.error(`Accomplishment ${accomplishmentId} not found`);
          return res.status(200).send();
        }
        
        // Make sure we're not reacting to our own achievement
        if (accomplishment.userId === reactingUserId) {
          // Quietly ignore self-reactions
          return res.status(200).send();
        }
        
        // Get the reaction type
        const reactionType = action.action_id === "give_kudos" ? "kudos" : 
                             action.action_id === "reaction_amazing" ? "amazing" : "greatJob";
        
        // Initialize reactions if they don't exist
        if (!accomplishment.reactions) {
          accomplishment.reactions = {};
        }
        
        // Initialize specific reaction type if it doesn't exist
        if (!accomplishment.reactions[reactionType]) {
          accomplishment.reactions[reactionType] = [];
        }
        
        // Check if user already reacted
        const alreadyReacted = accomplishment.reactions[reactionType].includes(reactingUserId);
        
        if (alreadyReacted) {
          // Remove the reaction (toggle behavior)
          accomplishment.reactions[reactionType] = accomplishment.reactions[reactionType]
            .filter(id => id !== reactingUserId);
        } else {
          // Add the reaction
          accomplishment.reactions[reactionType].push(reactingUserId);
        }
        
        // Save the updated accomplishment
        await accomplishment.save();
        
        // Update the message with the new reaction counts
        // Get the original message blocks
        const originalMessage = payload.message;
        const blocks = [...originalMessage.blocks]; // Make a copy to modify
        
        // Get user info for the person who reacted
        const reactingUserInfo = await slackClient.users.info({ user: reactingUserId });
        const reactingUserName = reactingUserInfo.user.real_name || reactingUserInfo.user.name || `<@${reactingUserId}>`;
        
        // Count the reactions
        const kudosCount = accomplishment.reactions.kudos ? accomplishment.reactions.kudos.length : 0;
        const amazingCount = accomplishment.reactions.amazing ? accomplishment.reactions.amazing.length : 0;
        const greatJobCount = accomplishment.reactions.greatJob ? accomplishment.reactions.greatJob.length : 0;
        
        // Update the button text to include the counts
        if (blocks[4] && blocks[4].type === "actions") {
          blocks[4].elements[0].text.text = `🐺 Howl Yeah! (${kudosCount})`;
          blocks[4].elements[1].text.text = `🔥 Amazing! (${amazingCount})`;
          blocks[4].elements[2].text.text = `💯 Great job! (${greatJobCount})`;
        }
        
        // Update the message
        await slackClient.chat.update({
          channel: payload.channel.id,
          ts: originalMessage.ts,
          blocks: blocks,
          text: originalMessage.text
        });
        
        // Notify the original poster via ephemeral message (only for new reactions, not removals)
        if (!alreadyReacted) {
          // Map reaction types to emoji and text
          const reactionEmoji = {
            "kudos": "🐺",
            "amazing": "🔥", 
            "greatJob": "💯"
          };
          
          const reactionText = {
            "kudos": "howled in support of",
            "amazing": "thinks it's amazing that",
            "greatJob": "says great job on"
          };
          
          // Send notification to the original poster
          await slackClient.chat.postEphemeral({
            channel: payload.channel.id,
            user: accomplishment.userId,
            text: `${reactionEmoji[reactionType]} ${reactingUserName} ${reactionText[reactionType]} your achievement with ${accomplishment.taggedUser}!`
          });
        }
        
        return res.status(200).send();
  } catch (error) {
        console.error('Error handling reaction:', error);
        return res.status(200).send();
      }
    }
    
    // Handle welcome message buttons
    if (action.action_id === 'howlo_welcome_rules') {
      try {
        // User clicked "See the Rules" button
        // Trigger the same action as /howlo rules
        await handleHowloCommand(payload.user.id, payload.channel.id, 'rules', res);
        return res.status(200).send();
      } catch (error) {
        console.error('Error handling welcome rules button:', error);
        return res.status(200).send();
      }
    }
    
    if (action.action_id === 'howlo_welcome_record') {
      try {
        // User clicked "Record Achievement" button
        // Open the modal to record an achievement
        await openHowloModal(payload.trigger_id, payload.user.id);
        return res.status(200).send();
      } catch (error) {
        console.error('Error handling welcome record button:', error);
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
    let achievement, taggedUser, eventLocation, additionalDetails;
    try {
      achievement = payload.view.state.values.achievement_block.achievement_select.selected_option.value;
      
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
        
        // Check if this workspace user has already been tagged this month
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        
        // Get all accomplishments for this user in the current month
        const existingMonthlyAccomplishments = await Accomplishment.find({
          userId: user_id,
          month: currentMonth,
          year: currentYear
        }).exec();
        
        // Check if any of them has the same tagged user
        const alreadyTaggedThisUser = existingMonthlyAccomplishments.some(acc => 
          acc.taggedUser === taggedUser
        );
        
        // If this user was already tagged this month, get their display name and show an error
        if (alreadyTaggedThisUser) {
          // Get the user's display name from Slack
          try {
            const taggedUserInfo = await slackClient.users.info({ user: workspaceUser });
            const taggedUserName = taggedUserInfo.user.real_name || taggedUserInfo.user.name || taggedUser;
            
      return res.json({
        response_action: "errors",
        errors: {
                tag_input_block: `You've already recorded an achievement with ${taggedUserName} this month. Please tag someone new!`
              }
            });
          } catch (error) {
            // If we can't get the user info, fall back to the user ID
            console.error('Error getting tagged user info:', error);
            return res.json({
              response_action: "errors",
              errors: {
                tag_input_block: `You've already recorded an achievement with this person this month. Please tag someone new!`
              }
            });
          }
        }
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

      // Get the additional details if provided
      additionalDetails = '';
      if (payload.view.state.values.additional_details_block && 
          payload.view.state.values.additional_details_block.additional_details_input) {
        additionalDetails = payload.view.state.values.additional_details_block.additional_details_input.value || '';
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
        challenge: achievement,
        eventLocation: eventLocation,
        additionalDetails: additionalDetails,
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
      
      // Get completed achievements for this user
      const completedAchievements = userAccomplishments.map(a => a.challenge);
      
      // Check for bingo
      const bingoResult = checkForBingo(grid);
      
      // Check if this is the first time user achieved a HOWLO line (formerly bingo)
      let isNewBingo = false;
      if (bingoResult.bingo) {
        const existingBingo = await Accomplishment.findOne({
          userId: user_id,
          month: currentMonth,
          year: currentYear,
          bingoBonus: true
        });
        
        if (!existingBingo) {
          // This is a new HOWLO line
          isNewBingo = true;
          bingoAchieved = true;
          xpEarned += 500;
          
          // Update the accomplishment to include the HOWLO bonus
          await Accomplishment.findByIdAndUpdate(newAcc._id, {
            bingoBonus: true,
            bingoAchieved: true,
            bingoTimestamp: now,
            xp: xpEarned
          });
        }
      }
      
      // Check for blackout (all achievements completed except FREE)
      const allAchievements = getAllChallenges();
      const hasBlackout = allAchievements.every(achievement => 
        completedAchievements.some(completed => completed.trim() === achievement.trim())
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
        // Remove HTML tags from achievement text for the message
        const cleanAchievement = achievement.replace(/<\/?strong>/g, '');
        
        // Generate token for the card URL
        const token = generateToken(user_id);
        const cardUrl = buildUrl(process.env.APP_BASE_URL, `howlo/card?token=${token}`);
        
        // Post public announcement message with a more engaging format
        setTimeout(async () => {
          try {
            // Conversation starter prompts - pick one randomly
            const conversationStarters = [
              "👋 _Have you met these folks? Share your experiences below!_",
              "🤔 _Were you at this event too? Share your highlights!_",
              `💡 _Know ${taggedUser}? Drop a 👋 or share what makes them awesome!_`,
              `🌟 _What was your favorite part of ${eventLocation}? Let's discuss!_`,
              "_Tag someone you met at a recent event to inspire them to join HOWLO!_"
            ];
            
            const randomPrompt = conversationStarters[Math.floor(Math.random() * conversationStarters.length)];
            
            // Build the complete blocks array with all elements properly included
            const announcementBlocks = [
              {
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": `🎯 *Achievement Unlocked!*`
                }
              },
              {
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": `<@${user_id}> connected with *${taggedUser}* at *${eventLocation}*!`
                }
              },
              {
                "type": "context",
                "elements": [
                  {
                    "type": "mrkdwn",
                    "text": `💬 *"${cleanAchievement}"* • *+${xpEarned} XP* gained`
                  }
                ]
              }
            ];
            
            // If additional details were provided, add them to the announcement
            if (additionalDetails && additionalDetails.trim() !== '') {
              announcementBlocks.push({
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": `_"${additionalDetails}"_`
                }
              });
            }
            
            announcementBlocks.push(
              {
                "type": "context",
                "elements": [
                  {
                    "type": "mrkdwn",
                    "text": randomPrompt
                  }
                ]
              },
              {
                "type": "actions",
                "elements": [
                  {
                    "type": "button",
                    "text": {
                      "type": "plain_text",
                      "text": "🐺 Howl Yeah!",
                      "emoji": true
                    },
                    "value": `kudos_${newAcc._id}`,
                    "action_id": "give_kudos"
                  },
                  {
                    "type": "button",
                    "text": {
                      "type": "plain_text",
                      "text": "🔥 Amazing!",
                      "emoji": true
                    },
                    "value": `amazing_${newAcc._id}`,
                    "action_id": "reaction_amazing"
                  },
                  {
                    "type": "button",
                    "text": {
                      "type": "plain_text",
                      "text": "💯 Great job!",
                      "emoji": true
                    },
                    "value": `greatjob_${newAcc._id}`,
                    "action_id": "reaction_greatjob"
                  }
                ]
              }
            );
            
            // Send the message with all blocks properly included
        await slackClient.chat.postMessage({
          channel: channel_id,
              blocks: announcementBlocks,
              text: `🎯 <@${user_id}> completed "${cleanAchievement}" with ${taggedUser} at ${eventLocation}! +${xpEarned} XP gained!`
            });
          } catch (error) {
            console.error('Error posting public announcement:', error);
          }
        }, 1500); // 1.5 second delay

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
            const notificationMessage = `Hey there! *${taggerName}* (<@${user_id}>) just tagged you in a HOWLO achievement: *"${cleanAchievement}"* at *${eventLocation}*.\n\nThey earned *${xpEarned} XP* for this achievement.\n\nWant to record your own achievements? Join the <#C08K0VDQKJ7|howlo> channel and use \`/howlo help\` to get started!`;
            
            await slackClient.chat.postMessage({
              channel: taggedUserId,
              text: notificationMessage,
            });
          }
        } catch (dmError) {
          // If DM fails, just log it but don't stop the process
          console.error('Failed to send DM to tagged user:', dmError);
        }
        
        // If bingo achieved, post celebration message with blocks but without the view card button
        if (bingoAchieved) {
          const bingoToken = generateToken(user_id);
          const bingoCardUrl = buildUrl(process.env.APP_BASE_URL, `howlo/card?token=${bingoToken}`);
          
          // Public message with image but no interactive button
          const bingoPublicBlocks = [
            {
              "type": "header",
              "text": {
                "type": "plain_text",
                "text": "🎉 HOWLO BONUS ACHIEVED! 🎉",
                "emoji": true
              }
            },
            {
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": `*<@${user_id}> has completed a line!* *+500 XP HOWLO Bonus!*`
              }
            },
            {
              "type": "image",
              "title": {
                "type": "plain_text",
                "text": "Winning Card",
                "emoji": true
              },
              "image_url": `${process.env.APP_BASE_URL}/howlo/card-image?token=${bingoToken}`,
              "alt_text": "HOWLO Bingo Card with completed line"
            }
          ];
          
          // Post public message with just the announcement and image
          await slackClient.chat.postMessage({
            channel: channel_id,
            blocks: bingoPublicBlocks,
            text: `🎉 *HOWLO!* 🎉 <@${user_id}> has completed a line! *+500 XP HOWLO Bonus!*`
          });
          
          // Send private message to user with the interactive button
          await slackClient.chat.postEphemeral({
            channel: channel_id,
            user: user_id,
            blocks: [
              {
                "type": "actions",
                "elements": [
                  {
                    "type": "button",
                    "text": {
                      "type": "plain_text",
                      "text": "View Your Full Card",
                      "emoji": true
                    },
                    "url": bingoCardUrl,
                    "style": "primary"
                  }
                ]
              }
            ],
            text: "Click the button below to view your full card:"
          });
        }
        
        // If blackout achieved, post celebration message with blocks but without the view card button
        if (blackoutAchieved) {
          const blackoutToken = generateToken(user_id);
          const blackoutCardUrl = buildUrl(process.env.APP_BASE_URL, `howlo/card?token=${blackoutToken}`);
          
          // Public message with image but no interactive button
          const blackoutPublicBlocks = [
            {
              "type": "header",
              "text": {
                "type": "plain_text",
                "text": "👑 DENOUT ACHIEVED! 👑",
                "emoji": true
              }
            },
            {
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": `*<@${user_id}> has completed ALL achievements!* *+1000 XP Bonus!*`
              }
            },
            {
              "type": "image",
              "title": {
                "type": "plain_text",
                "text": "Blackout Card",
                "emoji": true
              },
              "image_url": `${process.env.APP_BASE_URL}/howlo/card-image?token=${blackoutToken}`,
              "alt_text": "HOWLO Bingo Card with all achievements completed"
            }
          ];
          
          // Post public message with just the announcement and image
          await slackClient.chat.postMessage({
            channel: channel_id,
            blocks: blackoutPublicBlocks,
            text: `👑 *DENOUT ACHIEVED!* 👑 <@${user_id}> has completed ALL achievements! *+1000 XP Bonus!*`
          });
          
          // Send private message to user with the interactive button
          await slackClient.chat.postEphemeral({
            channel: channel_id,
            user: user_id,
            blocks: [
              {
                "type": "actions",
                "elements": [
                  {
                    "type": "button",
                    "text": {
                      "type": "plain_text",
                      "text": "View Your Full Card",
                      "emoji": true
                    },
                    "url": blackoutCardUrl,
                    "style": "primary"
                  }
                ]
              }
            ],
            text: "Click the button below to view your full card:"
          });
        }
        
        // Check for leaderboard changes and announce if needed
        if (!isBeforeLaunch()) {
          const leaderboardChanges = await leaderboardTracker.checkForChanges();
          if (leaderboardChanges) {
            await announceLeaderChange(leaderboardChanges);
          }
        }

        // Send a separate invitation suggestion for external users as an ephemeral message
        if (!taggedUser.startsWith('<@')) {
          // This is an external user (not a workspace member)
          await slackClient.chat.postEphemeral({
            channel: channel_id,
            user: user_id,
            blocks: [
              {
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": `*🤝 Grow The Community*\n\nHey there! I noticed you just tagged *${taggedUser}* who isn't in our workspace yet. Would you like to invite them to join us?`
                }
              },
              {
                "type": "actions",
                "elements": [
                  {
                    "type": "button",
                    "text": {
                      "type": "plain_text",
                      "text": "✉️ Get Invite Link",
                      "emoji": true
                    },
                    "style": "primary",
                    "action_id": "copy_invite_link"
                  }
                ]
              }
            ],
            text: `Would you like to invite ${taggedUser} to the workspace?`
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
          achievement_block: "Failed to save accomplishment. Please try again."
        }
      });
    }
  }
  
  // For other interaction types, send a basic 200 response
  res.status(200).send();
});

// Helper function to open the achievement modal
async function openAchievementModal(trigger_id, user_id, channel_id, res) {
  try {
    // Get user's accomplishments to filter out completed achievements
    const userAccomplishments = await Accomplishment.find({ userId: user_id }).exec();
    const completedAchievements = userAccomplishments.map(a => a.challenge.trim());
    
    // Filter available achievements
    const availableAchievements = bingoCard
      .filter(achievement => achievement !== "FREE" && !completedAchievements.includes(achievement.trim()))
      .map(achievement => {
        // Strip HTML tags for dropdown and truncate if needed
        let cleanText = achievement.replace(/<\/?strong>/g, '');
        // Ensure text is under 75 chars for Slack's limits
        if (cleanText.length > 75) {
          cleanText = cleanText.substring(0, 72) + '...';
        }
        return {
          text: {
            type: "plain_text",
            text: cleanText
          },
          value: achievement
        };
      });
    
    // If no achievements are available, show a message
    if (availableAchievements.length === 0) {
      await getSlackClient().chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: "Congratulations! 🎉 You've unlocked all Achievements on the HOWLO card! View your progress with `/howlo card`."
      });
      return res.status(200).send();
    }
    
    await getSlackClient().views.open({
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
            block_id: "achievement_block",
            label: {
              type: "plain_text",
              text: "Choose an achievement *"
            },
            element: {
              type: "static_select",
              action_id: "achievement_select",
              placeholder: {
                type: "plain_text",
                text: "Select an achievement..."
              },
              options: availableAchievements
            }
          },
          {
            type: "header",
                    text: {
                      type: "plain_text",
              text: "Who did you meet?",
              emoji: true
            }
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: "Please use *exactly one* of the following input methods:"
              }
            ]
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*➡️ Option 1:* Tag someone from this workspace"
            }
          },
          {
            type: "input",
            block_id: "tag_input_block",
            optional: true,
            label: {
              type: "plain_text",
              text: "Select workspace member"
            },
            element: {
              type: "users_select",
              action_id: "tag_workspace_input",
              placeholder: {
                type: "plain_text",
                text: "Search for a workspace member"
              }
            }
          },
          {
            type: "divider"
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*➡️ Option 2:* Enter a name for someone outside the workspace"
            }
          },
          {
            type: "input", 
            block_id: "external_name_block",
            optional: true,
            label: {
              type: "plain_text",
              text: "Enter external name"
            },
            element: {
              type: "plain_text_input",
              action_id: "external_name_input",
              placeholder: {
                type: "plain_text",
                text: "For someone not in this workspace"
              }
            }
          },
          {
            type: "divider"
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
          },
          {
            type: "input",
            block_id: "additional_details_block",
            optional: true,
            label: {
              type: "plain_text",
              text: "Tell us more"
            },
            element: {
              type: "plain_text_input",
              action_id: "additional_details_input",
              multiline: true,
              placeholder: {
                type: "plain_text",
                text: "Share something interesting from your conversation, what you learned, or why this connection was meaningful..."
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
}

// Helper function to get a user's current rank on the leaderboard
async function getUserRank(userId, month, year) {
  try {
    // Query to get all users sorted by XP
    const leaderboard = await Accomplishment.aggregate([
      { 
        $match: { month: month, year: year } 
      },
      {
        $group: {
          _id: "$userId",
          totalXp: { $sum: "$xp" },
          accomplishmentCount: { $sum: 1 }
        }
      },
      { 
        $sort: { totalXp: -1, accomplishmentCount: -1 } 
      }
    ]);
    
    // Find the user's position in the leaderboard
    const userIndex = leaderboard.findIndex(user => user._id === userId);
    
    // Return the rank (add 1 because array indices start at 0)
    // Return null if user is not on the leaderboard
    return userIndex !== -1 ? userIndex + 1 : null;
  } catch (error) {
    console.error('Error getting user rank:', error);
    return null;
  }
}

// Add this route handler for Slack events
router.post('/events', async (req, res) => {
  const { body } = req;
  
  // Verify URL challenge (required for setup)
  if (body.type === 'url_verification') {
    return res.json({ challenge: body.challenge });
  }
  
  // Return 200 OK immediately to acknowledge receipt
  res.status(200).send();
  
  // Process the event asynchronously
  try {
    const event = body.event;
    
    // Handle member joined channel event
    if (event.type === 'member_joined_channel') {
      const channelId = event.channel;
      const userId = event.user;
      
      // Check if this is the HOWLO channel
      const howloChannelId = process.env.HOWLO_CHANNEL_ID || 'C08K0VDQKJ7';
      
      if (channelId === howloChannelId) {
        // Don't welcome the bot itself
        if (userId !== body.bot_id) {
          // Get Slack client
          const slackClient = await getSlackClient();
          
          // Send welcome message
          await slackClient.chat.postEphemeral({
            channel: channelId,
            user: userId,
            blocks: [
              {
                "type": "header",
                "text": {
                  "type": "plain_text",
                  "text": "🐺 Welcome to HOWLO! 🐺",
                  "emoji": true
                }
              },
              {
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": "Hey <@" + userId + ">! Welcome to the HOWLO game - a fun way to track and celebrate your social connections!"
                }
              },
              {
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": "*Here's how to get started:*\n• Check out the *How to Play HOWLO* tab at the top of this channel\n• OR Type `/howlo help` to see all available commands\n• Use `/howlo` to record your first achievement"
                }
              },
            ],
            text: "Welcome to HOWLO! Type `/howlo help` to get started."
          });
        }
      }
    }
  } catch (error) {
    console.error('Error handling Slack event:', error);
  }
});

export const slackRoutes = router;

