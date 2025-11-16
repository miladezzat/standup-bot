import { Request, Response } from 'express';
import StandupEntry from '../models/standupEntry';
import PerformanceMetrics from '../models/performanceMetrics';
import { format, subDays, startOfMonth, endOfMonth, startOfYear, parseISO, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { getUserName } from '../helper';
import { getUserContributions, getUserStreak, generateContributionGraphHTML, getContributionGraphCSS } from './contribution-graph.service';
import { hasClerk } from '../index';
import { generatePerformanceInsights } from './ai-performance-analysis.service';
import { escapeHtml } from '../middleware/security.middleware';

const TIMEZONE = 'Africa/Cairo';

export const getUserReport = async (req: Request, res: Response) => {
    try {
        const userId = req.params.userId;
        const period = (req.query.period as string) || 'month'; // 'week', 'month', 'all'

        const now = toZonedTime(new Date(), TIMEZONE);
        let startDate: string;
        let endDate: string = format(now, 'yyyy-MM-dd');

        // Calculate date range based on period
        switch (period) {
            case 'week':
                startDate = format(subDays(now, 7), 'yyyy-MM-dd');
                break;
            case 'month':
                startDate = format(startOfMonth(now), 'yyyy-MM-dd');
                break;
            case 'all':
            default:
                startDate = format(subDays(now, 365), 'yyyy-MM-dd'); // Last year
                break;
        }

        // Fetch user's standups
        const standups = await StandupEntry.find({
            slackUserId: userId,
            date: { $gte: startDate, $lte: endDate }
        }).sort({ date: -1 });

        if (standups.length === 0) {
            res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>User Not Found</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>
        body {
            font-family: 'Inter', Arial, sans-serif;
            background: #f5f7fa;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
        }
        .error-box {
            background: white;
            padding: 3rem;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="error-box">
        <h1>📊 No Data Found</h1>
        <p>No standup submissions found for this user in the selected period.</p>
        <a href="/submissions">← Back to All Submissions</a>
    </div>
</body>
</html>
            `);
            return;
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

        // Get unique dates
        const submissionDates = standups.map(s => s.date);

        // Generate contribution graph data
        const contributions = await getUserContributions(userId, 90); // Last 90 days
        const streak = await getUserStreak(userId);
        const contributionGraphHTML = generateContributionGraphHTML(contributions, streak);

        // Get performance metrics and AI insights
        let performanceScore = 0;
        let velocityTrend = 'stable';
        let riskLevel = 'low';
        let aiInsights: { strengths: string[], improvements: string[], recommendations: string[] } = { strengths: [], improvements: [], recommendations: [] };

        try {
            // Get latest performance metrics
            const perfMetrics = await PerformanceMetrics.findOne({
                slackUserId: userId,
                period: 'week'
            }).sort({ startDate: -1 }).lean();

            if (perfMetrics) {
                performanceScore = perfMetrics.overallScore || 0;
                velocityTrend = perfMetrics.velocityTrend || 'stable';
                riskLevel = perfMetrics.riskLevel || 'low';
            }

            // Generate AI insights if OpenAI is configured
            if (process.env.OPENAI_API_KEY) {
                aiInsights = await generatePerformanceInsights(userId, 30);
            }
        } catch (error) {
            console.error('Error fetching performance data:', error);
        }

        const requestedOooRange = (req.query.oooRange as string) || 'month';
        const customOooStart = (req.query.oooStart as string) || '';
        const customOooEnd = (req.query.oooEnd as string) || '';
        const todayStr = format(now, 'yyyy-MM-dd');
        let effectiveOooRange = requestedOooRange || 'month';
        let oooStartStr = todayStr;
        let oooEndStr = todayStr;

        const setDefaultMonthRange = () => {
            effectiveOooRange = 'month';
            oooStartStr = format(startOfMonth(now), 'yyyy-MM-dd');
            oooEndStr = todayStr;
        };

        switch (requestedOooRange) {
            case 'today':
                oooStartStr = todayStr;
                oooEndStr = todayStr;
                break;
            case 'year':
                oooStartStr = format(startOfYear(now), 'yyyy-MM-dd');
                oooEndStr = todayStr;
                break;
            case 'custom': {
                const parsedStart = customOooStart ? parseISO(customOooStart) : null;
                const parsedEnd = customOooEnd ? parseISO(customOooEnd) : null;
                if (parsedStart && isValid(parsedStart) && parsedEnd && isValid(parsedEnd) && parsedStart <= parsedEnd) {
                    oooStartStr = format(parsedStart, 'yyyy-MM-dd');
                    oooEndStr = format(parsedEnd, 'yyyy-MM-dd');
                } else {
                    setDefaultMonthRange();
                }
                break;
            }
            case 'month':
            default:
                setDefaultMonthRange();
                break;
        }

        const dayOffEntries = await StandupEntry.find({
            slackUserId: userId,
            isDayOff: true,
            date: { $gte: oooStartStr, $lte: oooEndStr }
        }).sort({ date: -1 }).lean();

        const buildOooUrl = (range: string) => {
            const params = new URLSearchParams();
            params.set('period', period);
            params.set('oooRange', range);
            return `/user/${userId}?${params.toString()}`;
        };

        const oooFilters = [
            { label: 'Today', value: 'today' },
            { label: 'This Month', value: 'month' },
            { label: 'This Year', value: 'year' }
        ];

        const oooFilterButtonsHTML = oooFilters
            .map(filter => `
                <a href="${buildOooUrl(filter.value)}" class="ooo-filter-btn ${effectiveOooRange === filter.value ? 'active' : ''}">${filter.label}</a>
            `)
            .join('');

        const customFormClass = effectiveOooRange === 'custom' ? 'ooo-custom-range active' : 'ooo-custom-range';
        const customStartValue = effectiveOooRange === 'custom' ? oooStartStr : customOooStart;
        const customEndValue = effectiveOooRange === 'custom' ? oooEndStr : customOooEnd;

        const dayOffEntriesHTML = dayOffEntries.length > 0
            ? dayOffEntries.map(entry => `
                <div class="ooo-entry">
                    <div class="ooo-entry-date">${format(new Date(entry.date), 'EEEE, MMM d, yyyy')}</div>
                    <div class="ooo-entry-reason">${escapeHtml(entry.dayOffReason || 'No reason provided')}</div>
                </div>
            `).join('')
            : '<div class="ooo-empty">No days off in this range.</div>';

        const oooRangeLabels: Record<string, string> = {
            today: 'Today',
            month: 'This Month',
            year: 'This Year',
            custom: 'Custom Range'
        };
        const oooRangeLabel = oooRangeLabels[effectiveOooRange] || 'This Month';

        const oooSectionHTML = `
        <div class="ooo-section">
            <div class="ooo-section-header">
                <div>
                    <div class="ooo-title">🛫 Days Off (${dayOffEntries.length})</div>
                    <div class="ooo-subtitle">${oooRangeLabel}</div>
                </div>
                <div class="ooo-filter-buttons">
                    ${oooFilterButtonsHTML}
                </div>
            </div>
            <form class="${customFormClass}" method="get">
                <input type="hidden" name="period" value="${period}">
                <input type="hidden" name="oooRange" value="custom">
                <label>From <input type="date" name="oooStart" value="${customStartValue || ''}" required></label>
                <label>To <input type="date" name="oooEnd" value="${customEndValue || ''}" required></label>
                <button type="submit">Apply</button>
            </form>
            <div class="ooo-list">
                ${dayOffEntriesHTML}
            </div>
        </div>
        `;

        // Generate HTML
        let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
    <title>${userName}'s Standup Report</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
    ${getContributionGraphCSS()}
    <style>
        :root {
            --primary: #667eea;
            --secondary: #764ba2;
            --success: #10b981;
            --danger: #ef4444;
            --warning: #f59e0b;
            --info: #3b82f6;
            --dark: #1e293b;
            --gray-50: #f8fafc;
            --gray-100: #f1f5f9;
            --gray-600: #475569;
            --gray-700: #334155;
            --gray-800: #1e293b;
            --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
            --radius: 12px;
            --radius-lg: 16px;
            --transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        * { 
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: var(--dark);
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            padding: 0;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem 1rem;
        }
        
        /* BACK LINK */
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
            transition: var(--transition);
        }
        
        .back-link:hover {
            background: rgba(255, 255, 255, 0.25);
            transform: translateX(-4px);
        }
        
        /* HEADER CARD */
        .header {
            background: white;
            border-radius: var(--radius-lg);
            padding: 2.5rem;
            margin-bottom: 2rem;
            box-shadow: var(--shadow-xl);
            animation: fadeInUp 0.6s ease;
        }
        
        .user-info {
            display: flex;
            align-items: center;
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .avatar {
            width: 100px;
            height: 100px;
            border-radius: 50%;
            border: 4px solid var(--primary);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
            flex-shrink: 0;
        }
        
        .user-details h1 {
            font-size: clamp(1.75rem, 4vw, 2.5rem);
            font-weight: 800;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 0.5rem;
        }
        
        .user-subtitle {
            color: var(--gray-600);
            font-weight: 500;
        }
        
        /* STATS GRID */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 1.25rem;
        }
        
        .stat-card {
            background: linear-gradient(135deg, var(--gray-50), white);
            padding: 1.5rem;
            border-radius: var(--radius);
            text-align: center;
            border: 2px solid var(--gray-100);
            transition: var(--transition);
        }

        .stat-card.dayoff-alert {
            border-color: var(--warning);
            background: linear-gradient(135deg, #fef3c7, #fde68a);
        }
        
        .stat-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow-lg);
            border-color: var(--primary);
        }
        
        .stat-value {
            font-size: 2.5rem;
            font-weight: 800;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            line-height: 1;
            margin-bottom: 0.5rem;
        }

        .stat-card.dayoff-alert .stat-value {
            background: none;
            -webkit-text-fill-color: #b45309;
            color: #b45309;
        }

        .stat-alert-text {
            margin-top: 0.35rem;
            font-size: 0.85rem;
            font-weight: 600;
            color: #92400e;
        }
        
        .stat-label {
            font-size: 0.8125rem;
            font-weight: 600;
            color: var(--gray-600);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        /* FILTERS */
        .filters {
            background: white;
            padding: 1.5rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            box-shadow: var(--shadow);
            display: flex;
            gap: 1rem;
            align-items: center;
            flex-wrap: wrap;
        }
        
        .filter-label {
            font-weight: 700;
            color: var(--gray-700);
            font-size: 0.9375rem;
        }
        
        .filter-btn {
            padding: 0.625rem 1.25rem;
            border: 2px solid var(--gray-200);
            background: white;
            color: var(--gray-700);
            border-radius: 50px;
            cursor: pointer;
            font-weight: 600;
            text-decoration: none;
            transition: var(--transition);
            font-size: 0.875rem;
        }
        
        .filter-btn:hover {
            border-color: var(--primary);
            background: var(--gray-50);
            transform: translateY(-2px);
        }
        
        .filter-btn.active {
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: white;
            border-color: transparent;
        }

        /* DAYS OFF PANEL */
        .ooo-section {
            background: white;
            border-radius: var(--radius);
            padding: 1.5rem;
            box-shadow: var(--shadow);
            margin-bottom: 2rem;
        }
        .ooo-section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
            margin-bottom: 1rem;
        }
        .ooo-title {
            font-size: 1.35rem;
            font-weight: 700;
            color: var(--gray-800);
        }
        .ooo-subtitle {
            font-size: 0.9rem;
            color: var(--gray-600);
        }
        .ooo-filter-buttons {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
        }
        .ooo-filter-btn {
            padding: 0.4rem 0.9rem;
            border-radius: 999px;
            border: 1px solid var(--gray-200);
            background: var(--gray-50);
            color: var(--gray-700);
            font-size: 0.85rem;
            font-weight: 600;
            text-decoration: none;
        }
        .ooo-filter-btn.active {
            background: var(--primary);
            color: white;
            border-color: transparent;
        }
        .ooo-custom-range {
            display: flex;
            gap: 0.75rem;
            flex-wrap: wrap;
            align-items: center;
            margin-bottom: 1rem;
            padding: 0.75rem;
            border-radius: 10px;
            border: 1px dashed var(--gray-200);
            background: var(--gray-50);
        }
        .ooo-custom-range.active {
            border-color: var(--primary);
            background: rgba(102, 126, 234, 0.08);
        }
        .ooo-custom-range label {
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--gray-700);
        }
        .ooo-custom-range input[type="date"] {
            padding: 0.45rem 0.75rem;
            border-radius: 8px;
            border: 1px solid var(--gray-200);
            font-family: inherit;
        }
        .ooo-custom-range button {
            padding: 0.45rem 1rem;
            border-radius: 8px;
            border: none;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: white;
            font-weight: 600;
            cursor: pointer;
        }
        .ooo-list {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }
        .ooo-entry {
            border: 1px solid var(--gray-200);
            border-radius: 10px;
            padding: 0.9rem 1rem;
            background: var(--gray-50);
            display: flex;
            flex-direction: column;
            gap: 0.35rem;
        }
        .ooo-entry-date {
            font-weight: 700;
            color: var(--gray-800);
        }
        .ooo-entry-reason {
            color: var(--gray-600);
            font-size: 0.95rem;
        }
        .ooo-empty {
            text-align: center;
            padding: 1rem;
            color: var(--gray-600);
            border: 1px dashed var(--gray-300);
            border-radius: 10px;
        }
        
        /* CONTENT WRAPPER */
        .content {
            background: var(--gray-50);
            border-radius: var(--radius-lg);
            padding: 2rem;
            box-shadow: var(--shadow-xl);
        }
        
        /* STANDUP CARDS */
        .standup-card {
            background: white;
            border-radius: var(--radius);
            padding: 2rem;
            margin-bottom: 1.5rem;
            box-shadow: var(--shadow);
            border-left: 4px solid var(--info);
            transition: var(--transition);
            animation: slideInUp 0.4s ease backwards;
        }
        
        .standup-card:hover {
            transform: translateX(4px);
            box-shadow: var(--shadow-lg);
        }
        
        .standup-card.has-blocker {
            border-left-color: var(--danger);
            background: linear-gradient(to right, rgba(239, 68, 68, 0.03), white);
        }

        .standup-card.day-off-card {
            border-left-color: var(--warning);
            background: linear-gradient(to right, rgba(245, 158, 11, 0.05), white);
        }
        
        .date-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 3px solid var(--primary);
            flex-wrap: wrap;
            gap: 0.75rem;
        }
        
        .date-title {
            font-size: 1.375rem;
            font-weight: 700;
            color: var(--gray-800);
        }
        
        .blocker-badge {
            background: var(--danger);
            color: white;
            padding: 0.375rem 0.875rem;
            border-radius: 50px;
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
            animation: pulse 2s infinite;
        }

        .dayoff-badge {
            background: var(--warning);
            color: #78350f;
            padding: 0.375rem 0.875rem;
            border-radius: 50px;
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
        }
        
        .timestamp {
            font-size: 0.8125rem;
            color: var(--gray-600);
            font-weight: 500;
        }
        
        /* SECTIONS */
        .section {
            margin-bottom: 1.5rem;
        }
        
        .section-label {
            font-size: 0.8125rem;
            font-weight: 700;
            color: var(--gray-600);
            text-transform: uppercase;
            margin-bottom: 0.75rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            letter-spacing: 0.05em;
            gap: 0.5rem;
        }
        
        .section-content {
            font-size: 0.9375rem;
            color: var(--gray-700);
            line-height: 1.8;
            white-space: pre-wrap;
            padding-left: 1.75rem;
        }
        
        /* ANIMATIONS */
        @keyframes fadeInUp {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        @keyframes slideInUp {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.8; }
        }
        
        /* MOBILE RESPONSIVE */
        @media (max-width: 768px) {
            .container {
                padding: 1rem;
            }
            
            .header {
                padding: 1.5rem;
            }
            
            .user-info {
                flex-direction: column;
                text-align: center;
                align-items: center;
            }
            
            .avatar {
                width: 80px;
                height: 80px;
            }
            
            .stats-grid {
                grid-template-columns: repeat(2, 1fr);
            }
            
            .stat-card {
                padding: 1.25rem;
            }
            
            .stat-value {
                font-size: 2rem;
            }
            
            .content {
                padding: 1.25rem;
            }
            
            .standup-card {
                padding: 1.5rem;
            }
            
            .date-header {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .section-content {
                padding-left: 0;
            }
            
            .filters {
                padding: 1.25rem;
            }
            
            .filter-label {
                width: 100%;
            }
            
            .back-link {
                font-size: 0.875rem;
                padding: 0.625rem 1rem;
            }
        }
        
        @media (max-width: 480px) {
            .stats-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <a href="/submissions" class="back-link">
            <span>←</span>
            <span>Back to Dashboard</span>
        </a>
        
        <div class="header">
            <div class="user-info">
                <img src="${avatarUrl || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(userName) + '&background=667eea&color=fff'}" 
                     alt="${userName}" 
                     class="avatar">
                <div class="user-details">
                    <h1>${userName}</h1>
                    <p class="user-subtitle">Standup Activity Report</p>
                </div>
            </div>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${totalSubmissions}</div>
                    <div class="stat-label">Submissions</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${avgTasksPerDay}</div>
                    <div class="stat-label">Avg Tasks/Day</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${blockerCount}</div>
                    <div class="stat-label">Blockers Reported</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${Math.round((totalSubmissions / parseInt(endDate.split('-')[2])) * 100)}%</div>
                    <div class="stat-label">Attendance</div>
                </div>
                <div class="stat-card ${dayOffCount >= 3 ? 'dayoff-alert' : ''}">
                    <div class="stat-value">${dayOffCount}</div>
                    <div class="stat-label">Days Off</div>
                    ${dayOffCount >= 3 ? '<div class="stat-alert-text">Check coverage</div>' : ''}
                </div>
            </div>
        </div>
        
        ${oooSectionHTML}
        
        ${contributionGraphHTML}
        
        <!-- Performance Insights Section -->
        ${performanceScore > 0 || aiInsights.strengths.length > 0 ? `
        <div class="contribution-section" style="margin-bottom: 2rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                <h2 style="font-size: 1.5rem; font-weight: 700; color: var(--gray-800); display: flex; align-items: center; gap: 0.5rem;">
                    <span>📊</span>
                    <span>Performance Insights</span>
                </h2>
                ${performanceScore > 0 ? `
                <div style="font-size: 3rem; font-weight: 800; background: linear-gradient(135deg, var(--primary), var(--secondary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">
                    ${performanceScore}/100
                </div>
                ` : ''}
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
                <div style="background: linear-gradient(135deg, #ede9fe, #ddd6fe); padding: 1.5rem; border-radius: 12px; border-left: 4px solid #8b5cf6;">
                    <div style="font-size: 0.875rem; font-weight: 600; color: var(--gray-600); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">
                        Velocity Trend
                    </div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--gray-800);">
                        ${velocityTrend === 'increasing' ? '📈 Increasing' : velocityTrend === 'decreasing' ? '📉 Decreasing' : '➡️ Stable'}
                    </div>
                </div>
                
                <div style="background: linear-gradient(135deg, ${riskLevel === 'high' ? '#fee2e2, #fecaca' : riskLevel === 'medium' ? '#fef3c7, #fde68a' : '#d1fae5, #a7f3d0'}); padding: 1.5rem; border-radius: 12px; border-left: 4px solid ${riskLevel === 'high' ? '#ef4444' : riskLevel === 'medium' ? '#f59e0b' : '#10b981'};">
                    <div style="font-size: 0.875rem; font-weight: 600; color: var(--gray-600); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">
                        Risk Level
                    </div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--gray-800);">
                        ${riskLevel === 'high' ? '⚠️ High' : riskLevel === 'medium' ? '⚡ Medium' : '✅ Low'}
                    </div>
                </div>
            </div>
            
            ${aiInsights.strengths.length > 0 || aiInsights.improvements.length > 0 || aiInsights.recommendations.length > 0 ? `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem;">
                ${aiInsights.strengths.length > 0 ? `
                <div style="background: linear-gradient(135deg, #f0fdf4, #dcfce7); padding: 1.5rem; border-radius: 12px; border-left: 4px solid #10b981;">
                    <h3 style="font-size: 1.125rem; font-weight: 700; color: var(--gray-800); margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
                        <span>💪</span>
                        <span>Strengths</span>
                    </h3>
                    <ul style="list-style: none; padding: 0;">
                        ${aiInsights.strengths.map(s => `
                        <li style="padding: 0.5rem 0; padding-left: 1.5rem; position: relative; font-size: 0.875rem; color: var(--gray-700); line-height: 1.6;">
                            <span style="position: absolute; left: 0;">✓</span>
                            ${escapeHtml(s)}
                        </li>
                        `).join('')}
                    </ul>
                </div>
                ` : ''}
                
                ${aiInsights.improvements.length > 0 ? `
                <div style="background: linear-gradient(135deg, #fef3c7, #fde68a); padding: 1.5rem; border-radius: 12px; border-left: 4px solid #f59e0b;">
                    <h3 style="font-size: 1.125rem; font-weight: 700; color: var(--gray-800); margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
                        <span>📈</span>
                        <span>Areas to Improve</span>
                    </h3>
                    <ul style="list-style: none; padding: 0;">
                        ${aiInsights.improvements.map(i => `
                        <li style="padding: 0.5rem 0; padding-left: 1.5rem; position: relative; font-size: 0.875rem; color: var(--gray-700); line-height: 1.6;">
                            <span style="position: absolute; left: 0;">→</span>
                            ${escapeHtml(i)}
                        </li>
                        `).join('')}
                    </ul>
                </div>
                ` : ''}
                
                ${aiInsights.recommendations.length > 0 ? `
                <div style="background: linear-gradient(135deg, #dbeafe, #bfdbfe); padding: 1.5rem; border-radius: 12px; border-left: 4px solid #3b82f6;">
                    <h3 style="font-size: 1.125rem; font-weight: 700; color: var(--gray-800); margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
                        <span>💡</span>
                        <span>Recommendations</span>
                    </h3>
                    <ul style="list-style: none; padding: 0;">
                        ${aiInsights.recommendations.map(r => `
                        <li style="padding: 0.5rem 0; padding-left: 1.5rem; position: relative; font-size: 0.875rem; color: var(--gray-700); line-height: 1.6;">
                            <span style="position: absolute; left: 0;">★</span>
                            ${escapeHtml(r)}
                        </li>
                        `).join('')}
                    </ul>
                </div>
                ` : ''}
            </div>
            ` : ''}
        </div>
        ` : ''}
        
        <div class="filters">
            <span class="filter-label">📅 Time Period:</span>
            <a href="/user/${userId}?period=week" class="filter-btn ${period === 'week' ? 'active' : ''}">Last 7 Days</a>
            <a href="/user/${userId}?period=month" class="filter-btn ${period === 'month' ? 'active' : ''}">This Month</a>
            <a href="/user/${userId}?period=all" class="filter-btn ${period === 'all' ? 'active' : ''}">All Time</a>
        </div>
        
        <div class="content">
`;

        // Add each standup
        for (const standup of standups) {
            const dateFormatted = format(new Date(standup.date), 'EEEE, MMMM d, yyyy');
            const submittedAt = format(new Date(standup.createdAt), 'h:mm a');
            const hasBlocker = standup.blockers && standup.blockers.trim() && 
                               !standup.blockers.toLowerCase().includes('none');
            const hasNotes = standup.notes && standup.notes.trim();
            const isDayOff = !!standup.isDayOff;
            const cardClasses = ['standup-card'];
            if (hasBlocker) cardClasses.push('has-blocker');
            if (isDayOff) cardClasses.push('day-off-card');
            const cardClassName = cardClasses.join(' ');

            html += `
        <div class="${cardClassName}">
            <div class="date-header">
                <div class="date-title">
                    ${dateFormatted}
                    ${hasBlocker ? '<span class="blocker-badge">HAS BLOCKERS</span>' : ''}
                    ${isDayOff ? '<span class="dayoff-badge">DAY OFF</span>' : ''}
                </div>
                <div class="timestamp">Submitted at ${submittedAt}</div>
            </div>
            
            <div class="section">
                <div class="section-label">🕒 What I Did Yesterday</div>
                <div class="section-content">${escapeHtml(standup.yesterday)}</div>
            </div>
            
            <div class="section">
                <div class="section-label">🗓️ What I'll Do Today</div>
                <div class="section-content">${escapeHtml(standup.today)}</div>
            </div>
            
            ${hasBlocker ? `
            <div class="section">
                <div class="section-label">🚧 Blockers</div>
                <div class="section-content" style="background: #fff5f5; border-left: 3px solid #e74c3c;">${escapeHtml(standup.blockers)}</div>
            </div>
            ` : ''}

            ${hasNotes ? `
            <div class="section">
                <div class="section-label">📝 Notes</div>
                <div class="section-content" style="background: #f8fafc; border-left: 3px solid #3b82f6;">${escapeHtml(standup.notes || '')}</div>
            </div>
            ` : ''}

            ${isDayOff ? `
            <div class="section">
                <div class="section-label">🛫 Day Off</div>
                <div class="section-content" style="background: #fffbeb; border-left: 3px solid #f59e0b;">${escapeHtml(standup.dayOffReason || 'Marked as out of office')}</div>
            </div>
            ` : ''}
        </div>
`;
        }

        html += `
        </div>
    </div>
</body>
</html>
`;

        res.send(html);
    } catch (error) {
        console.error('Error generating user report:', error);
        res.status(500).send('Error generating report');
    }
};
