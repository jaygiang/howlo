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
    // Redirect to card command since we're consolidating them
    return res.status(200).send({ text: "The progress command is now merged with the card command. Please use `/howlo card` instead." });
  } else if (trimmedText.toLowerCase() === 'card') {
    // Generate a visual representation of the user's progress card for Slack
    const token = generateToken(user_id);
    const cardUrl = buildUrl(process.env.APP_BASE_URL, `howlo/card?token=${token}`);
    
    try {
      // Generate the card blocks for the user's progress
      const cardBlocks = await generateCardBlocks(user_id, token, false);
      console.log('Card blocks generated:', JSON.stringify(cardBlocks, null, 2));
      
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
    // New 'rules' command that displays the game rules in markdown format
    try {
      const rulesMarkdown = `

      *How to Play HOWLO*
      
      Hey Social Coyotes! 🤝🐺
      We're launching *HOWLO BINGO*—a fun way to meet new pack members at San Diego tech events!
      
      *🎮 How to Play:*
          • Type \`/howlo\` in @howlo channel to record your first achievement and get started  
          • Use \`/howlo rules\` to review commands and game details
          • Use \`/howlo help\` to see all available commands  
          • Log an achievement with \`/howlo\`  
          • See your HOWLO card with \`/howlo card\`
          • View your profile stats with \`/howlo stats\` or \`/howlo profile\`  
          • View the leaderboard with \`/howlo leaderboard\`  
      
      *🏆 Achievements:*
      Each achievement asks you to connect with someone new in a meaningful way:
          • "Share a personal story"
          • "Find someone with a shared hobby"
          • "Schedule a follow-up coffee chat" ☕
      
      *✅ Logging an Achievement:*
          • Type \`/howlo\` in this Slack channel  
          • Select your completed achievement  
          • Tag the person you connected with (they may not be pinged)  
          • Input the event location  
      
      *📊 Viewing Your HOWLO Board:*
          • Use \`/howlo card\`  
          • Click the link provided to see your current card  
      
      *🎯 Getting a BINGO:*
      You know how BINGO works, right? If not:
          • Complete a row of 5, a column of 5, or a diagonal of 5
          • Let out a victory HOWL! 🐺  
      
      *🏅 Get Competitive!*
          • Use \`/howlo leaderboard\` to see the top coyotes 🏆  


      *📊 Experience Points (XP) System:*
          • Each completed achievement: *+100 XP*
          • Getting a BINGO (completing a row/column/diagonal): *+500 XP Bonus*
          • Achieving BLACKOUT (all achievements completed): *+1000 XP Bonus*
          • XP is used to determine your rank on the leaderboard


      *🔄 Monthly Resets:*
          • The leaderboard resets at the beginning of each month
          • Your achievements are recorded permanently on your profile
          • Monthly winners are announced and celebrated
          • After reset, you can complete achievements again to earn XP for the new month
          • Your all-time stats will continue to grow across months
      
      *🔕 Too Many Notifications?*
          • Right-click on this channel > *"Change notifications"*
          • Select *"Only @mentions and keywords"*
          • Or mute it completely with **"Nothing"*
      
      *🖨️ Analog Option:*
          • Print your HOWLO card and bring it to events!  
          • Nothing says "I'm here to connect!" like pulling out a physical bingo card and asking someone to initial a square.
            The confused looks are half the fun!🤣
      
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
  } else if (trimmedText.toLowerCase() === 'help') {
    // Display a help message with all available commands
    try {
      const helpMarkdown = `
      *How to Play HOWLO*

      Hey Social Coyotes! 🤝🐺
      
      We're launching *HOWLO BINGO* - a fun way to meet new pack members at San Diego tech events!
      
      
      *🎮 1. How to Play:*
      
          • Type \`/howlo\` in @howlo channel to record your first achievement and get started 
          • \`/howlo rules\` to review commands and game details
          • Log an achievement \`/howlo\`
          • See your HOWLO card \`/howlo card\`
          • View your profile stats \`/howlo stats\` or \`/howlo profile\`
          • View the leaderboard \`/howlo leaderboard\`
      
      
      *2. Each achievement asks you to connect with someone new in a meaningful way:*
      
          • "Share a personal story"
          • "Find someone with a shared hobby"
          • "Schedule a follow-up coffee chat" ☕
      
      *3. Log a completed achievement:*
      
          • Type \`/howlo\` in this Slack channel 
          • Select your achievement 
          • Tag the person you connected with (they may not be pinged)
          • Input the event location
      
      *4. To see your HOWLO board:*
      
          • Command \`/howlo card\`
          • Click on the link provided
      
      *5. To see your profile stats and achievements:*
      
          • Command \`/howlo stats\` or \`/howlo profile\`
          • View your current month stats, all-time stats, and recent activity
      
      *6. You know how "bingo" works right? If not:*
      
          • Complete a row of 5, column of 5, or diagonal of 5
          • Let out a victory HOWL! 🐺
      
      *7. Let's get competitive!*
      
          • Command \`/howlo leaderboard\` to see the top coyotes


      *📊 Experience Points (XP) System:*
      
          • Each completed achievement: *+100 XP*
          • Getting a BINGO (completing a row/column/diagonal): *+500 XP Bonus*
          • Achieving BLACKOUT (all achievements completed): *+1000 XP Bonus*
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
      const userAvatar = userInfo.user.profile.image_192;
      
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
            "text": `*${userName}*\n${hasBingo ? "🎮 *BINGO Achieved!*\n" : ""}${hasBlackout ? "👑 *BLACKOUT Achieved!*\n" : ""}`
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
        },
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
      ];
      
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

  // Open modal for new accomplishment
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
      await slackClient.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: "Congratulations! 🎉 You've unlocked all Achievements on the HOWLO card! View your progress with `/howlo progress`."
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
        const userAvatar = userInfo.user.profile.image_192;
        
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
              "text": `*${userName}*\n${hasBingo ? "🎮 *BINGO Achieved!*\n" : ""}${hasBlackout ? "👑 *BLACKOUT Achieved!*\n" : ""}`
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
          },
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
        ];
        
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
    let achievement, taggedUser, eventLocation;
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
        challenge: achievement,
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
      
      // Get completed achievements for this user
      const completedAchievements = userAccomplishments.map(a => a.challenge);
      
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
        
        // Create nicely formatted blocks for the accomplishment message
        const accomplishmentBlocks = [
          {
            "type": "header",
            "text": {
              "type": "plain_text",
              "text": "🎉 Achievement Unlocked! 🎉",
              "emoji": true
            }
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": `<@${user_id}> completed *"${cleanAchievement}"* with *${taggedUser}* at *${eventLocation}*!`
            }
          },
          {
            "type": "section",
            "fields": [
              {
                "type": "mrkdwn",
                "text": `*XP Gained:*\n+${xpEarned} XP`
              }
            ]
          }
        ];
        
        // Add special blocks for bingo and blackout
        if (bingoAchieved) {
          accomplishmentBlocks.push({
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "🎮 *BINGO BONUS!* +500 XP for completing a row!"
            }
          });
        }
        
        if (blackoutAchieved) {
          accomplishmentBlocks.push({
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "👑 *BLACKOUT BONUS!* +1000 XP for unlocking all achievements!"
            }
          });
        }
        
        // Add card image and action buttons
        accomplishmentBlocks.push(
          {
            "type": "image",
            "title": {
              "type": "plain_text",
              "text": "Current Progress",
              "emoji": true
            },
            "image_url": `${process.env.APP_BASE_URL}/howlo/card-image?token=${token}`,
            "alt_text": "HOWLO Bingo Card Progress"
          },
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
              },
              {
                "type": "button",
                "text": {
                  "type": "plain_text",
                  "text": "View Profile Stats",
                  "emoji": true
                },
                "action_id": "view_profile"
              }
            ]
          }
        );
        
        // Post the formatted message as ephemeral (only visible to the user)
        await slackClient.chat.postEphemeral({
          channel: channel_id,
          user: user_id,
          blocks: accomplishmentBlocks,
          text: `Accomplishment recorded for <@${user_id}>: "${cleanAchievement}" with ${taggedUser}! +${xpEarned} XP gained!`
        });

        // Add a simple public announcement message (without the card image)
        await slackClient.chat.postMessage({
          channel: channel_id,
          text: `🎉 <@${user_id}> completed *"${cleanAchievement}"* with *${taggedUser}* at *${eventLocation}*! *+${xpEarned} XP gained!*`,
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
            const notificationMessage = `Hey there! *${taggerName}* (<@${user_id}>) just tagged you in a HOWLO achievement: *"${cleanAchievement}"* at *${eventLocation}*.\n\nThey earned *${xpEarned} XP* for this achievement.\n\nWant to record your own achievements? Use \`/howlo\` to get started!`;
            
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
                "text": "🎉 BINGO ACHIEVED! 🎉",
                "emoji": true
              }
            },
            {
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": `*<@${user_id}> has completed a line!* *+500 XP Bonus!*`
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
            text: `🎉 *HOWLO!* 🎉 <@${user_id}> has completed a line! *+500 XP Bonus!*`
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
                "text": "👑 BLACKOUT ACHIEVED! 👑",
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
            text: `👑 *BLACKOUT ACHIEVED!* 👑 <@${user_id}> has completed ALL achievements! *+1000 XP Bonus!*`
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

export const slackRoutes = router;

