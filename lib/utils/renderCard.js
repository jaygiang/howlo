import sharp from 'sharp';
import path from 'path';
import { Accomplishment } from '../models/Accomplishment.js';
import { bingoCard } from './bingoCard.js';

// Configure Sharp to use the custom fonts
const fontConfigPath = path.join(process.cwd(), 'fonts', 'fonts.conf');
const fontPath = path.join(process.cwd(), 'fonts', 'Arial.ttf');

sharp.cache(false);
if (process.env.NODE_ENV === 'production') {
  process.env.FONTCONFIG_PATH = '/var/task/fonts';
  process.env.LD_LIBRARY_PATH = '/var/task';
}

/**
 * Directly renders a bingo card as an image
 * @param {string} userId - The user ID
 * @param {boolean} isBlank - Whether to render a blank card
 * @returns {Promise<Buffer>} - Promise resolving to an image buffer
 */
export async function renderBingoCardImage(userId, isBlank = false) {
  try {
    // Set up the canvas dimensions - increased for larger card
    const canvasWidth = 1230;
    const canvasHeight = 1500; // Increased for XP display 
    const cellSize = 210;  // Larger cells
    const padding = 15;    // Increased padding
    
    // Create a white background
    const background = await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background: { r: 245, g: 245, b: 245, alpha: 1 }
      }
    }).png().toBuffer();
    
    // Get user accomplishments if we're not generating a blank card
    let userAccomplishments = [];
    let totalXp = 0;
    let month = 0;
    let year = 0;
    let bingoAchieved = false;
    let blackoutAchieved = false;
    
    if (!isBlank) {
      // Get current month/year for XP tracking
      const now = new Date();
      month = now.getMonth(); // 0-11 for Jan-Dec
      year = now.getFullYear();
      
      // Get user's accomplishments for current month
      userAccomplishments = await Accomplishment.find({ 
        userId: userId,
        month: month,
        year: year
      }).exec();
      
      // Calculate total XP
      totalXp = userAccomplishments.reduce((sum, acc) => sum + acc.xp, 0);
      
      // Check for bingo and blackout status
      bingoAchieved = userAccomplishments.some(acc => acc.bingoBonus);
      blackoutAchieved = userAccomplishments.some(acc => acc.blackoutBonus);
    }
    
    // Create 25 cells
    const composites = [];
    
    // Add the HOWLO header
    const letters = ['H', 'O', 'W', 'L', 'O'];
    for (let i = 0; i < 5; i++) {
      const svgHeader = `
        <svg width="${cellSize}" height="120">
          <rect width="${cellSize}" height="120" fill="black" rx="10" ry="10" />
          <text x="${cellSize/2}" y="85" font-family="Arial" font-size="90" font-weight="bold" text-anchor="middle" fill="white">${letters[i]}</text>
        </svg>
      `;
      
      const headerBuffer = await sharp(Buffer.from(svgHeader)).png().toBuffer();
      
      composites.push({
        input: headerBuffer,
        left: i * (cellSize + padding) + 50,
        top: 30
      });
    }
    
    // Create the bingo grid
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const index = row * 5 + col;
        const challenge = bingoCard[index];
        
        // Check if this cell is completed
        const isCompleted = isBlank 
          ? (challenge === "FREE") 
          : (challenge === "FREE" || userAccomplishments.some(acc => acc.challenge.trim() === challenge));
        
        // Clean the challenge text - completely remove HTML tags
        let cleanChallenge = '';
        if (challenge === "FREE") {
          cleanChallenge = "FREE";
        } else {
          // Remove HTML tags completely
          cleanChallenge = challenge.replace(/<\/?strong>/g, '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        }
        
        // Split text into main text and bonus text
        let mainText = cleanChallenge;
        let bonusText = '';
        
        // Extract bonus text (content in parentheses)
        const bonusMatch = cleanChallenge.match(/\(([^)]+)\)/);
        if (bonusMatch) {
          // Remove the bonus text from main text
          mainText = cleanChallenge.replace(/\s*\([^)]+\)/, '');
          bonusText = bonusMatch[0]; // The full match including parentheses
        }
        
        // Format the main text with word wrapping
        const words = mainText.split(' ');
        let formattedMainText = '';
        let currentLine = '';
        const maxCharsPerLine = 22; // Adjusted for better fit
        
        // Create formatted text with line breaks
        for (const word of words) {
          if ((currentLine.length + word.length + 1) <= maxCharsPerLine) {
            // Add word to current line
            currentLine += (currentLine ? ' ' : '') + word;
          } else {
            // Start a new line
            formattedMainText += (formattedMainText ? '\n' : '') + currentLine;
            currentLine = word;
          }
        }
        // Add the last line
        if (currentLine) {
          formattedMainText += (formattedMainText ? '\n' : '') + currentLine;
        }
        
        // Create an SVG for this cell - using SVG text elements instead of HTML
        const cellColor = isCompleted ? 'rgba(231, 56, 61, 0.25)' : 'white';
        
        // Calculate text lines for proper positioning
        const lines = formattedMainText.split('\n');
        const lineHeight = 20; // Height of each line
        
        // Start Y position for text (centered based on number of lines)
        const totalTextHeight = (lines.length * lineHeight) + (bonusText ? 25 : 0);
        const startY = ((cellSize - 24) / 2) - (totalTextHeight / 2) + 12 + 20; // +20 for first line offset
        
        // Create SVG text elements for each line
        let textElements = '';
        lines.forEach((line, i) => {
          textElements += `<text x="${cellSize/2}" y="${startY + (i * lineHeight)}" 
                               font-family="Arial" font-size="16" text-anchor="middle" fill="black">${line}</text>`;
        });
        
        // Add bonus text if it exists
        let bonusTextElement = '';
        if (bonusText) {
          bonusTextElement = `<text x="${cellSize/2}" y="${startY + (lines.length * lineHeight) + 20}" 
                                  font-family="Arial" font-size="14" text-anchor="middle" fill="#666">${bonusText}</text>`;
        }
        
        // Remove checkmark for completed cells
        let checkmarkElement = '';
        
        const svgCell = `
          <svg width="${cellSize}" height="${cellSize}">
            <rect width="${cellSize}" height="${cellSize}" rx="15" ry="15" fill="${cellColor}" stroke="${isCompleted ? '#E7383D' : '#ccc'}" stroke-width="3" />
            ${textElements}
            ${bonusTextElement}
            ${checkmarkElement}
          </svg>
        `;
        
        // Debug the SVG content
        if (row === 0 && col === 0) {
          console.log('SVG for first cell:', svgCell);
        }
        
        const cellBuffer = await sharp(Buffer.from(svgCell)).png().toBuffer();
        
        // Calculate position
        const posX = col * (cellSize + padding) + 50;
        const posY = row * (cellSize + padding) + 200; // Increased offset from header
        
        // Add to composites
        composites.push({
          input: cellBuffer,
          left: posX,
          top: posY
        });
      }
    }
    
    // Add XP summary section if not a blank card
    if (!isBlank) {
      // Month names for display
      const monthNames = ["January", "February", "March", "April", "May", "June", 
                           "July", "August", "September", "October", "November", "December"];
      
      // Create XP summary
      const completedCount = userAccomplishments.filter(acc => acc.challenge !== "FREE").length;
      const bingoCount = userAccomplishments.filter(acc => acc.bingoBonus).length;
      
      // Calculate breakdown
      const baseXp = completedCount * 100;
      const bingoXp = bingoCount * 500;
      const blackoutXp = blackoutAchieved ? 1000 : 0;
      
      // Create XP summary section
      const xpSummarySvg = `
        <svg width="${canvasWidth - 100}" height="180">
          <rect width="${canvasWidth - 100}" height="180" rx="15" ry="15" fill="#f1f5f9" stroke="#ccc" stroke-width="2" />
          
          <text x="${(canvasWidth - 100) / 2}" y="35" font-family="Arial" font-size="24" font-weight="bold" text-anchor="middle" fill="#333">
            XP Summary - ${monthNames[month]} ${year}
          </text>
          <text x="${(canvasWidth - 100) / 2}" y="70" font-family="Arial" font-size="28" font-weight="bold" text-anchor="middle" fill="#E7383D">
            Total XP: ${totalXp}
          </text>
          
          <text x="30" y="110" font-family="Arial" font-size="16" fill="#333">
            Achievements: ${completedCount} x 100 = ${baseXp} XP
          </text>
          <text x="30" y="135" font-family="Arial" font-size="16" fill="#333">
            Howlo Bonus: ${bingoCount} x 500 = ${bingoXp} XP
          </text>
          <text x="30" y="160" font-family="Arial" font-size="16" fill="#333">
            Denout Bonus: ${blackoutAchieved ? "1000" : "0"} XP
          </text>
          
          ${bingoAchieved ? 
            `<text x="${(canvasWidth - 100) - 150}" y="125" font-family="Arial" font-size="22" font-weight="bold" text-anchor="middle" fill="#E7383D">
              🎮 HOWLO Achieved!
            </text>` : ''}
          
          ${blackoutAchieved ? 
            `<text x="${(canvasWidth - 100) - 150}" y="155" font-family="Arial" font-size="22" font-weight="bold" text-anchor="middle" fill="#E7383D">
              👑 Denout Achieved!
            </text>` : ''}
        </svg>
      `;
      
      const xpSummaryBuffer = await sharp(Buffer.from(xpSummarySvg)).png().toBuffer();
      
      // Add XP summary to composites
      composites.push({
        input: xpSummaryBuffer,
        left: 50,
        top: canvasHeight - 200 // Position at bottom of card
      });
    }
    
    // Compose the final image
    const cardImage = await sharp(background)
      .composite(composites)
      .png()
      .toBuffer();
    
    return cardImage;
  } catch (error) {
    console.error('Error rendering bingo card image:', error);
    throw error;
  }
} 