import { Request, Response } from 'express';
import { LinearClient } from '@linear/sdk';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { APP_TIMEZONE } from '../config';
import { logInfo, logError } from '../utils/logger';
import { hasClerk } from '../index';
import { createBaseViewData } from '../config/view-engine';

const TIMEZONE = APP_TIMEZONE;
const API_KEY = process.env.LINEAR_API_KEY;

let linearClient: LinearClient | null = null;
if (API_KEY) {
  linearClient = new LinearClient({ apiKey: API_KEY });
}

interface TeamMemberNotes {
  userId: string;
  userName: string;
  email: string;
  avatar?: string;
  todayIssues: IssueNote[];
  yesterdayIssues: IssueNote[];
  summary: {
    todayCount: number;
    yesterdayCount: number;
    completedToday: number;
    completedYesterday: number;
    inProgressToday: number;
  };
}

interface IssueNote {
  identifier: string;
  title: string;
  url: string;
  state: string;
  stateColor: string;
  priority: string;
  updatedAt: string;
  createdAt: string;
  isNew: boolean;
  isCompleted: boolean;
  comments: CommentNote[];
}

interface CommentNote {
  body: string;
  createdAt: string;
  userName: string;
}

// Map state names to colors
function getStateColor(stateName: string): string {
  const stateColors: Record<string, string> = {
    'Backlog': '#94a3b8',
    'Todo': '#f59e0b',
    'In Progress': '#3b82f6',
    'In Review': '#8b5cf6',
    'Done': '#10b981',
    'Canceled': '#ef4444',
    'Duplicate': '#6b7280',
  };
  return stateColors[stateName] || '#64748b';
}

// Check if state is completed
function isCompletedState(stateName: string): boolean {
  return ['Done', 'Completed', 'Closed'].some(s => 
    stateName.toLowerCase().includes(s.toLowerCase())
  );
}

/**
 * Get all team members from Linear
 */
async function getTeamMembers(): Promise<{ id: string; name: string; email: string; avatarUrl?: string }[]> {
  if (!linearClient) return [];
  
  try {
    const users = await linearClient.users();
    const userNodes = await users.nodes;
    
    return userNodes
      .filter(u => u.active && u.email)
      .map(u => ({
        id: u.id,
        name: u.name,
        email: u.email || '',
        avatarUrl: u.avatarUrl
      }));
  } catch (error) {
    logError('Error fetching Linear users', error);
    return [];
  }
}

/**
 * Get issues for a user updated within a date range
 */
async function getUserIssuesForDate(
  userId: string, 
  startDate: Date, 
  endDate: Date
): Promise<IssueNote[]> {
  if (!linearClient) return [];
  
  try {
    const issues = await linearClient.issues({
      filter: {
        assignee: { id: { eq: userId } },
        updatedAt: {
          gte: startDate.toISOString(),
          lte: endDate.toISOString()
        }
      },
      first: 50,
      orderBy: LinearClient.name ? undefined : undefined // Just need recent ones
    });
    
    const issueNodes = await issues.nodes;
    const result: IssueNote[] = [];
    
    for (const issue of issueNodes) {
      const state = await issue.state;
      const stateName = state?.name || 'Unknown';
      
      // Get recent comments for this issue
      const comments: CommentNote[] = [];
      try {
        const issueComments = await issue.comments({ first: 5 });
        const commentNodes = await issueComments.nodes;
        
        for (const comment of commentNodes) {
          const commentDate = new Date(comment.createdAt);
          if (commentDate >= startDate && commentDate <= endDate) {
            const user = await comment.user;
            comments.push({
              body: comment.body.slice(0, 200) + (comment.body.length > 200 ? '...' : ''),
              createdAt: format(commentDate, 'HH:mm'),
              userName: user?.name || 'Unknown'
            });
          }
        }
      } catch (e) {
        // Ignore comment errors
      }
      
      const createdAt = new Date(issue.createdAt);
      const isNew = createdAt >= startDate && createdAt <= endDate;
      
      result.push({
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        state: stateName,
        stateColor: getStateColor(stateName),
        priority: issue.priorityLabel || 'No priority',
        updatedAt: format(new Date(issue.updatedAt), 'HH:mm'),
        createdAt: format(createdAt, 'HH:mm'),
        isNew,
        isCompleted: isCompletedState(stateName),
        comments
      });
    }
    
    return result;
  } catch (error) {
    logError(`Error fetching issues for user ${userId}`, error);
    return [];
  }
}

