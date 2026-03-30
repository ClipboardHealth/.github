
const SLACK_MESSAGE = (prUrl, slackUserId) =>
  `Hey <@${slackUserId}>! Your PR ${prUrl} was opened by the Devin.ai bot account instead of your GitHub account. ` +
  `Please set up your Devin GitHub integration so PRs are properly attributed to you. ` +
  `See <https://www.notion.so/Getting-Started-with-Devin-ai-1a48643321f4806bbbf3d329ac619857?source=copy_link#1a48643321f4800fb2b1d9b3581f6744|this documentation> ` +
  `for details. Make sure to follow the first 4 bullet points through the entire Setup the Devin.ai/Github integration toggle.\n` +
  `You may need to link and unlink your username in the the Devin.ai/Github integration. If you have followed all these steps, and are ` +
  `still getting this message, reach out to Ian Ornstein for debugging.`;

// Same message used as a PR comment fallback when Slack lookup fails
const PR_COMMENT_MESSAGE = (username) =>
  `👋 @${username} — This PR was opened by the \`devin-ai-integration[bot]\` account instead of your personal GitHub account.\n\n` +
  `Please set up your [Devin/GitHub integration](https://www.notion.so/Getting-Started-with-Devin-ai-1a48643321f4806bbbf3d329ac619857?source=copy_link#1a48643321f4800fb2b1d9b3581f6744) so PRs are properly attributed to you.`;

const PR_COMMENT_MARKER = "<!-- devin-attribution-check -->";

async function lookupSlackUserByEmail(slackToken, email) {
  const response = await fetch("https://slack.com/api/users.lookupByEmail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `email=${encodeURIComponent(email)}`,
  });
  return response.json();
}

async function openSlackConversation(slackToken, slackUserId) {
  const response = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ users: slackUserId }),
  });
  return response.json();
}

async function sendSlackMessage(slackToken, channelId, text) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel: channelId, text }),
  });
  return response.json();
}

async function sendSlackDm(core, slackToken, email, prUrl) {
  const lookupData = await lookupSlackUserByEmail(slackToken, email);
  if (!lookupData.ok) {
    core.warning(`Slack email lookup failed for ${email}: ${lookupData.error}`);
    return false;
  }

  const slackUserId = lookupData.user.id;
  core.info(`Found Slack user ${slackUserId} for ${email}`);

  const convData = await openSlackConversation(slackToken, slackUserId);
  if (!convData.ok) {
    core.warning(`Failed to open Slack conversation: ${convData.error}`);
    return false;
  }

  const msgData = await sendSlackMessage(
    slackToken,
    convData.channel.id,
    SLACK_MESSAGE(prUrl, slackUserId),
  );
  if (!msgData.ok) {
    core.warning(`Failed to send Slack DM: ${msgData.error}`);
    return false;
  }

  return true;
}

async function postPrComment(github, context, requestedBy) {
  const commentBody = `${PR_COMMENT_MARKER}\n${PR_COMMENT_MESSAGE(requestedBy)}`;

  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.payload.pull_request.number,
    body: commentBody,
  });
}

async function run({ github, context, core }) {
  // Step 1: Extract "Requested by: @username" from PR body
  const body = context.payload.pull_request.body || "";
  const match = body.match(/Requested by:\s*@(\S+)/i);

  if (!match) {
    core.info('No "Requested by: @username" found in PR body. Skipping.');
    return;
  }

  const requestedBy = match[1];
  core.info(`Detected requester: ${requestedBy}`);

  const prUrl = context.payload.pull_request.html_url;

  // Step 2: Look up the requester's email via GitHub API
  let email = null;
  try {
    const { data: user } = await github.rest.users.getByUsername({
      username: requestedBy,
    });
    email = user.email;
    if (email) {
      core.info(`Found GitHub email for ${requestedBy}: ${email}`);
    } else {
      core.warning(`No public email on GitHub profile for ${requestedBy}`);
    }
  } catch (error) {
    core.warning(`Failed to fetch GitHub user ${requestedBy}: ${error.message}`);
  }

  // Step 3: Always post a PR comment
  await postPrComment(github, context, requestedBy);
  core.info("PR comment posted");

  // Step 4: Also attempt to send a Slack DM
  const slackToken = process.env.SLACK_TOKEN;

  if (email && slackToken) {
    try {
      const slackNotified = await sendSlackDm(core, slackToken, email, prUrl);
      if (slackNotified) {
        core.info(`Slack DM sent successfully to ${requestedBy}`);
      }
    } catch (error) {
      core.warning(`Slack notification failed: ${error.message}`);
    }
  } else {
    core.warning("Skipping Slack DM: no email or SLACK_TOKEN not set");
  }
}

// Default export for actions/github-script
module.exports = run;

// Named exports for testing
module.exports.run = run;
module.exports.sendSlackDm = sendSlackDm;
module.exports.postPrComment = postPrComment;
module.exports.SLACK_MESSAGE = SLACK_MESSAGE;
module.exports.PR_COMMENT_MESSAGE = PR_COMMENT_MESSAGE;
module.exports.PR_COMMENT_MARKER = PR_COMMENT_MARKER;
