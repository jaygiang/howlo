import chromium from 'chrome-aws-lambda';
import sharp from 'sharp';
import { buildUrl } from './url.js';

/**
 * Captures a screenshot of a user's bingo card
 * @param {string} userId - The user ID
 * @param {string} token - Authentication token
 * @param {boolean} isBlank - Whether to capture a blank card or the user's progress
 * @returns {Promise<Buffer>} - Promise resolving to an image buffer
 */
export async function captureCardScreenshot(userId, token, isBlank = false) {
  // Create the URL to capture
  const cardPath = isBlank ? 'howlo/blank-card' : 'howlo/card';
  const cardUrl = buildUrl(process.env.APP_BASE_URL, `${cardPath}?token=${token}`);
  
  console.log(`Capturing screenshot of ${cardUrl}`);
  
  let browser = null;
  try {
    // Launch a headless browser
    browser = await chromium.puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1200, height: 1200 },
      executablePath: await chromium.executablePath,
      headless: true,
    });

    // Open a new page
    const page = await browser.newPage();
    
    // Navigate to the card URL
    await page.goto(cardUrl, { waitUntil: 'networkidle0', timeout: 15000 });
    
    // Wait for card to render
    await page.waitForSelector('table', { timeout: 10000 });
    
    // Capture the main bingo table only
    const tableElement = await page.$('table:not(:first-child)');
    
    if (!tableElement) {
      throw new Error('Could not find bingo table element');
    }
    
    // Take screenshot of just the table
    const screenshotBuffer = await tableElement.screenshot({
      type: 'png',
      omitBackground: false,
    });

    // Optimize the image
    const optimizedBuffer = await sharp(screenshotBuffer)
      .resize({ width: 800 })
      .png({ quality: 90 })
      .toBuffer();
      
    return optimizedBuffer;
  } catch (error) {
    console.error('Error capturing screenshot:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
} 