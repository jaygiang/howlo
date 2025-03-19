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
app.use('/bingo', bingoRoutes);
app.use('/slack', slackRoutes);

// Root route
app.get('/', (req, res) => {
  res.send('Server is running!');
});

// Export for Vercel
export default app;