/**
 * Generate notes for all team members
 */
async function generateTeamNotes(): Promise<TeamMemberNotes[]> {
  if (!linearClient) return [];
  
  const now = toZonedTime(new Date(), TIMEZONE);
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const yesterdayStart = startOfDay(subDays(now, 1));
  const yesterdayEnd = endOfDay(subDays(now, 1));
  
  const teamMembers = await getTeamMembers();
  const notes: TeamMemberNotes[] = [];
  
  for (const member of teamMembers) {
    const todayIssues = await getUserIssuesForDate(member.id, todayStart, todayEnd);
    const yesterdayIssues = await getUserIssuesForDate(member.id, yesterdayStart, yesterdayEnd);
    
    // Skip members with no activity
    if (todayIssues.length === 0 && yesterdayIssues.length === 0) {
      continue;
    }
    
    notes.push({
      userId: member.id,
      userName: member.name,
      email: member.email,
      avatar: member.avatarUrl,
      todayIssues,
      yesterdayIssues,
      summary: {
        todayCount: todayIssues.length,
        yesterdayCount: yesterdayIssues.length,
        completedToday: todayIssues.filter(i => i.isCompleted).length,
        completedYesterday: yesterdayIssues.filter(i => i.isCompleted).length,
        inProgressToday: todayIssues.filter(i => i.state === 'In Progress').length
      }
    });
  }
  
  // Sort by activity (most active first)
  notes.sort((a, b) => 
    (b.summary.todayCount + b.summary.yesterdayCount) - 
    (a.summary.todayCount + a.summary.yesterdayCount)
  );
  
  return notes;
}

// Page-specific styles
const pageStyles = `
  .notes-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
    gap: 1rem;
  }
  
  .refresh-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: white;
    border: 1px solid var(--gray-300);
    border-radius: var(--radius);
    color: var(--gray-700);
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .refresh-btn:hover {
    background: var(--gray-50);
    border-color: var(--primary);
    color: var(--primary);
  }
  
  .team-notes-grid {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  
  .member-card {
    background: white;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  
  .member-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.25rem;
    background: linear-gradient(135deg, var(--primary) 0%, #764ba2 100%);
    color: white;
  }
  
  .member-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(255,255,255,0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 1.25rem;
    overflow: hidden;
  }
  
  .member-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  .member-info h3 {
    margin: 0;
    font-size: 1.125rem;
  }
  
  .member-info p {
    margin: 0;
    opacity: 0.8;
    font-size: 0.875rem;
  }
  
  .member-stats {
    display: flex;
    gap: 1rem;
    margin-left: auto;
  }
  
  .stat-badge {
    background: rgba(255,255,255,0.2);
    padding: 0.375rem 0.75rem;
    border-radius: 50px;
    font-size: 0.8rem;
    white-space: nowrap;
  }
  
  .member-body {
    padding: 1.25rem;
  }
  
  .day-section {
    margin-bottom: 1.5rem;
  }
  
  .day-section:last-child {
    margin-bottom: 0;
  }
  
  .day-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    padding-bottom: 0.5rem;
    border-bottom: 2px solid var(--gray-100);
  }
  
  .day-header h4 {
    margin: 0;
    font-size: 0.95rem;
    color: var(--gray-700);
  }
  
  .day-header .count {
    background: var(--gray-100);
    color: var(--gray-600);
    padding: 0.125rem 0.5rem;
    border-radius: 50px;
    font-size: 0.75rem;
  }
  
  .issues-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .issue-card {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--gray-50);
    border-radius: var(--radius);
    border-left: 3px solid var(--gray-300);
    transition: all 0.2s;
  }
  
  .issue-card:hover {
    background: var(--gray-100);
  }
  
  .issue-card.completed {
    border-left-color: #10b981;
  }
  
  .issue-card.in-progress {
    border-left-color: #3b82f6;
  }
  
  .issue-card.new {
    border-left-color: #f59e0b;
  }
  
  .issue-state {
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    color: white;
    white-space: nowrap;
  }
  
  .issue-content {
    flex: 1;
    min-width: 0;
  }
  
  .issue-title {
    margin: 0 0 0.25rem 0;
    font-size: 0.9rem;
    font-weight: 500;
  }
  
  .issue-title a {
    color: var(--dark);
    text-decoration: none;
  }
  
  .issue-title a:hover {
    color: var(--primary);
  }
  
  .issue-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    font-size: 0.75rem;
    color: var(--gray-500);
  }
  
  .issue-meta span {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  
  .issue-comments {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px dashed var(--gray-200);
  }
  
  .comment-item {
    font-size: 0.8rem;
    color: var(--gray-600);
    padding: 0.25rem 0;
  }
  
  .comment-author {
    font-weight: 500;
    color: var(--gray-700);
  }
  
  .no-issues {
    color: var(--gray-500);
    font-style: italic;
    font-size: 0.875rem;
  }
  
  .badge-new {
    background: #fef3c7;
    color: #d97706;
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    font-size: 0.65rem;
    font-weight: 600;
    margin-left: 0.5rem;
  }
  
  .no-data {
    text-align: center;
    padding: 4rem 2rem;
    color: var(--gray-500);
  }
  
  .no-data .icon {
    font-size: 4rem;
    margin-bottom: 1rem;
    opacity: 0.5;
  }
  
  .linear-disabled {
    text-align: center;
    padding: 4rem 2rem;
    background: #fef3c7;
    border-radius: var(--radius-lg);
    color: #92400e;
  }
`;

