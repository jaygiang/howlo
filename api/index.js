// Main API entry point for Vercel
import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { connectToMongoDB } from '../lib/db.js';
import { bingoRoutes } from '../lib/routes/bingo.js';
import { slackRoutes } from '../lib/routes/slack.js';
import { checkMonthTransition } from '../lib/utils/monthlyTransition.js';

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// Connect to MongoDB
connectToMongoDB();

// Routes
app.use('/howlo', bingoRoutes);
app.use('/slack', slackRoutes);

// Root route
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>HOWLO Bingo</title>
      <link rel="icon" type="image/png" href="/images/coyote.png">
      <link rel="apple-touch-icon" href="/images/coyote.png">
      <script defer src="https://cdn.vercel-insights.com/v1/script.js"></script>
      <style>
        body {
          font-family: sans-serif;
          margin: 0;
          padding: 20px;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }
        main {
          flex: 1;
        }
        footer {
          margin-top: 50px;
          padding: 15px;
          background-color: #000;
          color: #fff;
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          box-sizing: border-box;
          margin-left: -20px;
          margin-right: -20px;
          width: calc(100% + 40px);
        }
        .footer-left {
          flex: 1;
        }
        .footer-center {
          flex: 2;
          text-align: center;
        }
        .footer-right {
          flex: 1;
          text-align: right;
          padding-right: 20px;
          font-size: 12px;
        }
        footer a {
          color: #e52b2b;
          text-decoration: none;
        }
        footer a:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <main>
        <h1>HOWLO Bingo Server is running!</h1>
        <p>Use the Slack app to interact with the bingo game.</p>
      </main>
      <footer>
        <div class="footer-left"></div>
        <div class="footer-center">
          <a href="https://howl.thesocialcoyote.com/subscribe?ref=MsUtC8osC1&_bhlid=7fecfad9eb7fd8bcdb529e945e11346b5897acdc" target="_blank">Join the pack</a>
        </div>
        <div class="footer-right">
          Created by <a href="https://github.com/jaygiang/" target="_blank">Jay</a>
        </div>
      </footer>
    </body>
    </html>
  `);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Export for Vercel
export default app;

// Check for month transition on server start
checkMonthTransition().catch(err => {
  console.error('Error during month transition check:', err);
});

// Set up a daily scheduled check for month transition using a simple interval
// In production, you would use a proper cron/scheduler like node-cron or a cloud scheduler
setInterval(async () => {
  try {
    // Get current date
    const now = new Date();
    // If it's midnight (or close to it), run the month transition check
    if (now.getHours() === 0 && now.getMinutes() < 5) {
      console.log('Running scheduled month transition check...');
      await checkMonthTransition();
    }
  } catch (error) {
    console.error('Error in scheduled month transition check:', error);
  }
}, 5 * 60 * 1000); // Check every 5 minutes

// Only listen on a port when running directly (not when imported by Vercel)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Use ngrok http ${PORT} to expose your server`);
  });
}
