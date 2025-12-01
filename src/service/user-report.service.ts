import { Request, Response } from 'express';
import StandupEntry from '../models/standupEntry';
import PerformanceMetrics from '../models/performanceMetrics';
import { format, subDays, startOfMonth, startOfYear, parseISO, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { getUserName } from '../helper';
import { getUserContributions, getUserStreak, generateContributionGraphHTML, getContributionGraphCSS } from './contribution-graph.service';
import { hasClerk } from '../index';
import { generatePerformanceInsights } from './ai-performance-analysis.service';
import { APP_TIMEZONE } from '../config';
import { createBaseViewData } from '../config/view-engine';
import { logger } from '../utils/logger';

const TIMEZONE = APP_TIMEZONE;

interface StandupView {
    date: string;
    yesterday: string;
    today: string;
    blockers: string;
    notes?: string;
    isDayOff?: boolean;
    dayOffReason?: string;
    createdAt: Date;
    hasBlocker: boolean;
}

interface OooFilter {
    label: string;
    url: string;
    active: boolean;
}

export const getUserReport = async (req: Request, res: Response) => {
    try {
        const userId = req.params.userId;
        const period = (req.query.period as string) || 'month';

        const now = toZonedTime(new Date(), TIMEZONE);
        let startDate: string;
        let endDate: string = format(now, 'yyyy-MM-dd');
        let periodLabel: string;

        // Calculate date range based on period
        switch (period) {
            case 'week':
                startDate = format(subDays(now, 7), 'yyyy-MM-dd');
                periodLabel = 'Last 7 Days';
                break;
            case 'month':
                startDate = format(startOfMonth(now), 'yyyy-MM-dd');
                periodLabel = 'This Month';
                break;
            case 'all':
            default:
                startDate = format(subDays(now, 365), 'yyyy-MM-dd');
                periodLabel = 'All Time';
                break;
        }

        // Fetch user's standups
        const standups = await StandupEntry.find({
            slackUserId: userId,
            date: { $gte: startDate, $lte: endDate }
        }).sort({ date: -1 });

        if (standups.length === 0) {
            return res.render('user-not-found', {
                ...createBaseViewData('User Not Found', 'user-report', !!hasClerk),
                message: 'No standup submissions found for this user in the selected period.',
                pageStyles: notFoundStyles
            });
        }

        const userName = standups[0].slackUserName;
        const { avatarUrl } = await getUserName(userId);

        // Calculate statistics
        const totalSubmissions = standups.length;
        const blockerCount = standups.filter(s => 
            s.blockers && s.blockers.trim() && 
            !s.blockers.toLowerCase().includes('none')
        ).length;
        const dayOffCount = standups.filter(s => s.isDayOff).length;

        // Count total tasks
        let totalTasks = 0;
        for (const standup of standups) {
            const yesterdayTasks = (standup.yesterday.match(/[•\-–]|\d+\./g) || []).length || 1;
            const todayTasks = (standup.today.match(/[•\-–]|\d+\./g) || []).length || 1;
            totalTasks += yesterdayTasks + todayTasks;
        }
        const avgTasksPerDay = Math.round((totalTasks / totalSubmissions) * 10) / 10;

        // Generate contribution graph data
        const contributions = await getUserContributions(userId, 90);
        const streak = await getUserStreak(userId);
        const contributionGraphHTML = generateContributionGraphHTML(contributions, streak);

        // Get performance metrics and AI insights
        let performanceScore = 0;
        let velocityTrend = 'stable';
        let riskLevel = 'low';
        let aiInsights: { strengths: string[], improvements: string[], recommendations: string[] } = { 
            strengths: [], improvements: [], recommendations: [] 
        };

        try {
            const perfMetrics = await PerformanceMetrics.findOne({
                slackUserId: userId,
                period: 'week'
            }).sort({ startDate: -1 }).lean();

            if (perfMetrics) {
                performanceScore = perfMetrics.overallScore || 0;
                velocityTrend = perfMetrics.velocityTrend || 'stable';
                riskLevel = perfMetrics.riskLevel || 'low';
            }

            if (process.env.OPENAI_API_KEY) {
                aiInsights = await generatePerformanceInsights(userId, 30);
            }
        } catch (error) {
            logger.error('Error fetching performance data:', error);
        }

        // Day off history filtering
        const requestedOooRange = (req.query.oooRange as string) || 'month';
        const todayStr = format(now, 'yyyy-MM-dd');
        let oooStartStr = format(startOfMonth(now), 'yyyy-MM-dd');
        let oooEndStr = todayStr;

        switch (requestedOooRange) {
            case 'today':
                oooStartStr = todayStr;
                oooEndStr = todayStr;
                break;
            case 'year':
                oooStartStr = format(startOfYear(now), 'yyyy-MM-dd');
                oooEndStr = todayStr;
                break;
            case 'month':
            default:
                oooStartStr = format(startOfMonth(now), 'yyyy-MM-dd');
                oooEndStr = todayStr;
                break;
        }

        const dayOffEntries = await StandupEntry.find({
            slackUserId: userId,
            isDayOff: true,
            date: { $gte: oooStartStr, $lte: oooEndStr }
        }).sort({ date: -1 }).lean();

        // Build OOO filter URLs
        const oooFilters: OooFilter[] = [
            { label: 'Today', url: `/user/${userId}?period=${period}&oooRange=today`, active: requestedOooRange === 'today' },
            { label: 'This Month', url: `/user/${userId}?period=${period}&oooRange=month`, active: requestedOooRange === 'month' },
            { label: 'This Year', url: `/user/${userId}?period=${period}&oooRange=year`, active: requestedOooRange === 'year' }
        ];

        // Transform standups for template
        const standupViews: StandupView[] = standups.map(s => ({
            date: s.date,
            yesterday: s.yesterday,
            today: s.today,
            blockers: s.blockers,
            notes: s.notes,
            isDayOff: s.isDayOff,
            dayOffReason: s.dayOffReason,
            createdAt: s.createdAt,
            hasBlocker: !!(s.blockers && s.blockers.trim() && !s.blockers.toLowerCase().includes('none'))
        }));

        const hasAiInsights = aiInsights.strengths.length > 0 || 
                             aiInsights.improvements.length > 0 || 
                             aiInsights.recommendations.length > 0;

        // Render template
        res.render('user-report', {
            ...createBaseViewData(`${userName}'s Report`, 'user-report', !!hasClerk),
            userId,
            userName,
            avatarUrl,
            period,
            periodLabel,
            totalSubmissions,
            totalTasks,
            avgTasksPerDay,
            blockerCount,
            dayOffCount,
            performanceScore,
            velocityTrend,
            riskLevel,
            aiInsights,
            hasAiInsights,
            contributionGraphHTML,
            dayOffEntries,
            oooFilters,
            standups: standupViews,
            pageStyles: userReportStyles + getContributionGraphCSS()
        });
    } catch (error) {
        logger.error('Error generating user report:', error);
        res.status(500).send('Error generating report');
    }
};

const notFoundStyles = `
.error-box {
    background: white;
    padding: 3rem;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    text-align: center;
    max-width: 500px;
    margin: 4rem auto;
}

.error-box h1 {
    margin-bottom: 1rem;
}

.error-box a {
    color: #667eea;
}
`;

const userReportStyles = `
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

/* User Header Card */
.user-header-card {
    background: white;
    border-radius: 16px;
    padding: 2rem;
    margin-bottom: 2rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1.5rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.user-profile {
    display: flex;
    align-items: center;
    gap: 1.5rem;
}

.user-avatar-large {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 700;
    font-size: 2rem;
    object-fit: cover;
}

.user-info-main h1 {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--gray-800);
    margin: 0 0 0.25rem 0;
}

.user-period {
    color: var(--gray-600);
    font-size: 0.875rem;
    margin: 0;
}

.performance-badge {
    text-align: center;
    padding: 1rem 1.5rem;
    background: var(--gray-50);
    border-radius: 12px;
}

.performance-badge .score {
    font-size: 2.5rem;
    font-weight: 800;
    background: linear-gradient(135deg, #667eea, #764ba2);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.performance-badge.high .score {
    background: linear-gradient(135deg, #ef4444, #dc2626);
    -webkit-background-clip: text;
    background-clip: text;
}

.performance-badge .label {
    font-size: 0.75rem;
    color: var(--gray-600);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.performance-badge .trend {
    font-size: 0.875rem;
    font-weight: 600;
    margin-top: 0.5rem;
}

.performance-badge .trend.up { color: #10b981; }
.performance-badge .trend.down { color: #ef4444; }
.performance-badge .trend.stable { color: var(--gray-600); }

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

.stat-card.warning {
    background: #fffbeb;
    border: 1px solid #fde68a;
}

.stat-icon {
    font-size: 1.5rem;
    margin-bottom: 0.5rem;
}

.stat-value {
    font-size: 1.75rem;
    font-weight: 800;
    color: var(--gray-800);
}

.stat-label {
    font-size: 0.75rem;
    color: var(--gray-600);
}

/* Contribution Section */
.contribution-section {
    background: white;
    border-radius: 16px;
    padding: 1.5rem;
    margin-bottom: 2rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.contribution-section h3 {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--gray-800);
    margin: 0 0 1rem 0;
}

/* Day Off Section */
.ooo-section {
    background: white;
    border-radius: 16px;
    padding: 1.5rem;
    margin-bottom: 2rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.ooo-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 1rem;
}

.ooo-header h3 {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--gray-800);
    margin: 0;
}

.ooo-filters {
    display: flex;
    gap: 0.5rem;
}

.ooo-filter-btn {
    padding: 0.5rem 1rem;
    background: var(--gray-100);
    color: var(--gray-700);
    text-decoration: none;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.2s;
}

.ooo-filter-btn:hover {
    background: var(--gray-200);
}

.ooo-filter-btn.active {
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
}

.ooo-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.ooo-item {
    display: flex;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: var(--gray-50);
    border-radius: 8px;
}

.ooo-date {
    font-weight: 600;
    color: var(--gray-800);
}

.ooo-reason {
    color: var(--gray-600);
}

/* AI Insights Section */
.insights-section {
    background: white;
    border-radius: 16px;
    padding: 1.5rem;
    margin-bottom: 2rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.insights-section h3 {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--gray-800);
    margin: 0 0 1rem 0;
}

.insights-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1rem;
}

.insight-card {
    padding: 1.25rem;
    border-radius: 12px;
    border-left: 4px solid;
}

.insight-card.strengths {
    background: linear-gradient(135deg, #dcfce7, #bbf7d0);
    border-left-color: #10b981;
}

.insight-card.improvements {
    background: linear-gradient(135deg, #fef9c3, #fef08a);
    border-left-color: #f59e0b;
}

.insight-card.recommendations {
    background: linear-gradient(135deg, #dbeafe, #bfdbfe);
    border-left-color: #3b82f6;
}

.insight-card h4 {
    font-size: 1rem;
    font-weight: 700;
    margin: 0 0 0.75rem 0;
    color: var(--gray-800);
}

.insight-card ul {
    list-style: none;
    padding: 0;
    margin: 0;
}

.insight-card li {
    padding: 0.35rem 0;
    padding-left: 1.25rem;
    position: relative;
    font-size: 0.875rem;
    color: var(--gray-700);
    line-height: 1.5;
}

.insight-card li::before {
    content: '★';
    position: absolute;
    left: 0;
}

/* Filters */
.filters {
    background: white;
    border-radius: 12px;
    padding: 1rem 1.5rem;
    margin-bottom: 2rem;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.filter-label {
    font-weight: 600;
    color: var(--gray-700);
}

.filter-btn {
    padding: 0.5rem 1rem;
    background: var(--gray-100);
    color: var(--gray-700);
    text-decoration: none;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.2s;
}

.filter-btn:hover {
    background: var(--gray-200);
}

.filter-btn.active {
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
}

/* Standup Cards */
.content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.standup-card {
    background: white;
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.standup-card.has-blocker {
    border-left: 4px solid #ef4444;
}

.standup-card.day-off-card {
    border-left: 4px solid #3b82f6;
    background: linear-gradient(135deg, #f0f9ff 0%, white 100%);
}

.date-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--gray-100);
}

.date-title {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--gray-800);
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
}

.blocker-badge {
    background: #fef2f2;
    color: #dc2626;
    font-size: 0.65rem;
    font-weight: 700;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    text-transform: uppercase;
}

.dayoff-badge {
    background: #eff6ff;
    color: #2563eb;
    font-size: 0.65rem;
    font-weight: 700;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    text-transform: uppercase;
}

.timestamp {
    font-size: 0.875rem;
    color: var(--gray-500);
}

.section {
    margin-bottom: 1rem;
}

.section:last-child {
    margin-bottom: 0;
}

.section-label {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--gray-600);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.5rem;
}

.section-content {
    font-size: 0.9rem;
    color: var(--gray-700);
    line-height: 1.7;
    padding: 0.75rem 1rem;
    background: var(--gray-50);
    border-radius: 8px;
    white-space: pre-wrap;
}

.section-content.blocker-content {
    background: #fff5f5;
    border-left: 3px solid #ef4444;
}

.section-content.notes-content {
    background: #f8fafc;
    border-left: 3px solid #3b82f6;
}

.section-content.dayoff-content {
    background: #fffbeb;
    border-left: 3px solid #f59e0b;
}

/* Responsive */
@media (max-width: 768px) {
    .user-header-card {
        flex-direction: column;
        text-align: center;
    }
    
    .user-profile {
        flex-direction: column;
    }
    
    .stats-grid {
        grid-template-columns: repeat(2, 1fr);
    }
    
    .date-header {
        flex-direction: column;
    }
    
    .insights-grid {
        grid-template-columns: 1fr;
    }
}
`;
