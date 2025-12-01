import type { Request, Response } from 'express';
import { format, parseISO, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import StandupEntry from '../models/standupEntry';
import { slackWebClient } from '../singleton';
import { APP_TIMEZONE } from '../config';
import { logger } from '../utils/logger';
import { createBaseViewData } from '../config/view-engine';
import { hasClerk } from '../index';

const TIMEZONE = APP_TIMEZONE;

interface WorkflowUser {
  userId: string;
  userName: string;
  yesterdayTasks: string[];
  todayTasks: string[];
  blockers: string;
  hasBlocker: boolean;
}

interface TopContributor {
  userName: string;
  taskCount: number;
}

interface BlockerUser {
  userName: string;
  blockers: string;
}

interface WorkflowData {
  date: string;
  teamMembers: number;
  completedTasks: number;
  plannedTasks: number;
  blockerCount: number;
  completedPercent: number;
  plannedPercent: number;
  users: WorkflowUser[];
  topContributors: TopContributor[];
  blockerUsers: BlockerUser[];
}

/**
 * Get user display name from Slack
 */
async function getUserDisplayName(userId: string): Promise<string> {
  try {
    const userInfo = await slackWebClient.users.info({ user: userId });
    return userInfo?.user?.profile?.display_name || 
           userInfo?.user?.profile?.real_name || 
           userInfo?.user?.name || 
           userId;
  } catch (error) {
    logger.error('Error fetching user info for workflow', { userId, error });
    return userId;
  }
}

/**
 * Parse tasks from standup text - splits by common delimiters
 */
function parseTasks(text: string): string[] {
  if (!text || text.trim() === '') return [];
  
  // Split by newlines, bullet points, numbers, or dashes
  const lines = text
    .split(/[\n\r]+/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      // Remove common prefixes like "- ", "• ", "1. ", "* "
      return line.replace(/^[-•*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim();
    })
    .filter(line => line.length > 0);
  
  // If no line breaks, just return the whole text as one task
  if (lines.length === 0 && text.trim()) {
    return [text.trim()];
  }
  
  return lines;
}

/**
 * Serve the task workflow dashboard
 */
export async function serveWorkflowDashboard(req: Request, res: Response): Promise<void> {
  try {
    // Parse date from query or default to today
    let queryDate = req.query.date as string | undefined;
    
    if (queryDate === 'today' || !queryDate) {
      const now = toZonedTime(new Date(), TIMEZONE);
      queryDate = format(now, 'yyyy-MM-dd');
    }
    
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
      const now = toZonedTime(new Date(), TIMEZONE);
      queryDate = format(now, 'yyyy-MM-dd');
    }
    
    // Fetch all standup entries for this day
    const entries = await StandupEntry.find({ date: queryDate }).sort({ createdAt: -1 });
    
    // Group entries by user (keep only the latest per user)
    const userEntriesMap = new Map<string, typeof entries[0]>();
    for (const entry of entries) {
      if (!userEntriesMap.has(entry.slackUserId)) {
        userEntriesMap.set(entry.slackUserId, entry);
      }
    }
    
    // Build workflow data for each user
    const users: WorkflowUser[] = [];
    const userNames = new Map<string, string>();
    
    // Fetch all user names in parallel (or use stored names)
    const userIds = Array.from(userEntriesMap.keys());
    
    // Use slackUserName from entries if available, otherwise fetch from Slack
    for (const [userId, entry] of userEntriesMap) {
      if (entry.slackUserName) {
        userNames.set(userId, entry.slackUserName);
      }
    }
    
    // Fetch missing names from Slack
    const missingUserIds = userIds.filter(id => !userNames.has(id));
    if (missingUserIds.length > 0) {
      const namePromises = missingUserIds.map(async (userId) => {
        const name = await getUserDisplayName(userId);
        userNames.set(userId, name);
      });
      await Promise.all(namePromises);
    }
    
    // Build user workflow data
    for (const [userId, entry] of userEntriesMap) {
      const userName = userNames.get(userId) || userId;
      const yesterdayTasks = parseTasks(entry.yesterday || '');
      const todayTasks = parseTasks(entry.today || '');
      const hasBlocker = !!(entry.blockers && entry.blockers.trim() && entry.blockers.toLowerCase() !== 'none' && entry.blockers.toLowerCase() !== 'no' && entry.blockers.toLowerCase() !== 'n/a');
      
      users.push({
        userId,
        userName,
        yesterdayTasks,
        todayTasks,
        blockers: entry.blockers || '',
        hasBlocker
      });
    }
    
    // Sort users by total task count (most active first)
    users.sort((a, b) => {
      const aTotal = a.yesterdayTasks.length + a.todayTasks.length;
      const bTotal = b.yesterdayTasks.length + b.todayTasks.length;
      return bTotal - aTotal;
    });
    
    // Calculate stats
    const completedTasks = users.reduce((sum, u) => sum + u.yesterdayTasks.length, 0);
    const plannedTasks = users.reduce((sum, u) => sum + u.todayTasks.length, 0);
    const totalTasks = completedTasks + plannedTasks;
    const blockerCount = users.filter(u => u.hasBlocker).length;
    
    // Top contributors (top 5)
    const topContributors: TopContributor[] = users
      .slice(0, 5)
      .map(u => ({
        userName: u.userName,
        taskCount: u.yesterdayTasks.length + u.todayTasks.length
      }))
      .filter(c => c.taskCount > 0);
    
    // Users with blockers
    const blockerUsers: BlockerUser[] = users
      .filter(u => u.hasBlocker)
      .map(u => ({
        userName: u.userName,
        blockers: u.blockers
      }));
    
    // Format date for display
    const displayDate = format(parseISO(queryDate), 'MMM d, yyyy');
    
    // Prepare view data
    const workflowData: WorkflowData = {
      date: queryDate,
      teamMembers: users.length,
      completedTasks,
      plannedTasks,
      blockerCount,
      completedPercent: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      plannedPercent: totalTasks > 0 ? Math.round((plannedTasks / totalTasks) * 100) : 0,
      users,
      topContributors,
      blockerUsers
    };
    
    // Render the template
    res.render('workflow', {
      ...createBaseViewData(
        `Task Workflow - ${displayDate}`,
        'workflow',
        !!hasClerk
      ),
      ...workflowData
    });
    
  } catch (error) {
    logger.error('Error serving workflow dashboard', { error });
    res.status(500).render('error', {
      ...createBaseViewData('Error', 'workflow', !!hasClerk),
      message: 'Failed to load workflow dashboard',
      error: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
}
