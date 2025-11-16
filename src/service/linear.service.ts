import { logger } from '../utils/logger';

// import node env to load the API key
import dotenv from 'dotenv';
dotenv.config(); // Load env first!

const LINEAR_API_URL = 'https://api.linear.app/graphql';
const API_KEY = process.env.LINEAR_API_KEY;
console.log('API_KEY', API_KEY?.slice(0, 5) + '...');
console.log('LINEAR_API_URL', LINEAR_API_URL);

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

  const response = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Linear API error: ${response.status} ${text}`);
  }

  const payload = await response.json();
  if (payload.errors) {
    throw new Error(`Linear API returned errors: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data as T;
};

export const isLinearEnabled = () => Boolean(API_KEY);

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
    const data = await requestLinear<{ issue: LinearIssue | null }>(
      `query IssueById($identifier: String!) {
        issue(identifier: $identifier) {
          id
          identifier
          title
          url
          dueDate
          priorityLabel
          state { name }
        }
      }`,
      { identifier }
    );

    return data.issue;
  } catch (error) {
    logger.error('Error fetching Linear issue:', error);
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
