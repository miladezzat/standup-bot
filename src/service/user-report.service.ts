import { Request, Response } from 'express';
import StandupEntry from '../models/standupEntry';
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { getUserName } from '../helper';

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

        // Generate HTML
        let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${userName}'s Standup Report</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: 'Inter', Arial, sans-serif;
            background: #f5f7fa;
            color: #2c3e50;
            margin: 0;
            padding: 1rem;
            line-height: 1.6;
        }
        .container {
            max-width: 1000px;
            margin: 0 auto;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem;
            border-radius: 12px;
            margin-bottom: 2rem;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .user-info {
            display: flex;
            align-items: center;
            gap: 1.5rem;
            margin-bottom: 1.5rem;
        }
        .avatar {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            border: 4px solid rgba(255,255,255,0.3);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }
        .user-name {
            font-size: 2rem;
            font-weight: 700;
            margin: 0;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 1rem;
        }
        .stat-card {
            background: rgba(255,255,255,0.2);
            padding: 1rem;
            border-radius: 8px;
            backdrop-filter: blur(10px);
        }
        .stat-value {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 0.25rem;
        }
        .stat-label {
            font-size: 0.9rem;
            opacity: 0.9;
        }
        .filters {
            background: white;
            padding: 1.5rem;
            border-radius: 12px;
            margin-bottom: 2rem;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
            display: flex;
            gap: 1rem;
            align-items: center;
        }
        .filter-btn {
            padding: 0.5rem 1rem;
            border: 2px solid #3498db;
            background: white;
            color: #3498db;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.2s;
        }
        .filter-btn:hover {
            background: #3498db;
            color: white;
        }
        .filter-btn.active {
            background: #3498db;
            color: white;
        }
        .standup-card {
            background: white;
            border-radius: 12px;
            padding: 2rem;
            margin-bottom: 1.5rem;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
            border-left: 4px solid #3498db;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .standup-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .standup-card.has-blocker {
            border-left-color: #e74c3c;
        }
        .date-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 2px solid #ecf0f1;
        }
        .date-title {
            font-size: 1.3rem;
            font-weight: 700;
            color: #2c3e50;
        }
        .timestamp {
            font-size: 0.85rem;
            color: #7f8c8d;
        }
        .section {
            margin-bottom: 1.5rem;
        }
        .section-label {
            font-size: 0.9rem;
            font-weight: 700;
            color: #7f8c8d;
            text-transform: uppercase;
            margin-bottom: 0.75rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .section-content {
            font-size: 1rem;
            color: #34495e;
            line-height: 1.8;
            white-space: pre-wrap;
            background: #f8f9fa;
            padding: 1rem;
            border-radius: 6px;
        }
        .blocker-badge {
            background: #e74c3c;
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .back-link {
            display: inline-block;
            margin-bottom: 1rem;
            color: #3498db;
            text-decoration: none;
            font-weight: 600;
        }
        .back-link:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <a href="/submissions" class="back-link">← Back to All Submissions</a>
        
        <div class="header">
            <div class="user-info">
                <img src="${avatarUrl || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(userName) + '&background=667eea&color=fff'}" 
                     alt="${userName}" 
                     class="avatar">
                <div>
                    <h1 class="user-name">${userName}</h1>
                    <p style="margin: 0; opacity: 0.9;">Standup Activity Report</p>
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
            </div>
        </div>
        
        <div class="filters">
            <strong>Time Period:</strong>
            <a href="/user/${userId}?period=week" class="filter-btn ${period === 'week' ? 'active' : ''}">Last 7 Days</a>
            <a href="/user/${userId}?period=month" class="filter-btn ${period === 'month' ? 'active' : ''}">This Month</a>
            <a href="/user/${userId}?period=all" class="filter-btn ${period === 'all' ? 'active' : ''}">All Time</a>
        </div>
`;

        // Add each standup
        for (const standup of standups) {
            const dateFormatted = format(new Date(standup.date), 'EEEE, MMMM d, yyyy');
            const submittedAt = format(new Date(standup.createdAt), 'h:mm a');
            const hasBlocker = standup.blockers && standup.blockers.trim() && 
                               !standup.blockers.toLowerCase().includes('none');

            html += `
        <div class="standup-card ${hasBlocker ? 'has-blocker' : ''}">
            <div class="date-header">
                <div class="date-title">
                    ${dateFormatted}
                    ${hasBlocker ? '<span class="blocker-badge">HAS BLOCKERS</span>' : ''}
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
        </div>
`;
        }

        html += `
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

