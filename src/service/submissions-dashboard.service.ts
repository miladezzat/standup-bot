import { Request, Response } from 'express';
import StandupEntry from '../models/standupEntry';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { logger } from '../utils/logger';
import { hasClerk } from '../index';
import { APP_TIMEZONE } from '../config';
import { createBaseViewData } from '../config/view-engine';

const TIMEZONE = APP_TIMEZONE;

interface StandupEntryView {
    slackUserId: string;
    slackUserName: string;
    yesterday: string;
    today: string;
    blockers: string;
    notes?: string;
    isDayOff?: boolean;
    dayOffReason?: string;
    aiSummary?: string;
    yesterdayHoursEstimate?: number;
    todayHoursEstimate?: number;
    createdAt: Date;
    hasBlocker: boolean;
    hasTimeEstimates: boolean;
}

interface DateGroupView {
    date: string;
    entries: StandupEntryView[];
}

export const getSubmissionsDashboard = async (req: Request, res: Response) => {
    try {
        logger.info('Submissions dashboard accessed', { date: req.query.date });
        let queryDate = req.query.date as string | undefined;
        
        // Default to today if no date specified
        const now = toZonedTime(new Date(), TIMEZONE);
        const todayStr = format(now, 'yyyy-MM-dd');
        const yesterdayStr = format(toZonedTime(new Date(Date.now() - 24 * 60 * 60 * 1000), TIMEZONE), 'yyyy-MM-dd');
        
        // Determine view mode
        let isToday = false;
        let isYesterday = false;
        let isAllTime = false;
        
        if (queryDate === 'today' || !queryDate) {
            // Default to today's view
            queryDate = todayStr;
            isToday = true;
        } else if (queryDate === yesterdayStr) {
            isYesterday = true;
        } else if (!/^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
            // Invalid date format - show last 30 days
            queryDate = undefined;
            isAllTime = true;
        }

        let standupEntries;
        if (queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
            standupEntries = await StandupEntry.find({ date: queryDate }).sort({ createdAt: -1 });
        } else {
            // Get last 30 days of standups
            isAllTime = true;
            const thirtyDaysAgo = format(
                toZonedTime(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), TIMEZONE),
                'yyyy-MM-dd'
            );
            standupEntries = await StandupEntry.find({ 
                date: { $gte: thirtyDaysAgo } 
            }).sort({ date: -1, createdAt: -1 });
        }

        // Group by date
        const entriesByDateMap = new Map<string, typeof standupEntries>();
        const uniqueUsers = new Set<string>();
        
        for (const entry of standupEntries) {
            if (!entriesByDateMap.has(entry.date)) {
                entriesByDateMap.set(entry.date, []);
            }
            entriesByDateMap.get(entry.date)!.push(entry);
            uniqueUsers.add(entry.slackUserId);
        }

        // Convert Map to array for template
        const entriesByDate: DateGroupView[] = Array.from(entriesByDateMap.entries())
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([date, entries]) => ({
                date,
                entries: entries.map(entry => {
                    const hasBlocker = !!(entry.blockers && entry.blockers.trim().toLowerCase() !== 'none' && entry.blockers.trim().toLowerCase() !== 'n/a' && entry.blockers.trim() !== '');
                    return {
                        slackUserId: entry.slackUserId,
                        slackUserName: entry.slackUserName,
                        yesterday: entry.yesterday,
                        today: entry.today,
                        blockers: entry.blockers,
                        notes: entry.notes,
                        isDayOff: entry.isDayOff,
                        dayOffReason: entry.dayOffReason,
                        aiSummary: entry.aiSummary,
                        yesterdayHoursEstimate: entry.yesterdayHoursEstimate,
                        todayHoursEstimate: entry.todayHoursEstimate,
                        createdAt: entry.createdAt,
                        hasBlocker,
                        hasTimeEstimates: !!(entry.yesterdayHoursEstimate || entry.todayHoursEstimate)
                    };
                })
            }));

        // Calculate blocker and day-off counts
        const blockerCount = standupEntries.filter(e => 
            e.blockers && e.blockers.trim().toLowerCase() !== 'none' && 
            e.blockers.trim().toLowerCase() !== 'n/a' && e.blockers.trim() !== ''
        ).length;
        const dayOffCount = standupEntries.filter(e => e.isDayOff).length;

        // Render template
        res.render('submissions', {
            ...createBaseViewData('📝 Standup Submissions', 'submissions', !!hasClerk),
            queryDate: queryDate || todayStr,
            yesterdayDate: yesterdayStr,
            isToday,
            isYesterday,
            isAllTime,
            entriesByDate,
            totalSubmissions: standupEntries.length,
            totalDays: entriesByDateMap.size,
            uniqueContributors: uniqueUsers.size,
            blockerCount,
            dayOffCount,
            pageStyles: submissionsStyles
        });
    } catch (error) {
        logger.error('Error generating submissions dashboard:', error);
        res.status(500).send('Error generating dashboard');
    }
};

