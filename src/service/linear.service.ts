import { logger } from '../utils/logger';

// import node env to load the API key
import dotenv from 'dotenv';
dotenv.config(); // Load env first!

const LINEAR_API_URL = 'https://api.linear.app/graphql';
const API_KEY = process.env.LINEAR_API_KEY;

if (API_KEY) {
  console.log('[Linear] API Key configured:', API_KEY.slice(0, 10) + '...' + API_KEY.slice(-5));
  console.log('[Linear] API Key length:', API_KEY.length);
  console.log('[Linear] API URL:', LINEAR_API_URL);
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

const requestLinear = async <T>(query: string, variables?: Record<string, unknown>): Promise<T> => {
  if (!API_KEY) {
    throw new Error('LINEAR_API_KEY is not configured.');
  }

  console.log('[Linear] Making request with query:', query.substring(0, 100) + '...');
  console.log('[Linear] Variables:', JSON.stringify(variables));

  const response = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });

  console.log('[Linear] Response status:', response.status);

  if (!response.ok) {
    const text = await response.text();
    console.error('[Linear] Error response:', text);
    throw new Error(`Linear API error: ${response.status} ${text}`);
  }

  const payload = await response.json();
  console.log('[Linear] Response payload:', JSON.stringify(payload, null, 2));
  
  if (payload.errors) {
    console.error('[Linear] GraphQL errors:', JSON.stringify(payload.errors, null, 2));
    throw new Error(`Linear API returned errors: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data as T;
};

export const isLinearEnabled = () => Boolean(API_KEY);

export const testLinearConnection = async (): Promise<{ success: boolean; message: string }> => {
  if (!API_KEY) {
    return { success: false, message: 'LINEAR_API_KEY is not configured' };
  }

  try {
    console.log('[Linear] Testing connection...');
    const data = await requestLinear<{ viewer: { id: string; name: string; email: string } }>(
      `query {
        viewer {
          id
          name
          email
        }
      }`
    );
    
    console.log('[Linear] Connection test successful! Viewer:', data.viewer);
    return { 
      success: true, 
      message: `Connected as ${data.viewer.name} (${data.viewer.email})` 
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
  try {
    const data = await requestLinear<{ users: { nodes: LinearUser[] } }>(
      `query UserByEmail($email: String!) {
        users(filter: { email: { eq: $email } }) {
          nodes { id name email }
        }
      }`,
      { email }
    );

    return data.users.nodes[0] || null;
  } catch (error) {
    logger.error('Error fetching Linear user:', error);
    return null;
  }
};

export const getActiveIssuesForUser = async (userId: string): Promise<LinearIssue[]> => {
  try {
    const data = await requestLinear<{ issues: { nodes: LinearIssue[] } }>(
      `query ActiveIssues($userId: ID!, $first: Int!) {
        issues(
          filter: { assignee: { id: { eq: $userId } } }
          orderBy: updatedAt
          first: $first
        ) {
          nodes {
            id
            identifier
            title
            url
            dueDate
            priorityLabel
            state { name }
          }
        }
      }`,
      { userId, first: 5 }
    );

    return data.issues.nodes;
  } catch (error) {
    logger.error('Error fetching Linear issues:', error);
    return [];
  }
};

export const getIssueByIdentifier = async (identifier: string): Promise<LinearIssue | null> => {
  try {
    console.log(`[Linear] Fetching issue with identifier: ${identifier}`);
    
    // Linear's issue(id:) requires UUID, not identifier
    // So we search through issues by number
    const parts = identifier.split('-');
    if (parts.length !== 2) {
      console.error('[Linear] Invalid identifier format:', identifier);
      return null;
    }
    
    const [projectKey, issueNumber] = parts;
    const number = parseInt(issueNumber, 10);
    
    if (isNaN(number)) {
      console.error('[Linear] Invalid issue number:', issueNumber);
      return null;
    }
    
    // Search for issues with this number
    const data = await requestLinear<{ issues: { nodes: LinearIssue[] } }>(
      `query IssueByNumber($number: Float!) {
        issues(
          filter: { number: { eq: $number } }
          first: 10
        ) {
          nodes {
            id
            identifier
            title
            url
            dueDate
            priorityLabel
            state { name }
          }
        }
      }`,
      { number }
    );

    console.log(`[Linear] Found ${data.issues.nodes.length} issues with number ${number}`);
    
    // Find the one matching the full identifier
    const issue = data.issues.nodes.find(i => i.identifier.toUpperCase() === identifier.toUpperCase());
    
    if (issue) {
      console.log(`[Linear] Matched issue:`, issue.identifier);
    } else {
      console.log(`[Linear] No issue found matching ${identifier}`);
    }
    
    return issue || null;
  } catch (error) {
    logger.error('Error fetching Linear issue:', error);
    console.error('[Linear] Error details:', error);
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
