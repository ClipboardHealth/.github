# Purpose

This .github repo defines organization-wide defaults and configurations.

## Organization-Wide Workflows

### Devin Attribution Check

**File:** `workflow-templates/devin-attribution-check.yml`

Automatically detects when a PR is authored by the `devin-ai-integration[bot]` account instead of the actual requester's personal GitHub account. When detected, it:

1. Extracts the requester's GitHub username from the `Requested by: @username` line in the PR body
2. Looks up the requester's email via the GitHub API
3. Posts a PR comment tagging the requester, asking them to set up their Devin GitHub integration
4. Attempts to send a Slack DM to the requester (may fail if the user has no public email on their GitHub profile or the email doesn't match a Slack account)

**Required secrets** (org-level): `SLACK_DEPLNOTIF_APP_TOKEN`

**Enforcement:** Applied to all repositories via an organization-level ruleset. To configure or modify enforcement, go to **ClipboardHealth org Settings → Rulesets**.

## Documentation

- [Starter workflows](https://docs.github.com/en/actions/using-workflows/creating-starter-workflows-for-your-organization)
