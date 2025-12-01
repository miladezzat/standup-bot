import { Request, Response } from 'express';
import StandupEntry from '../models/standupEntry';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { generateDailyTeamSummary } from './ai-summary.service';
import { hasClerk } from '../index';
import { APP_TIMEZONE } from '../config';
import { createBaseViewData } from '../config/view-engine';
import { logger } from '../utils/logger';

const TIMEZONE = APP_TIMEZONE;

interface StandupSummaryView {
    slackUserName: string;
    aiSummary?: string;
    totalHours: number;
}

export const getDailySummaryView = async (req: Request, res: Response) => {
    try {
        let queryDate = req.query.date as string | undefined;

        if (queryDate === 'today') {
            const now = toZonedTime(new Date(), TIMEZONE);
            queryDate = format(now, 'yyyy-MM-dd');
        }

        const date = queryDate || format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');

        // Get all standups for the date
        const standups = await StandupEntry.find({ date }).sort({ slackUserName: 1 });

        if (standups.length === 0) {
            return res.render('daily-summary-empty', {
                ...createBaseViewData(`Daily Summary - ${date}`, 'daily-summary', !!hasClerk),
                message: `No standup submissions found for ${date}.`,
                pageStyles: emptyStyles
            });
        }

        // Generate AI summary if available
        let aiSummary = '';
        if (process.env.OPENAI_API_KEY) {
            try {
                aiSummary = await generateDailyTeamSummary(date);
            } catch (error) {
                logger.error('Error generating summary:', error);
            }
        }

        // Transform standups for template
        const standupViews: StandupSummaryView[] = standups.map(s => ({
            slackUserName: s.slackUserName,
            aiSummary: s.aiSummary,
            totalHours: (s.yesterdayHoursEstimate || 0) + (s.todayHoursEstimate || 0)
        }));

        // Calculate stats
        const blockerCount = standups.filter(s => s.blockers && s.blockers.trim()).length;
        const totalHours = Math.round(standups.reduce((sum, s) => 
            sum + (s.yesterdayHoursEstimate || 0) + (s.todayHoursEstimate || 0), 0
        ));

        // Render template
        res.render('daily-summary', {
            ...createBaseViewData(`Daily Summary - ${date}`, 'daily-summary', !!hasClerk),
            date,
            aiSummary,
            standups: standupViews,
            submissions: standups.length,
            teamMembers: new Set(standups.map(s => s.slackUserId)).size,
            blockerCount,
            totalHours,
            pageStyles: dailySummaryStyles
        });
    } catch (error) {
        logger.error('Error generating daily summary view:', error);
        res.status(500).send('Error generating summary');
    }
};

const emptyStyles = `
.empty-box {
    background: white;
    padding: 3rem;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    text-align: center;
    max-width: 500px;
    margin: 4rem auto;
}

.empty-box h1 {
    margin-bottom: 1rem;
}

.empty-box a {
    color: #667eea;
}
`;

const dailySummaryStyles = `
.back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: white;
    text-decoration: none;
    font-weight: 600;
    font-size: 0.9375rem;
    margin-bottom: 1.5rem;
    padding: 0.75rem 1.25rem;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 50px;
    backdrop-filter: blur(10px);
    transition: all 0.3s;
}

.back-link:hover {
    background: rgba(255, 255, 255, 0.25);
    transform: translateX(-4px);
}

.page-header {
    text-align: center;
    margin-bottom: 2rem;
    color: white;
}

.page-header h1 {
    font-size: 2.5rem;
    font-weight: 800;
    margin-bottom: 0.5rem;
}

.page-header p {
    font-size: 1.125rem;
    opacity: 0.9;
}

/* Date Picker */
.date-picker {
    background: white;
    padding: 1rem 1.5rem;
    border-radius: 12px;
    margin-bottom: 2rem;
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.date-picker strong {
    color: var(--gray-700);
}

.date-picker input {
    padding: 0.5rem 0.75rem;
    border: 2px solid var(--gray-200);
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.875rem;
}

.date-picker input:focus {
    outline: none;
    border-color: #667eea;
}

.date-picker button {
    padding: 0.5rem 1rem;
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.875rem;
    transition: transform 0.2s, box-shadow 0.2s;
}

.date-picker button:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

/* Stats Grid */
.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
}

.stat-card {
    background: white;
    border-radius: 12px;
    padding: 1.25rem;
    text-align: center;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.stat-value {
    font-size: 2rem;
    font-weight: 800;
    color: var(--gray-800);
}

.stat-label {
    font-size: 0.875rem;
    color: var(--gray-600);
}

/* AI Summary Card */
.ai-summary-card {
    background: linear-gradient(135deg, #fff7ed, #fef3c7);
    border-radius: 16px;
    padding: 1.5rem;
    margin-bottom: 2rem;
    border-left: 4px solid #f59e0b;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.ai-summary-header {
    font-size: 1.125rem;
    font-weight: 700;
    color: #92400e;
    margin-bottom: 1rem;
}

.ai-summary-content {
    font-size: 0.9375rem;
    color: #78350f;
    line-height: 1.7;
    white-space: pre-wrap;
}

/* Individual Summaries */
.individual-summaries {
    background: white;
    border-radius: 16px;
    padding: 1.5rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.section-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--gray-800);
    margin-bottom: 1rem;
}

.person-card {
    padding: 1rem;
    background: var(--gray-50);
    border-radius: 10px;
    margin-bottom: 0.75rem;
    border-left: 3px solid #667eea;
}

.person-card:last-child {
    margin-bottom: 0;
}

.person-name {
    font-weight: 600;
    color: var(--gray-800);
    margin-bottom: 0.5rem;
}

.person-hours {
    display: inline-block;
    background: #e0f2fe;
    color: #0369a1;
    padding: 0.2rem 0.5rem;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 600;
    margin-left: 0.5rem;
}

.person-summary {
    font-size: 0.875rem;
    color: #1565c0;
    line-height: 1.6;
    font-style: italic;
}

.person-summary.no-summary {
    color: var(--gray-500);
    font-style: normal;
}

/* Responsive */
@media (max-width: 768px) {
    .stats-grid {
        grid-template-columns: repeat(2, 1fr);
    }
    
    .date-picker {
        flex-direction: column;
        align-items: stretch;
    }
    
    .date-picker button {
        width: 100%;
    }
}
`;
