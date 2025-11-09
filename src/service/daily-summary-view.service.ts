import { Request, Response } from 'express';
import StandupEntry from '../models/standupEntry';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { generateDailyTeamSummary } from './ai-summary.service';

const TIMEZONE = 'Africa/Cairo';

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
            res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Daily Summary - ${date}</title>
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
        .empty-box {
            background: white;
            padding: 3rem;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="empty-box">
        <h1>📋 No Standups Yet</h1>
        <p>No standup submissions found for ${date}.</p>
        <a href="/daily-summary?date=today">← Back</a>
    </div>
</body>
</html>
            `);
            return;
        }

        // Generate AI summary if available
        let aiSummary = '';
        if (process.env.OPENAI_API_KEY) {
            try {
                aiSummary = await generateDailyTeamSummary(date);
            } catch (error) {
                console.error('Error generating summary:', error);
            }
        }

        // Generate HTML
        let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Daily Summary - ${date}</title>
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
            max-width: 900px;
            margin: 0 auto;
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
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem;
            border-radius: 12px;
            margin-bottom: 2rem;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .header h1 {
            margin: 0 0 0.5rem 0;
            font-size: 2rem;
        }
        .header p {
            margin: 0;
            opacity: 0.9;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }
        .stat-card {
            background: white;
            padding: 1.5rem;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
            text-align: center;
        }
        .stat-value {
            font-size: 2rem;
            font-weight: 700;
            color: #3498db;
        }
        .stat-label {
            font-size: 0.9rem;
            color: #7f8c8d;
            margin-top: 0.5rem;
        }
        .ai-summary-card {
            background: white;
            padding: 2rem;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
            margin-bottom: 2rem;
            border-left: 4px solid #2196f3;
        }
        .ai-summary-header {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 1.3rem;
            font-weight: 700;
            color: #2c3e50;
            margin-bottom: 1rem;
        }
        .ai-summary-content {
            font-size: 1rem;
            line-height: 1.8;
            color: #34495e;
            white-space: pre-wrap;
        }
        .individual-summaries {
            background: white;
            padding: 2rem;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .section-title {
            font-size: 1.3rem;
            font-weight: 700;
            color: #2c3e50;
            margin-bottom: 1.5rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .person-card {
            padding: 1.5rem;
            border-bottom: 1px solid #ecf0f1;
            margin-bottom: 1rem;
        }
        .person-card:last-child {
            border-bottom: none;
        }
        .person-name {
            font-size: 1.1rem;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 0.5rem;
        }
        .person-summary {
            font-style: italic;
            color: #1565c0;
            line-height: 1.6;
        }
        .person-hours {
            display: inline-block;
            background: #e3f2fd;
            color: #1976d2;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.85rem;
            font-weight: 600;
            margin-left: 0.5rem;
        }
        .date-picker {
            background: white;
            padding: 1rem;
            border-radius: 8px;
            margin-bottom: 1rem;
            display: flex;
            gap: 0.5rem;
            align-items: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }
        .date-picker input {
            padding: 0.5rem;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-family: inherit;
        }
        .date-picker button {
            padding: 0.5rem 1rem;
            background: #3498db;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
        }
        .date-picker button:hover {
            background: #2980b9;
        }
    </style>
</head>
<body>
    <div class="container">
        <a href="/submissions" class="back-link">← Back to All Submissions</a>
        
        <div class="header">
            <h1>📋 Daily Team Summary</h1>
            <p>${format(new Date(date), 'EEEE, MMMM d, yyyy')}</p>
        </div>
        
        <div class="date-picker">
            <strong>View date:</strong>
            <input type="date" id="datePicker" value="${date}">
            <button onclick="window.location.href='/daily-summary?date=' + document.getElementById('datePicker').value">Go</button>
            <button onclick="window.location.href='/daily-summary?date=today'">Today</button>
        </div>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-value">${standups.length}</div>
                <div class="stat-label">Submissions</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${new Set(standups.map(s => s.slackUserId)).size}</div>
                <div class="stat-label">Team Members</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${standups.filter(s => s.blockers && s.blockers.trim()).length}</div>
                <div class="stat-label">Blockers</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${Math.round(standups.reduce((sum, s) => sum + (s.yesterdayHoursEstimate || 0) + (s.todayHoursEstimate || 0), 0))}h</div>
                <div class="stat-label">Total Hours</div>
            </div>
        </div>
`;

        // Add AI summary if available
        if (aiSummary) {
            html += `
        <div class="ai-summary-card">
            <div class="ai-summary-header">
                🤖 AI-Generated Team Summary
            </div>
            <div class="ai-summary-content">${escapeHtml(aiSummary)}</div>
        </div>
`;
        }

        // Add individual summaries
        html += `
        <div class="individual-summaries">
            <div class="section-title">👥 Individual Summaries</div>
`;

        for (const standup of standups) {
            const totalHours = (standup.yesterdayHoursEstimate || 0) + (standup.todayHoursEstimate || 0);
            
            html += `
            <div class="person-card">
                <div class="person-name">
                    ${standup.slackUserName}
                    ${totalHours > 0 ? `<span class="person-hours">⏱️ ${totalHours}h</span>` : ''}
                </div>
                ${standup.aiSummary ? `<div class="person-summary">"${escapeHtml(standup.aiSummary)}"</div>` : `<div class="person-summary" style="color: #7f8c8d; font-style: normal;">No AI summary available</div>`}
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
        console.error('Error generating daily summary view:', error);
        res.status(500).send('Error generating summary');
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

