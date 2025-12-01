import { Request, Response } from 'express';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import Break from '../models/break';
import { APP_TIMEZONE } from '../config';
import { logInfo, logError } from '../utils/logger';
import { hasClerk } from '../index';
import { createBaseViewData } from '../config/view-engine';

const TIMEZONE = APP_TIMEZONE;

// Page-specific styles for breaks dashboard
const pageStyles = `
  .page-header {
    text-align: center;
    margin-bottom: 2rem;
  }
  
  .page-header h1 {
    font-size: 2rem;
    color: white;
    margin-bottom: 0.5rem;
    text-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
  
  .page-header p {
    color: rgba(255, 255, 255, 0.9);
  }
  
  .date-picker {
    margin-bottom: 1.5rem;
  }
  
  .date-form {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  
  .date-form label {
    font-weight: 500;
    color: var(--gray-700);
  }
  
  .content-grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 1.5rem;
  }
  
  @media (max-width: 768px) {
    .content-grid {
      grid-template-columns: 1fr;
    }
  }
  
  .breaks-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .break-card {
    background: var(--gray-50);
    padding: 1rem;
    border-radius: var(--radius);
    border: 1px solid var(--gray-200);
  }
  
  .break-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  
  .break-user {
    font-weight: 600;
    color: var(--dark);
  }
  
  .break-time {
    color: var(--gray-600);
    font-size: 0.875rem;
  }
  
  .break-details {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 0.875rem;
  }
  
  .break-duration {
    background: var(--primary);
    color: white;
    padding: 0.25rem 0.75rem;
    border-radius: 50px;
    font-weight: 500;
  }
  
  .break-reason {
    color: var(--gray-600);
    font-style: italic;
  }
  
  .user-summaries {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .user-summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background: var(--gray-50);
    border-radius: var(--radius);
    border: 1px solid var(--gray-200);
  }
  
  .user-summary .user-name {
    font-weight: 500;
    color: var(--dark);
  }
  
  .user-summary .user-stats {
    color: var(--gray-600);
    font-size: 0.875rem;
  }
  
  .empty-state {
    text-align: center;
    padding: 3rem 2rem;
    color: var(--gray-600);
  }
  
  .empty-state .empty-icon {
    font-size: 3rem;
    display: block;
    margin-bottom: 1rem;
    opacity: 0.5;
  }
`;

/**
 * Get breaks dashboard view
 */
export async function getBreaksDashboard(req: Request, res: Response) {
  try {
    const now = toZonedTime(new Date(), TIMEZONE);
    const dateParam = req.query.date as string;
    const viewDate = dateParam || format(now, 'yyyy-MM-dd');
    
    // Get breaks for the selected date
    const breaks = await Break.find({ date: viewDate }).sort({ createdAt: -1 });
    
    // Get weekly summary
    const weekStart = format(startOfWeek(new Date(viewDate), { weekStartsOn: 0 }), 'yyyy-MM-dd');
    const weekEnd = format(endOfWeek(new Date(viewDate), { weekStartsOn: 0 }), 'yyyy-MM-dd');
    const weeklyBreaks = await Break.find({
      date: { $gte: weekStart, $lte: weekEnd }
    });
    
    // Calculate stats
    const totalBreaksToday = breaks.length;
    const totalMinutesToday = breaks.reduce((sum, b) => sum + b.durationMinutes, 0);
    const uniqueUsersToday = new Set(breaks.map(b => b.slackUserId)).size;
    const totalBreaksWeek = weeklyBreaks.length;
    
    // Group by user for today
    const userBreaksMap: Record<string, { userName: string; breakCount: number; totalMinutes: number }> = {};
    breaks.forEach(b => {
      if (!userBreaksMap[b.slackUserId]) {
        userBreaksMap[b.slackUserId] = { userName: b.slackUserName, breakCount: 0, totalMinutes: 0 };
      }
      userBreaksMap[b.slackUserId].breakCount++;
      userBreaksMap[b.slackUserId].totalMinutes += b.durationMinutes;
    });
    
    const userBreaks = Object.values(userBreaksMap);
    
    // Stats for template
    const stats = [
      { value: totalBreaksToday, label: 'Breaks Today' },
      { value: totalMinutesToday, label: 'Minutes Today' },
      { value: uniqueUsersToday, label: 'Team Members' },
      { value: totalBreaksWeek, label: 'Breaks This Week' }
    ];

    // Render with Handlebars
    res.render('breaks', {
      ...createBaseViewData('Breaks Dashboard', 'breaks', !!hasClerk),
      viewDate,
      breaks: breaks.map(b => ({
        slackUserName: b.slackUserName,
        startTime: b.startTime,
        endTime: b.endTime,
        durationMinutes: b.durationMinutes,
        reason: b.reason
      })),
      userBreaks,
      stats,
      pageStyles,
      autoRefresh: true,
      autoRefreshMs: 120000
    });

    logInfo('Breaks dashboard viewed', { date: viewDate });

  } catch (error) {
    logError('Error loading breaks dashboard', error);
    res.status(500).send('Error loading breaks dashboard');
  }
}