/**
 * Serve Linear Notes dashboard
 */
export async function serveLinearNotes(req: Request, res: Response) {
  try {
    if (!linearClient) {
      return res.render('linear-notes', {
        ...createBaseViewData('Linear Notes', 'linear-notes', !!hasClerk),
        linearEnabled: false,
        teamNotes: [],
        stats: []
      });
    }
    
    const now = toZonedTime(new Date(), TIMEZONE);
    const teamNotes = await generateTeamNotes();
    
    // Add user initial for avatar fallback
    const teamNotesWithInitials = teamNotes.map(member => ({
      ...member,
      userInitial: member.userName.charAt(0).toUpperCase(),
      todayIssues: member.todayIssues.map(issue => ({
        ...issue,
        isInProgress: issue.state === 'In Progress'
      })),
      yesterdayIssues: member.yesterdayIssues.map(issue => ({
        ...issue,
        isInProgress: issue.state === 'In Progress'
      }))
    }));
    
    // Calculate totals
    const totals = {
      members: teamNotes.length,
      todayIssues: teamNotes.reduce((sum, m) => sum + m.summary.todayCount, 0),
      yesterdayIssues: teamNotes.reduce((sum, m) => sum + m.summary.yesterdayCount, 0),
      completedToday: teamNotes.reduce((sum, m) => sum + m.summary.completedToday, 0)
    };
    
    res.render('linear-notes', {
      ...createBaseViewData('Linear Notes', 'linear-notes', !!hasClerk),
      linearEnabled: true,
      teamNotes: teamNotesWithInitials,
      totals,
      today: format(now, 'EEEE, MMM d'),
      yesterday: format(subDays(now, 1), 'EEEE, MMM d'),
      stats: [
        { icon: '👥', value: totals.members, label: 'Active Members' },
        { icon: '📅', value: totals.todayIssues, label: 'Today\'s Updates' },
        { icon: '📆', value: totals.yesterdayIssues, label: 'Yesterday\'s Updates' },
        { icon: '✅', value: totals.completedToday, label: 'Completed Today' }
      ]
    });
    
    logInfo('Linear notes dashboard viewed');
    
  } catch (error) {
    logError('Error loading Linear notes dashboard', error);
    res.status(500).send('Error loading Linear notes dashboard');
  }
}
