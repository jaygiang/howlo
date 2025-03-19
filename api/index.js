// Main API entry point for Vercel
import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { connectToMongoDB } from '../lib/db.js';
import { bingoRoutes } from '../lib/routes/bingo.js';
import { slackRoutes } from '../lib/routes/slack.js';

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
      <script defer src="https://cdn.vercel-insights.com/v1/script.js"></script>
    </head>
    <body>
      <h1>HOWLO Bingo Server is running!</h1>
      <p>Use the Slack app to interact with the bingo game.</p>
    </body>
    </html>
  `);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Export for Vercel
export default app;

// Only listen on a port when running directly (not when imported by Vercel)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Use ngrok http ${PORT} to expose your server`);
  });
}
