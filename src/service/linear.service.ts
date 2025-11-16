import { LinearClient } from '@linear/sdk';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.LINEAR_API_KEY;

// Initialize Linear client
let linearClient: LinearClient | null = null;

if (API_KEY) {
  console.log('[Linear] API Key configured:', API_KEY.slice(0, 10) + '...' + API_KEY.slice(-5));
  console.log('[Linear] API Key length:', API_KEY.length);
  linearClient = new LinearClient({ apiKey: API_KEY });
  console.log('[Linear] SDK client initialized');
} else {
  console.warn('[Linear] ⚠️  LINEAR_API_KEY is NOT configured!');
}

interface LinearUser {
  id: string;
  name: string;
  email?: string;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url?: string;
  state?: { name: string } | null;
  priorityLabel?: string | null;
  dueDate?: string | null;
}

export const isLinearEnabled = () => Boolean(linearClient);

export const testLinearConnection = async (): Promise<{ success: boolean; message: string }> => {
  if (!linearClient) {
    return { success: false, message: 'LINEAR_API_KEY is not configured' };
  }

  try {
    console.log('[Linear] Testing connection...');
    const viewer = await linearClient.viewer;
    const viewerData = await viewer;
    
    console.log('[Linear] Connection test successful! Viewer:', viewerData.name);
    return { 
      success: true, 
      message: `Connected as ${viewerData.name} (${viewerData.email})` 
    };
  } catch (error: any) {
    console.error('[Linear] Connection test failed:', error);
    return { 
      success: false, 
      message: `Connection failed: ${error.message}` 
    };
  }
};

export const getLinearUserByEmail = async (email: string): Promise<LinearUser | null> => {
  if (!linearClient) {
    return null;
  }

  try {
    console.log(`[Linear] Searching for user with email: ${email}`);
    const users = await linearClient.users({
      filter: { email: { eq: email } }
    });
    
    const userNodes = await users.nodes;
    if (userNodes.length === 0) {
      console.log(`[Linear] No user found with email: ${email}`);
      return null;
    }

    const user = userNodes[0];
    console.log(`[Linear] Found user: ${user.name} (${user.id})`);
    return {
      id: user.id,
      name: user.name,
      email: user.email
    };
  } catch (error) {
    logger.error('Error fetching Linear user:', error);
    return null;
  }
};

export const getActiveIssuesForUser = async (userId: string): Promise<LinearIssue[]> => {
  if (!linearClient) {
    return [];
  }

  try {
    console.log(`[Linear] Fetching active issues for user: ${userId}`);
    const issues = await linearClient.issues({
      filter: { 
        assignee: { id: { eq: userId } }
      },
      first: 5
    });

    const issueNodes = await issues.nodes;
    console.log(`[Linear] Found ${issueNodes.length} issues for user ${userId}`);

    const result: LinearIssue[] = [];
    for (const issue of issueNodes) {
      const state = await issue.state;
      result.push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        dueDate: issue.dueDate,
        priorityLabel: issue.priorityLabel,
        state: state ? { name: state.name } : null
      });
    }

    return result;
  } catch (error) {
    logger.error('Error fetching Linear issues:', error);
    return [];
  }
};

export const getIssueByIdentifier = async (identifier: string): Promise<LinearIssue | null> => {
  if (!linearClient) {
    return null;
  }

  try {
    console.log(`[Linear] Fetching issue with identifier: ${identifier}`);
    
    // Use the SDK's issueSearch method which supports identifier search
    const issue = await linearClient.issue(identifier);
    
    if (!issue) {
      console.log(`[Linear] No issue found with identifier: ${identifier}`);
      return null;
    }

    const state = await issue.state;
    console.log(`[Linear] Found issue: ${issue.identifier} - ${issue.title}`);

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      dueDate: issue.dueDate,
      priorityLabel: issue.priorityLabel,
      state: state ? { name: state.name } : null
    };
  } catch (error: any) {
    logger.error('Error fetching Linear issue:', error);
    console.error('[Linear] Error details:', error);
    
    // If direct lookup fails, try searching by number
    try {
      const parts = identifier.split('-');
      if (parts.length === 2) {
        const number = parseInt(parts[1], 10);
        if (!isNaN(number)) {
          console.log(`[Linear] Trying search by number: ${number}`);
          const issues = await linearClient.issues({
            filter: { number: { eq: number } },
            first: 10
          });

          const issueNodes = await issues.nodes;
          console.log(`[Linear] Found ${issueNodes.length} issues with number ${number}`);
          
          const matchedIssue = issueNodes.find(i => i.identifier.toUpperCase() === identifier.toUpperCase());
          
          if (matchedIssue) {
            const state = await matchedIssue.state;
            console.log(`[Linear] Matched issue via search: ${matchedIssue.identifier}`);
            return {
              id: matchedIssue.id,
              identifier: matchedIssue.identifier,
              title: matchedIssue.title,
              url: matchedIssue.url,
              dueDate: matchedIssue.dueDate,
              priorityLabel: matchedIssue.priorityLabel,
              state: state ? { name: state.name } : null
            };
          }
        }
      }
    } catch (searchError) {
      logger.error('Error in fallback search:', searchError);
    }
    
    return null;
  }
};

export const formatIssueSummary = (issue: LinearIssue) => {
  const pieces = [
    `${issue.identifier}: ${issue.title}`,
  ];
  if (issue.state?.name) {
    pieces.push(`State: ${issue.state.name}`);
  }
  if (issue.priorityLabel) {
    pieces.push(`Priority: ${issue.priorityLabel}`);
  }
  if (issue.dueDate) {
    pieces.push(`Due: ${issue.dueDate}`);
  }
  if (issue.url) {
    pieces.push(issue.url);
  }
  return pieces.join(' | ');
};
