import { Request, Response } from 'express';
import StandupEntry from '../models/standupEntry';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { getTeamMembers } from './team-members.service';
import { logger } from '../utils/logger';
import { hasClerk } from '../index';

const TIMEZONE = 'Africa/Cairo';

export const getSubmissionsDashboard = async (req: Request, res: Response) => {
    try {
        logger.info('Submissions dashboard accessed', { date: req.query.date });
        let queryDate = req.query.date as string | undefined;

        if (queryDate === 'today') {
            const now = toZonedTime(new Date(), TIMEZONE);
            queryDate = format(now, 'yyyy-MM-dd');
        }

        let standupEntries;
        if (queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
            standupEntries = await StandupEntry.find({ date: queryDate }).sort({ createdAt: -1 });
        } else {
            // Get last 30 days of standups
            const thirtyDaysAgo = format(
                toZonedTime(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), TIMEZONE),
                'yyyy-MM-dd'
            );
            standupEntries = await StandupEntry.find({ 
                date: { $gte: thirtyDaysAgo } 
            }).sort({ date: -1, createdAt: -1 });
        }

        // Group by date
        const entriesByDate = new Map<string, typeof standupEntries>();
        for (const entry of standupEntries) {
            if (!entriesByDate.has(entry.date)) {
                entriesByDate.set(entry.date, []);
            }
            entriesByDate.get(entry.date)!.push(entry);
        }

        // Generate HTML
        let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
    <title>📊 Standup Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
    <style>
        * { 
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        .user-menu {
            position: fixed;
            top: 1.5rem;
            right: 1.5rem;
            z-index: 1000;
        }
        
        .user-menu-button {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            background: white;
            border: 1px solid #e1e8ed;
            border-radius: 100px;
            padding: 0.5rem 1rem 0.5rem 0.5rem;
            cursor: pointer;
            transition: all 0.2s;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            text-decoration: none;
            color: #2c3e50;
        }
        
        .user-menu-button:hover {
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
            transform: translateY(-1px);
            border-color: #3498db;
        }
        
        .user-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 600;
            font-size: 0.9rem;
        }
        
        .user-info {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
        }
        
        .user-name {
            font-weight: 600;
            font-size: 0.9rem;
            color: #2c3e50;
        }
        
        .user-action {
            font-size: 0.75rem;
            color: #7f8c8d;
        }
        
        .logout-icon {
            font-size: 1.2rem;
            margin-left: 0.25rem;
        }
        
        @media (max-width: 768px) {
            .user-menu {
                top: 1rem;
                right: 1rem;
            }
            .user-info {
                display: none;
            }
            .user-menu-button {
                padding: 0.5rem;
            }
        }
        
        
        :root {
            --primary: #667eea;
            --primary-dark: #5568d3;
            --secondary: #764ba2;
            --success: #10b981;
            --danger: #ef4444;
            --warning: #f59e0b;
            --info: #3b82f6;
            --dark: #1e293b;
            --gray-50: #f8fafc;
            --gray-100: #f1f5f9;
            --gray-200: #e2e8f0;
            --gray-300: #cbd5e1;
            --gray-600: #475569;
            --gray-700: #334155;
            --gray-800: #1e293b;
            --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
            --radius: 12px;
            --radius-lg: 16px;
            --transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: var(--dark);
            line-height: 1.6;
            padding: 0;
            margin: 0;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
        
        .container {
            max-width: 1280px;
            margin: 0 auto;
            padding: 2rem 1rem;
        }
        
        /* HEADER */
        .header {
            text-align: center;
            margin-bottom: 3rem;
            animation: fadeInDown 0.6s ease;
        }
        
        .header h1 {
            font-size: clamp(1.75rem, 5vw, 3rem);
            font-weight: 800;
            color: white;
            margin-bottom: 0.5rem;
            text-shadow: 0 2px 10px rgba(0,0,0,0.1);
            letter-spacing: -0.02em;
        }
        
        .header p {
            color: rgba(255, 255, 255, 0.9);
            font-size: 1.125rem;
            font-weight: 500;
        }
        
        /* STATS CARDS */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
            animation: fadeInUp 0.6s ease 0.1s backwards;
        }
        
        .stat-card {
            background: white;
            border-radius: var(--radius-lg);
            padding: 1.75rem;
            box-shadow: var(--shadow-lg);
            transition: var(--transition);
            position: relative;
            overflow: hidden;
        }
        
        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, var(--primary), var(--secondary));
        }
        
        .stat-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow-xl);
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
        
        .stat-label {
            font-size: 0.875rem;
            font-weight: 600;
            color: var(--gray-600);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        /* CONTENT SECTION */
        .content {
            background: var(--gray-50);
            border-radius: var(--radius-lg);
            padding: 2rem;
            box-shadow: var(--shadow-xl);
            animation: fadeInUp 0.6s ease 0.2s backwards;
        }
        
        /* DATE SECTION */
        .date-section {
            margin-bottom: 2.5rem;
        }
        
        .date-header {
            font-size: 1.75rem;
            font-weight: 700;
            color: var(--gray-800);
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 3px solid var(--primary);
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }
        
        .submission-count {
            font-size: 0.875rem;
            font-weight: 600;
            color: var(--gray-600);
            background: var(--gray-100);
            padding: 0.5rem 1rem;
            border-radius: 50px;
        }
        
        /* STANDUP CARDS */
        .standup-card {
            background: white;
            border-radius: var(--radius);
            padding: 1.75rem;
            margin-bottom: 1.5rem;
            box-shadow: var(--shadow);
            border-left: 4px solid var(--info);
            transition: var(--transition);
            animation: slideInUp 0.4s ease backwards;
        }
        
        .standup-card:hover {
            box-shadow: var(--shadow-lg);
            transform: translateX(4px);
        }
        
        .standup-card.blocker-highlight {
            border-left-color: var(--danger);
            background: linear-gradient(to right, rgba(239, 68, 68, 0.03), white);
        }
        
        .standup-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 1.25rem;
            gap: 1rem;
            flex-wrap: wrap;
        }
        
        .user-info-section {
            display: flex;
            align-items: center;
            gap: 1rem;
            flex: 1;
            min-width: 0;
        }
        
        .user-avatar-card {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 700;
            font-size: 1.25rem;
            flex-shrink: 0;
            box-shadow: var(--shadow);
        }
        
        .user-details {
            flex: 1;
            min-width: 0;
        }
        
        .user-name {
            font-size: 1.25rem;
            font-weight: 700;
            color: var(--gray-800);
            margin-bottom: 0.25rem;
        }
        
        .user-name a {
            color: inherit;
            text-decoration: none;
            transition: var(--transition);
        }
        
        .user-name a:hover {
            color: var(--primary);
        }
        
        .badges {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
            align-items: center;
        }
        
        .badge {
            padding: 0.375rem 0.75rem;
            border-radius: 50px;
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .blocker-badge {
            background: var(--danger);
            color: white;
            animation: pulse 2s infinite;
        }
        
        .time-badge {
            background: linear-gradient(135deg, #e0f2fe, #bae6fd);
            color: #0369a1;
        }
        
        .timestamp {
            font-size: 0.8125rem;
            color: var(--gray-600);
            white-space: nowrap;
        }
        
        /* AI SUMMARY */
        .ai-summary {
            background: linear-gradient(135deg, #ede9fe, #ddd6fe);
            border-radius: var(--radius);
            padding: 1.25rem;
            margin-bottom: 1.25rem;
            border-left: 4px solid #8b5cf6;
        }
        
        .ai-summary-label {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.875rem;
            font-weight: 700;
            color: #6d28d9;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 0.75rem;
        }
        
        .ai-summary-content {
            color: #5b21b6;
            font-style: italic;
            line-height: 1.7;
            font-size: 0.9375rem;
        }
        
        /* SECTIONS */
        .standup-section {
            margin-bottom: 1.25rem;
        }
        
        .section-label {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.8125rem;
            font-weight: 700;
            color: var(--gray-600);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 0.75rem;
        }
        
        .section-content {
            font-size: 0.9375rem;
            color: var(--gray-700);
            line-height: 1.8;
            white-space: pre-wrap;
            padding-left: 1.75rem;
        }
        
        .no-submissions {
            text-align: center;
            padding: 4rem 2rem;
            color: var(--gray-600);
        }
        
        .no-submissions-icon {
            font-size: 4rem;
            margin-bottom: 1rem;
            opacity: 0.5;
        }
        
        /* ANIMATIONS */
        @keyframes fadeInDown {
            from {
                opacity: 0;
                transform: translateY(-20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
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
            0%, 100% {
                opacity: 1;
            }
            50% {
                opacity: 0.8;
            }
        }
        
        /* MOBILE RESPONSIVE */
        @media (max-width: 768px) {
            .container {
                padding: 1rem;
            }
            
            .content {
                padding: 1.25rem;
                border-radius: var(--radius);
            }
            
            .stat-card {
                padding: 1.25rem;
            }
            
            .stat-value {
                font-size: 2rem;
            }
            
            .standup-card {
                padding: 1.25rem;
            }
            
            .user-avatar-card {
                width: 40px;
                height: 40px;
                font-size: 1rem;
            }
            
            .user-name {
                font-size: 1.125rem;
            }
            
            .date-header {
                font-size: 1.375rem;
                flex-direction: column;
                align-items: flex-start;
            }
            
            .standup-header {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .section-content {
                padding-left: 0;
            }
        }
    </style>
</head>
<body>
    ${hasClerk ? `
    <div class="user-menu">
        <a href="/auth/sign-out" class="user-menu-button" title="Sign out">
            <div class="user-avatar">👤</div>
            <div class="user-info">
                <div class="user-name">Team Member</div>
                <div class="user-action">Sign out</div>
            </div>
            <span class="logout-icon">→</span>
        </a>
    </div>
    ` : ''}
    <div class="container">
        <div class="header">
            <h1>📊 Standup Dashboard</h1>
            <p>Track your team's daily progress and achievements</p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${standupEntries.length}</div>
                <div class="stat-label">Total Submissions</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${entriesByDate.size}</div>
                <div class="stat-label">Days Tracked</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${new Set(standupEntries.map(e => e.slackUserId)).size}</div>
                <div class="stat-label">Active Users</div>
            </div>
        </div>
        
        <div class="content">
`;

        if (entriesByDate.size === 0) {
            html += `
            <div class="no-submissions">
                <div class="no-submissions-icon">📭</div>
                <p style="font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem;">No standup submissions yet</p>
                <p>Team members can submit by typing <code>/standup</code> in Slack.</p>
            </div>
`;
        } else {
            for (const [date, entries] of Array.from(entriesByDate.entries()).sort((a, b) => b[0].localeCompare(a[0]))) {
                const dateFormatted = format(new Date(date), 'EEEE, MMMM d, yyyy');
                const hasBlockers = entries.some(e => e.blockers && e.blockers.trim());

                html += `
            <div class="date-section">
                <div class="date-header">
                    <span>${dateFormatted}</span>
                    <span class="submission-count">${entries.length} submission${entries.length > 1 ? 's' : ''}</span>
                </div>
`;

                for (const entry of entries) {
                    const hasBlocker = entry.blockers && entry.blockers.trim();
                    const submittedAt = format(new Date(entry.createdAt), 'h:mm a');
                    const hasTimeEstimates = entry.yesterdayHoursEstimate || entry.todayHoursEstimate;

                    const userInitial = entry.slackUserName.charAt(0).toUpperCase();
                    
                    html += `
                <div class="standup-card ${hasBlocker ? 'blocker-highlight' : ''}">
                    <div class="standup-header">
                        <div class="user-info-section">
                            <div class="user-avatar-card">${userInitial}</div>
                            <div class="user-details">
                                <div class="user-name">
                                    <a href="/user/${entry.slackUserId}">${entry.slackUserName}</a>
                                </div>
                                <div class="badges">
                                    ${hasBlocker ? '<span class="badge blocker-badge">⚠️ Blocked</span>' : ''}
                                    ${hasTimeEstimates ? `<span class="badge time-badge">⏱ ${(entry.yesterdayHoursEstimate || 0) + (entry.todayHoursEstimate || 0)}h</span>` : ''}
                                </div>
                            </div>
                        </div>
                        <div class="timestamp">📅 ${submittedAt}</div>
                    </div>
                    
                    ${entry.aiSummary ? `
                    <div class="ai-summary">
                        <div class="ai-summary-label">
                            <span>✨</span>
                            <span>AI Summary</span>
                        </div>
                        <div class="ai-summary-content">${escapeHtml(entry.aiSummary)}</div>
                    </div>
                    ` : ''}

                    
                    <div class="standup-section">
                        <div class="section-label">
                            <span>🕒</span>
                            <span>Yesterday</span>
                            ${entry.yesterdayHoursEstimate ? `<span style="color: #0369a1; font-size: 0.75rem; font-weight: 600; background: #e0f2fe; padding: 0.25rem 0.5rem; border-radius: 4px; margin-left: auto;">~${entry.yesterdayHoursEstimate}h</span>` : ''}
                        </div>
                        <div class="section-content">${escapeHtml(entry.yesterday)}</div>
                    </div>
                    
                    <div class="standup-section">
                        <div class="section-label">
                            <span>🎯</span>
                            <span>Today's Plan</span>
                            ${entry.todayHoursEstimate ? `<span style="color: #0369a1; font-size: 0.75rem; font-weight: 600; background: #e0f2fe; padding: 0.25rem 0.5rem; border-radius: 4px; margin-left: auto;">~${entry.todayHoursEstimate}h</span>` : ''}
                        </div>
                        <div class="section-content">${escapeHtml(entry.today)}</div>
                    </div>
                    
                    ${hasBlocker ? `
                    <div class="standup-section">
                        <div class="section-label">
                            <span>🚧</span>
                            <span>Blockers</span>
                        </div>
                        <div class="section-content">${escapeHtml(entry.blockers)}</div>
                    </div>
                    ` : ''}
                </div>
`;
                }

                html += `
            </div>
`;
            }
        }

        html += `
        </div>
    </div>
</body>
</html>
`;

        res.send(html);
    } catch (error) {
        console.error('Error generating submissions dashboard:', error);
        res.status(500).send('Error generating dashboard');
    }
};

function escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

