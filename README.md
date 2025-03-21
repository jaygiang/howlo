# HOWLO Bingo

A Slack app for networking bingo challenges, deployed on Heroku.

## Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Create a `.env` file based on `.env.example`
4. Run locally: `npm run dev`

## Deployment on Heroku

To deploy this application on Heroku:

1. Create a Heroku account if you don't have one
2. Install the Heroku CLI and login: `heroku login`
3. Create a new Heroku app: `heroku create your-app-name`
4. Set up environment variables:
   ```
   heroku config:set MONGODB_URI=your_mongodb_uri
   heroku config:set SLACK_BOT_TOKEN=your_slack_token
   heroku config:set APP_BASE_URL=https://your-app-name.herokuapp.com
   heroku config:set SECRET_KEY=your_secret_key
   heroku config:set ANNOUNCEMENTS_CHANNEL_ID=your_channel_id
   ```
5. Push your code to Heroku: `git push heroku main`
6. Ensure at least one dyno is running: `heroku ps:scale web=1`
7. Open the app: `heroku open`

### Keeping Dynos Active

Heroku free tier dynos sleep after 30 minutes of inactivity. To keep your app responsive:

1. Enable Heroku's Eco Dyno to have much better uptime than free tier
2. Or use a service like UptimeRobot to ping your app every 20 minutes

## Structure

- `api/` - Serverless API endpoints
- `lib/` - Application logic
- `public/` - Static assets
