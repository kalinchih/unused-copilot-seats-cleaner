// Import required dependencies
const axios = require('axios');
const fs = require('fs');

// Get organization name from environment variable
const org = process.env.ORG_NAME;
const thresholdDays = parseInt(process.env.THRESHOLD_DAYS || '60', 10); // Default to 60 if not set

/**
 * Fetches Copilot billing information for the organization
 * @returns {Promise<Object>} Billing information including seat breakdown
 */
const getCopilotBilling = async () => {
  console.log('Fetching Copilot billing information...');
  try {
    const response = await axios.get(`https://api.github.com/orgs/${org}/copilot/billing`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.copilot-billing-preview+json',
      },
    });
    console.log('Successfully fetched Copilot billing information.');
    return response.data;
  } catch (error) {
    console.error('Error fetching Copilot billing information:', error.message);
    throw error;
  }
};

/**
 * Retrieves all members of the organization
 * @returns {Promise<Array>} List of organization members
 */
const getOrgMembers = async () => {
  console.log('Fetching organization members...');
  try {
    const response = await axios.get(`https://api.github.com/orgs/${org}/members`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
      params: {
        per_page: 100
      }
    });
    console.log('Successfully fetched organization members.');
    return response.data;
  } catch (error) {
    console.error('Error fetching organization members:', error.message);
    throw error;
  }
};

/**
 * Checks Copilot access status for a specific member
 * @param {string} memberLogin - GitHub login of the member
 * @returns {Promise<Object|null>} Copilot access information or null if no access
 */
const getCopilotAccessForMember = async (memberLogin) => {
  try {
    const response = await axios.get(`https://api.github.com/orgs/${org}/members/${memberLogin}/copilot`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.copilot-preview+json',
      },
    });
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return null;
    }
    console.error(`Error checking Copilot access for ${memberLogin}:`, error.message);
    return null;
  }
};

/**
 * Retrieves all teams in the organization
 * @returns {Promise<Array>} List of teams
 */
const getTeams = async () => {
  try {
    const response = await axios.get(`https://api.github.com/orgs/${org}/teams`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
      params: {
        per_page: 100
      }
    });
    return response.data;
  } catch (error) {
    console.warn('Warning: Could not fetch teams:', error.message);
    return [];
  }
};

/**
 * Gets members of a specific team
 * @param {number} teamId - The ID of the team
 * @returns {Promise<Array>} List of team members
 */
const getTeamMembers = async (teamId) => {
  try {
    const response = await axios.get(`https://api.github.com/teams/${teamId}/members`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
      params: {
        per_page: 100
      }
    });
    return response.data;
  } catch (error) {
    console.warn(`Warning: Could not fetch members for team ${teamId}:`, error.message);
    return [];
  }
};

