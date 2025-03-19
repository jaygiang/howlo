import { WebClient } from '@slack/web-api';

// Initialize Slack Web API with your OAuth token
let slackClient;

export function getSlackClient() {
  if (!slackClient) {
    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (!slackToken) {
      throw new Error('SLACK_BOT_TOKEN environment variable is not set');
    }
    slackClient = new WebClient(slackToken);
  }
  return slackClient;
}
