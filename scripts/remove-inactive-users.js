// Import required dependencies
const axios = require('axios');
const fs = require('fs');

// Get environment variables
const org = process.env.ORG_NAME;
const currentUser = process.env.CURRENT_USER;
const isDryRun = process.env.DRY_RUN !== 'false';
const today = process.env.CURRENT_DATE ? 
  new Date(process.env.CURRENT_DATE.replace(' ', 'T') + 'Z') : 
  new Date();

// Log initial configuration
console.log(`Current Date and Time (UTC - YYYY-MM-DD HH:MM:SS formatted): ${process.env.CURRENT_DATE}`);
console.log(`Current User's Login: ${currentUser}`);
console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'PRODUCTION'}\n`);

// Cache for teams information to avoid repeated API calls
let teamsCache = null;

/**
 * Fetches and caches all teams in the organization
 * @returns {Promise<Map>} Map of team names to team slugs
 */
const getTeams = async () => {
  if (teamsCache) return teamsCache;
  try {
    console.log('Fetching teams information...');
    const response = await axios.get(`https://api.github.com/orgs/${org}/teams?per_page=100`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json'
      }
    });
    // Convert teams data to a Map of team names to slugs (filtered to Copilot teams only)
    teamsCache = new Map(
      response.data
        .filter(team => team.name.startsWith('Team Copilot -'))
        .map(team => [team.name, team.slug])
    );
    console.log('Found Copilot teams:', Array.from(teamsCache.entries()));
    return teamsCache;
  } catch (error) {
    console.error('Error fetching teams:', error.message);
    return new Map();
  }
};

/**
 * Removes a user from a Copilot access team
 * @param {Object} user - User object containing login information
 * @param {string} teamName - Name of the team to remove user from
 * @returns {Promise<boolean>} Success status of the removal operation
 */