// Main execution function
(async () => {
  try {
    console.log('Starting to check Copilot usage...');
    
    // Set reference date for checking inactivity based on threshold
    const today = process.env.CURRENT_DATE ? 
      new Date(process.env.CURRENT_DATE.replace(' ', 'T') + 'Z') : 
      new Date();
    const thresholdDate = new Date(today);
    thresholdDate.setDate(today.getDate() - thresholdDays);
    console.log('Current date:', today.toISOString());
    console.log(`Threshold date (${thresholdDays} days ago):`, thresholdDate.toISOString());

    // Fetch all required data in parallel
    const [copilotBilling, members, teams] = await Promise.all([
      getCopilotBilling(),
      getOrgMembers(),
      getTeams()
    ]);

    // Initialize arrays and variables for tracking results
    const inactiveUsers = [];
    const currentUser = 'kalin-chih';
    const teamsMap = new Map();

    // Log billing information
    console.log(`Total Copilot seats: ${copilotBilling.seat_breakdown.total}`);
    console.log(`Active seats this cycle: ${copilotBilling.seat_breakdown.active_this_cycle}`);
    console.log(`Inactive seats this cycle: ${copilotBilling.seat_breakdown.inactive_this_cycle}`);

    // Pre-load all team members for efficient lookup
    for (const team of teams) {
      const teamMembers = await getTeamMembers(team.id);
      teamsMap.set(team.id, {
        name: team.name,
        members: teamMembers.map(m => m.login)
      });
    }

    // Process each organization member
    for (const member of members) {
      // Skip current user for safety
      if (member.login === currentUser) {
        console.log(`Skipping current user: ${currentUser}`);
        continue;
      }

      // Check member's Copilot access status
      const copilotAccess = await getCopilotAccessForMember(member.login);
      if (!copilotAccess) {
        console.log(`No Copilot access for user: ${member.login}`);
        continue;
      }

      console.log(`Processing user ${member.login}...`);
      const lastActivityDate = copilotAccess.last_activity_at ? new Date(copilotAccess.last_activity_at) : null;
      const status = lastActivityDate === null ? 'No activity' : 
                    (lastActivityDate < thresholdDate ? 'Inactive' : 'Active');

      // If user is inactive, collect their information
      if (status === 'No activity' || status === 'Inactive') {
        // Get user's team memberships
        const userTeams = Array.from(teamsMap.values())
          .filter(team => team.members.includes(member.login))
          .map(team => team.name)
          .join(', ');

        // Add user to inactive list with relevant information
        inactiveUsers.push({
          login: member.login,
          status,
          team: userTeams || 'No teams',
          last_used: lastActivityDate ? lastActivityDate.toISOString() : 'Never',
          days_inactive: lastActivityDate ? 
            Math.floor((today - lastActivityDate) / (1000 * 60 * 60 * 24)) : 
            'Never used'
        });
      }
    }

    // Generate report of inactive users
    console.log('\nInactive Copilot Users Report:');
    console.log('===============================');

    if (inactiveUsers.length > 0) {
      console.log(`Found ${inactiveUsers.length} inactive users (Billing shows ${copilotBilling.seat_breakdown.inactive_this_cycle} inactive)\n`);
      
      // Print CSV format headers and data
      console.log('User Login,Status,Days Inactive,Teams,Last Usage Date');
      inactiveUsers
        .sort((a, b) => (b.days_inactive === 'Never used' ? -1 : 
                         a.days_inactive === 'Never used' ? 1 : 
                         b.days_inactive - a.days_inactive))
        .forEach(user => {
          const teamField = `"${user.team}"`;
          console.log(`${user.login},${user.status},${user.days_inactive},${teamField},${user.last_used}`);
        });

      // Note any discrepancy in inactive user counts
      if (inactiveUsers.length < copilotBilling.seat_breakdown.inactive_this_cycle) {
        console.log(`\nNote: ${copilotBilling.seat_breakdown.inactive_this_cycle - inactiveUsers.length} inactive users not found.`);
        console.log('This might be due to API limitations or recent changes in user status.');
      }
    } else {
      console.log('No inactive users found.');
      if (copilotBilling.seat_breakdown.inactive_this_cycle > 0) {
        console.log(`Warning: Billing shows ${copilotBilling.seat_breakdown.inactive_this_cycle} inactive users, but none were found.`);
      }
    }

    // Generate CSV report file
    const csvContent = [
      'User Login,Status,Days Inactive,Teams,Last Usage Date',
      ...inactiveUsers
        .sort((a, b) => (b.days_inactive === 'Never used' ? -1 : 
                         a.days_inactive === 'Never used' ? 1 : 
                         b.days_inactive - a.days_inactive))
        .map(user => `${user.login},${user.status},${user.days_inactive},"${user.team}",${user.last_used}`)
    ].join('\n');

    // Save results to files
    fs.writeFileSync('.github/scripts/inactive_users.csv', csvContent);
    console.log('\nCSV file has been generated at .github/scripts/inactive_users.csv');
    
    fs.writeFileSync('.github/scripts/inactive_users.txt', JSON.stringify(inactiveUsers, null, 2));
    
    // Set GitHub Actions output if running in Actions environment
    const outputPath = process.env.GITHUB_OUTPUT;
    if (outputPath) {
      fs.appendFileSync(outputPath, `inactive_users=${inactiveUsers.map(user => user.login).join(',')}\n`);
    }
    
    console.log('\nFinished checking Copilot usage.');
  } catch (error) {
    // Error handling with detailed logging
    console.error('Error during the check process:', error.message);
    if (error.response) {
      console.error('API Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
})();