// Clean, modern styles for submissions dashboard
const submissionsStyles = `
/* STATS BAR */
.stats-bar {
    display: flex;
    justify-content: center;
    gap: 3rem;
    background: white;
    border-radius: 50px;
    padding: 0.875rem 2.5rem;
    margin-bottom: 1.25rem;
    box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}

.stat-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.stat-number {
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--gray-800);
}

.stat-label {
    font-size: 0.8rem;
    color: var(--gray-500);
    font-weight: 500;
}

.stat-item.blocker .stat-number {
    color: #ef4444;
}

/* DATE NAV */
.date-nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    gap: 1rem;
    flex-wrap: wrap;
}

.date-tabs {
    display: flex;
    background: white;
    border-radius: 10px;
    padding: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

.tab {
    padding: 0.5rem 1.25rem;
    color: var(--gray-600);
    text-decoration: none;
    font-weight: 600;
    font-size: 0.85rem;
    border-radius: 8px;
    transition: all 0.2s;
}

.tab:hover {
    color: var(--gray-800);
}

.tab.active {
    background: var(--primary);
    color: white;
}

.date-picker-group {
    display: flex;
    gap: 0.5rem;
}

.date-picker-group input {
    padding: 0.5rem 0.75rem;
    border: 2px solid var(--gray-200);
    border-radius: 8px;
    font-size: 0.85rem;
}

.date-picker-group input:focus {
    outline: none;
    border-color: var(--primary);
}

.btn-go {
    padding: 0.5rem 1rem;
    background: var(--primary);
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
}

.btn-go:hover {
    background: var(--primary-dark);
}

/* DATE HEADER */
.date-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1.25rem;
    background: linear-gradient(135deg, var(--primary), var(--secondary));
    border-radius: 12px;
    margin: 1.5rem 0 1rem;
    color: white;
    font-weight: 600;
}

.date-header .count {
    background: rgba(255,255,255,0.25);
    padding: 0.25rem 0.75rem;
    border-radius: 20px;
    font-size: 0.8rem;
}

/* CARDS GRID */
.cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 1rem;
}

/* CARD */
.card {
    background: white;
    border-radius: 16px;
    padding: 1.25rem;
    box-shadow: 0 2px 12px rgba(0,0,0,0.06);
    transition: all 0.25s ease;
    border: 2px solid transparent;
}

.card:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 25px rgba(0,0,0,0.1);
}

.card.has-blocker {
    border-color: #fecaca;
    background: linear-gradient(135deg, #fef2f2 0%, white 30%);
}

/* CARD TOP */
.card-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1rem;
}

.user {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.avatar {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 700;
    font-size: 1rem;
    flex-shrink: 0;
}

.user-info {
    display: flex;
    flex-direction: column;
}

.user-info .name {
    font-weight: 600;
    color: var(--gray-800);
    text-decoration: none;
    font-size: 0.95rem;
}

.user-info .name:hover {
    color: var(--primary);
}

.user-info .time {
    font-size: 0.75rem;
    color: var(--gray-400);
}

.badges {
    display: flex;
    gap: 0.35rem;
}

.badge {
    padding: 0.3rem 0.65rem;
    border-radius: 6px;
    font-size: 0.7rem;
    font-weight: 600;
}

.badge.danger {
    background: #fef2f2;
    color: #dc2626;
}

.badge.time {
    background: #e0f2fe;
    color: #0369a1;
}

/* AI BOX */
.ai-box {
    display: flex;
    gap: 0.6rem;
    padding: 0.85rem;
    background: linear-gradient(135deg, #fef9c3, #fef3c7);
    border-radius: 10px;
    margin-bottom: 1rem;
}

.ai-icon {
    flex-shrink: 0;
}

.ai-box p {
    margin: 0;
    font-size: 0.8rem;
    color: #854d0e;
    line-height: 1.5;
}

/* DAY OFF */
.dayoff-box {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: #eff6ff;
    border-radius: 10px;
}

.dayoff-box strong {
    display: block;
    color: #1e40af;
    font-size: 0.9rem;
}

.dayoff-box p {
    margin: 0;
    font-size: 0.8rem;
    color: #3b82f6;
}

/* SECTIONS */
.section {
    margin-bottom: 0.75rem;
}

.section:last-child {
    margin-bottom: 0;
}

.section-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.35rem;
}

.section-head .icon {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 0.65rem;
    font-weight: 700;
}

.section.completed .icon { background: #10b981; }
.section.planned .icon { background: #667eea; }
.section.blocker .icon { background: #ef4444; }
.section.notes .icon { background: #94a3b8; }

.section-head .title {
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--gray-500);
    letter-spacing: 0.05em;
}

.section-head .hours {
    margin-left: auto;
    font-size: 0.7rem;
    font-weight: 600;
    color: #0369a1;
    background: #e0f2fe;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
}

.section-body {
    font-size: 0.85rem;
    color: var(--gray-700);
    line-height: 1.6;
    padding-left: 1.5rem;
    white-space: pre-wrap;
}

.section.blocker .section-body {
    color: #dc2626;
    background: #fef2f2;
    padding: 0.65rem 0.85rem;
    border-radius: 8px;
    margin-left: 1.5rem;
    border-left: 3px solid #fca5a5;
}

/* EMPTY STATE */
.empty-state {
    background: white;
    border-radius: 20px;
    padding: 4rem 2rem;
    text-align: center;
    box-shadow: 0 4px 15px rgba(0,0,0,0.06);
}

.empty-icon {
    font-size: 3.5rem;
    margin-bottom: 1rem;
}

.empty-state h3 {
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--gray-800);
    margin: 0 0 0.5rem;
}

.empty-state p {
    color: var(--gray-500);
    margin: 0 0 1.5rem;
}

.btn-refresh {
    padding: 0.65rem 1.5rem;
    background: var(--primary);
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
}

.btn-refresh:hover {
    background: var(--primary-dark);
}

/* QUICK LINKS */
.quick-links {
    display: flex;
    justify-content: center;
    gap: 0.75rem;
    margin-top: 2rem;
    flex-wrap: wrap;
}

.quick-links a {
    padding: 0.5rem 1rem;
    background: white;
    color: var(--gray-600);
    text-decoration: none;
    border-radius: 8px;
    font-size: 0.8rem;
    font-weight: 500;
    box-shadow: 0 2px 6px rgba(0,0,0,0.05);
    transition: all 0.2s;
}

.quick-links a:hover {
    background: var(--primary);
    color: white;
    transform: translateY(-2px);
}

/* RESPONSIVE */
@media (max-width: 768px) {
    .stats-bar {
        gap: 1.5rem;
        padding: 0.75rem 1.5rem;
    }
    
    .date-nav {
        flex-direction: column;
        align-items: stretch;
    }
    
    .date-tabs {
        justify-content: center;
    }
    
    .date-picker-group {
        justify-content: center;
    }
    
    .cards-grid {
        grid-template-columns: 1fr;
    }
    
    .section-body {
        padding-left: 0;
    }
    
    .section.blocker .section-body {
        margin-left: 0;
    }
}
`;

