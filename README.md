# Unused Copilot Seats Cleaner

A tool to automatically clean up unused GitHub Copilot seats in your organization to optimize license usage.

## Features

- Automatically identifies inactive Copilot seats
- Removes access for users who haven't used Copilot in the last 60 days to optimize GitHub Copilot cost
- Configurable inactivity threshold (default: 60 days) - Users who haven't used Copilot for this duration will have their access removed
- Runs automatically on the 28th of every month and also supports manual trigger

## Prerequisites

- GitHub Organization admin access
- GitHub Personal Access Token with appropriate permissions

## Setup

1. Fork this repository
2. Add your GitHub token as a repository secret named `GITHUB_TOKEN`
3. Configure organization name in the workflow file 
4. (Optional) Adjust the `THRESHOLD_DAYS` value in the workflow file if you want to change the default 60-day inactivity period

## Configuration

### Inactivity Threshold

The workflow needs two key configurations in the `.github/workflows/remove-inactive-60day-copilot-users.yml` file:

1. `THRESHOLD_DAYS`: 
   - Determines the inactivity period before removing Copilot access
   - Default value: 60 days

2. `ORG_NAME`:
   - Specifies your GitHub organization name

Both settings can be modified to match your organization's requirements.

## Execution Schedule

- Automated: Runs at 00:00 UTC on the 28th of every month
- Manual: Can be triggered from the Actions tab

## Logs

Execution logs can be viewed in:
- /clean-logs/ directory
- GitHub Actions run history (retention: 90 days)