const removeFromCopilotTeam = async (user, teamName) => {
  try {
    // Verify if this is a Copilot team
    if (!teamName.startsWith('Team Copilot -')) {
      console.log(`${teamName} is not a Copilot Access team, skipping team removal.`);
      return false;
    }

    const teams = await getTeams();
    const teamSlug = teams.get(teamName);
    if (!teamSlug) {
      console.error(`Could not find team slug for: ${teamName}`);
      return false;
    }

    console.log(`Removing user ${user.login} from Copilot Access team: ${teamName} (slug: ${teamSlug})`);
    
    // Execute team removal if not in dry run mode
    if (!isDryRun) {
      await axios.delete(`https://api.github.com/orgs/${org}/teams/${teamSlug}/memberships/${user.login}`, {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json'
        }
      });
    }
    
    console.log(`${isDryRun ? '[DRY RUN] Would have removed' : 'Removed'} ${user.login} from Copilot Access team ${teamName}`);
    return true;
  } catch (error) {
    console.error(`Error removing ${user.login} from Copilot Access team ${teamName}:`, error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
};

/**
 * Removes Copilot access for a specific user
 * @param {Object} user - User object containing login information
 * @returns {Promise<boolean>} Success status of the removal operation
 */
const removeCopilotAccess = async (user) => {
  try {
    console.log(`Removing Copilot access for user: ${user.login}`);
    
    // Execute access removal if not in dry run mode
    if (!isDryRun) {
      await axios.delete(`https://api.github.com/orgs/${org}/copilot/billing/selected_users`, {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.copilot-billing-preview+json',
          'Content-Type': 'application/json',
        },
        data: {
          selected_usernames: [user.login],
        },
      });
    }
    
    console.log(`${isDryRun ? '[DRY RUN] Would have removed' : 'Removed'} Copilot access for user: ${user.login}`);
    return true;
  } catch (error) {
    console.error(`Error removing Copilot access for ${user.login}:`, error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
      
      // Handle case where user has access through team
      if (error.response.status === 422 && error.response.data.message.includes('assigned via team')) {
        const teamMatch = error.response.data.message.match(/team (Team Copilot - [^',.]+)/);
        if (teamMatch) {
          const teamName = teamMatch[1];
          console.log(`User ${user.login} has Copilot access through team: ${teamName}`);
          const teamRemovalResult = await removeFromCopilotTeam(user, teamName);
          if (teamRemovalResult) {
            // Retry removing Copilot access after team removal
            await new Promise(resolve => setTimeout(resolve, 2000));
            return await removeCopilotAccess(user);
          }
        }
      }
    }
    return false;
  }
};

// Main execution function
(async () => {
  try {
    console.log('Copilot Access Removal Process');
    console.log('============================');
    
    // Verify and load inactive users data
    const inactiveUsersFile = '.github/scripts/inactive_users.txt';
    if (!fs.existsSync(inactiveUsersFile)) {
      throw new Error('Inactive users file not found. Please run check-copilot-usage.js first.');
    }

    const inactiveUsers = JSON.parse(fs.readFileSync(inactiveUsersFile, 'utf8'));
    if (!Array.isArray(inactiveUsers) || inactiveUsers.length === 0) {
      console.log('No inactive users to process.');
      return;
    }

    console.log(`Found ${inactiveUsers.length} inactive users to process.\n`);
    
    // Log users to be processed
    console.log('Users to be processed:');
    console.log('User Login,Status,Days Inactive,Teams,Last Usage Date');
    inactiveUsers.forEach(user => {
      console.log(`${user.login},${user.status},${user.days_inactive},"${user.team}",${user.last_used}`);
    });

    // Initialize result tracking
    const results = {
      successful: [],
      failed: [],
      skipped: []
    };

    // Process each inactive user
    console.log('\nProcessing users...');
    for (const user of inactiveUsers) {
      if (user.login === currentUser) {
        console.log(`Skipping current user: ${currentUser}`);
        results.skipped.push({ ...user, reason: 'Current user' });
        continue;
      }

      const removalResult = await removeCopilotAccess(user);
      if (removalResult === true) {
        results.successful.push(user);
        console.log(`Successfully removed access for ${user.login} - GitHub will send an automatic notification`);
      } else {
        results.failed.push(user);
      }
    }

    // Generate final report
    console.log('\nFinal Results:');
    console.log('==============');
    
    // Log successful removals
    if (results.successful.length > 0) {
      console.log('\nUsers processed successfully:');
      console.log('User Login,Status,Days Inactive,Teams,Last Usage Date');
      results.successful.forEach(user => {
        console.log(`${user.login},${user.status},${user.days_inactive},"${user.team}",${user.last_used}`);
      });
    }

    // Log failures
    if (results.failed.length > 0) {
      console.log('\nFailed to process:');
      console.log('User Login,Status,Days Inactive,Teams,Last Usage Date');
      results.failed.forEach(user => {
        console.log(`${user.login},${user.status},${user.days_inactive},"${user.team}",${user.last_used}`);
      });
    }

    // Log skipped users
    if (results.skipped.length > 0) {
      console.log('\nSkipped users:');
      console.log('User Login,Status,Days Inactive,Teams,Last Usage Date,Reason');
      results.skipped.forEach(user => {
        console.log(`${user.login},${user.status},${user.days_inactive},"${user.team}",${user.last_used},${user.reason}`);
      });
    }

    // Generate Markdown report
    const timestamp = today.toISOString()
      .replace(/[:]/g, '_')
      .replace(/[T]/g, '_')
      .replace(/[.]\d{3}Z$/, '_UTC');
    
    const reportDir = 'clean-logs';
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const mdContent = `# GitHub Copilot Access Removal Report

## Process Information
- Date: ${today.toUTCString()}
- Mode: ${isDryRun ? 'DRY RUN' : 'PRODUCTION'}

## Summary
- Successfully Processed: ${results.successful.length} users
- Failed to Process: ${results.failed.length} users
- Skipped: ${results.skipped.length} users

## Successfully Processed Users
| User Login | Status | Days Inactive | Teams | Last Usage Date |
|------------|--------|---------------|--------|----------------|
${results.successful.map(user => 
  `| ${user.login} | ${user.status} | ${user.days_inactive} | ${user.team} | ${user.last_used} |`
).join('\n')}

## Failed to Process
| User Login | Status | Days Inactive | Teams | Last Usage Date |
|------------|--------|---------------|--------|----------------|
${results.failed.map(user => 
  `| ${user.login} | ${user.status} | ${user.days_inactive} | ${user.team} | ${user.last_used} |`
).join('\n')}

## Skipped Users
| User Login | Status | Days Inactive | Teams | Last Usage Date | Reason |
|------------|--------|---------------|--------|----------------|---------|
${results.skipped.map(user => 
  `| ${user.login} | ${user.status} | ${user.days_inactive} | ${user.team} | ${user.last_used} | ${user.reason} |`
).join('\n')}
`;

    const reportPath = `${reportDir}/${timestamp}.md`;
    fs.writeFileSync(reportPath, mdContent);
    console.log(`\nMarkdown report has been generated at ${reportPath}`);
    
    // Remove the old report files
    if (fs.existsSync('.github/scripts/removal_simulation_results.csv')) {
      fs.unlinkSync('.github/scripts/removal_simulation_results.csv');
    }
    if (fs.existsSync('.github/scripts/removal_simulation_results.json')) {
      fs.unlinkSync('.github/scripts/removal_simulation_results.json');
    }

    // Log summary
    console.log('\nProcess completed.');
    console.log(`${isDryRun ? 'Would process' : 'Processed'}: ${results.successful.length} users`);
    console.log(`Failed to process: ${results.failed.length} users`);
    console.log(`Skipped: ${results.skipped.length} users`);
    
  } catch (error) {
    // Error handling with detailed logging
    console.error('Error during the process:', error.message);
    process.exit(1);
  }
})();
