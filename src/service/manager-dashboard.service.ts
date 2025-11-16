import { Request, Response } from 'express';
import StandupEntry from '../models/standupEntry';
import PerformanceMetrics from '../models/performanceMetrics';
import Alert from '../models/alerts';
import { format, subDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { assessRiskLevel, generatePerformanceInsights } from './ai-performance-analysis.service';
import { logger } from '../utils/logger';
import { escapeHtml } from '../middleware/security.middleware';
import { APP_TIMEZONE } from '../config';

const TIMEZONE = APP_TIMEZONE;

/**
 * Manager Dashboard - Team Health & Insights
 * Route: /manager
 */
export const getManagerDashboard = async (req: Request, res: Response) => {
  try {
    logger.info('Manager dashboard accessed');

    const now = toZonedTime(new Date(), TIMEZONE);
    const todayStr = format(now, 'yyyy-MM-dd');
    const last30Days = format(subDays(now, 30), 'yyyy-MM-dd');
    const last7Days = format(subDays(now, 7), 'yyyy-MM-dd');

    // Get all unique team members from last 30 days
    const workspaceId = process.env.SLACK_TEAM_ID || 'default';
    const teamMembers = await StandupEntry.distinct('slackUserId', {
      workspaceId,
      date: { $gte: last30Days }
    });

    // Get latest performance metrics for each team member
    const teamMetrics = await Promise.all(
      teamMembers.map(async (userId) => {
        const metrics = await PerformanceMetrics.findOne({
          slackUserId: userId,
          period: 'week'
        }).sort({ startDate: -1 }).lean();

        return metrics;
      })
    );

    const validMetrics = teamMetrics.filter(m => m !== null);

    // Calculate team health score (average of all team members)
    const teamHealthScore = validMetrics.length > 0
      ? Math.round(validMetrics.reduce((sum, m) => sum + (m?.overallScore || 0), 0) / validMetrics.length)
      : 0;

    // Get active alerts
    const activeAlerts = await Alert.find({
      workspaceId,
      status: 'active'
    }).sort({ priority: -1, createdAt: -1 }).limit(20).lean();

    // Identify at-risk members
    const atRiskMembers = validMetrics.filter(m => m?.riskLevel === 'high' || m?.riskLevel === 'medium');

    // Get today's submissions
    const todaySubmissions = await StandupEntry.find({ date: todayStr });
    const submissionRate = teamMembers.length > 0 
      ? Math.round((todaySubmissions.length / teamMembers.length) * 100)
      : 0;

    // Get all blockers from last 7 days
    const recentBlockers = await StandupEntry.find({
      date: { $gte: last7Days },
      blockers: { $ne: '', $exists: true }
    }).sort({ date: -1 }).lean();

    // Top performers (top 3)
    const topPerformers = [...validMetrics]
      .sort((a, b) => (b?.overallScore || 0) - (a?.overallScore || 0))
      .slice(0, 3);

    // Generate HTML
    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
    <title>Manager Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
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
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem 1rem;
        }
        
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
        
        .header {
            text-align: center;
            margin-bottom: 2.5rem;
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
        
        .health-score-card {
            background: white;
            border-radius: var(--radius-lg);
            padding: 3rem;
            margin-bottom: 2rem;
            text-align: center;
            box-shadow: var(--shadow-xl);
            position: relative;
            overflow: hidden;
        }
        
        .health-score-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 6px;
            background: linear-gradient(90deg, var(--primary), var(--secondary));
        }
        
        .health-score {
            font-size: 5rem;
            font-weight: 800;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            line-height: 1;
            margin-bottom: 0.5rem;
        }
        
        .health-label {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--gray-600);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .metric-card {
            background: white;
            border-radius: var(--radius);
            padding: 1.75rem;
            box-shadow: var(--shadow);
            transition: var(--transition);
        }
        
        .metric-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow-lg);
        }
        
        .metric-value {
            font-size: 2.5rem;
            font-weight: 800;
            color: var(--primary);
            line-height: 1;
            margin-bottom: 0.5rem;
        }
        
        .metric-label {
            font-size: 0.875rem;
            font-weight: 600;
            color: var(--gray-600);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .section {
            background: white;
            border-radius: var(--radius-lg);
            padding: 2rem;
            margin-bottom: 2rem;
            box-shadow: var(--shadow-xl);
        }
        
        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 3px solid var(--primary);
        }
        
        .section-title {
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--gray-800);
        }
        
        .alert-card {
            background: var(--gray-50);
            border-radius: var(--radius);
            padding: 1.25rem;
            margin-bottom: 1rem;
            border-left: 4px solid var(--info);
            transition: var(--transition);
        }
        
        .alert-card:hover {
            background: white;
            box-shadow: var(--shadow);
        }
        
        .alert-card.critical {
            border-left-color: var(--danger);
            background: #fef2f2;
        }
        
        .alert-card.warning {
            border-left-color: var(--warning);
            background: #fffbeb;
        }
        
        .alert-title {
            font-size: 1rem;
            font-weight: 700;
            color: var(--gray-800);
            margin-bottom: 0.5rem;
        }
        
        .alert-description {
            font-size: 0.875rem;
            color: var(--gray-600);
            margin-bottom: 0.75rem;
        }
        
        .alert-meta {
            display: flex;
            gap: 1rem;
            font-size: 0.75rem;
            color: var(--gray-600);
        }
        
        .member-card {
            background: var(--gray-50);
            border-radius: var(--radius);
            padding: 1.5rem;
            margin-bottom: 1rem;
            border-left: 4px solid var(--info);
            transition: var(--transition);
        }
        
        .member-card:hover {
            background: white;
            box-shadow: var(--shadow);
        }
        
        .member-card.high-risk {
            border-left-color: var(--danger);
        }
        
        .member-card.medium-risk {
            border-left-color: var(--warning);
        }
        
        .member-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }
        
        .member-name {
            font-size: 1.125rem;
            font-weight: 700;
            color: var(--gray-800);
        }
        
        .risk-badge {
            padding: 0.375rem 0.875rem;
            border-radius: 50px;
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
        }
        
        .risk-badge.high {
            background: var(--danger);
            color: white;
        }
        
        .risk-badge.medium {
            background: var(--warning);
            color: white;
        }
        
        .risk-factors {
            list-style: none;
            margin-top: 0.75rem;
        }
        
        .risk-factors li {
            padding: 0.5rem 0;
            padding-left: 1.5rem;
            position: relative;
            font-size: 0.875rem;
            color: var(--gray-700);
        }
        
        .risk-factors li::before {
            content: '⚠️';
            position: absolute;
            left: 0;
        }
        
        .blocker-item {
            background: var(--gray-50);
            border-radius: var(--radius);
            padding: 1rem;
            margin-bottom: 0.75rem;
            border-left: 3px solid var(--danger);
        }
        
        .blocker-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 0.5rem;
        }
        
        .blocker-user {
            font-weight: 600;
            color: var(--gray-800);
        }
        
        .blocker-date {
            font-size: 0.75rem;
            color: var(--gray-600);
        }
        
        .blocker-text {
            font-size: 0.875rem;
            color: var(--gray-700);
        }
        
        .performer-card {
            background: linear-gradient(135deg, #f0fdf4, #dcfce7);
            border-radius: var(--radius);
            padding: 1.25rem;
            margin-bottom: 1rem;
            border-left: 4px solid var(--success);
        }
        
        .performer-rank {
            display: inline-block;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: var(--success);
            color: white;
            font-weight: 700;
            text-align: center;
            line-height: 32px;
            margin-right: 0.75rem;
        }
        
        .performer-name {
            font-size: 1.125rem;
            font-weight: 700;
            color: var(--gray-800);
        }
        
        .performer-score {
            font-size: 0.875rem;
            color: var(--gray-600);
            margin-top: 0.25rem;
        }
        
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
        
        @media (max-width: 768px) {
            .container {
                padding: 1rem;
            }
            
            .health-score {
                font-size: 3.5rem;
            }
            
            .metrics-grid {
                grid-template-columns: 1fr;
            }
            
            .section {
                padding: 1.5rem;
            }
            
            .member-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 0.75rem;
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
            <h1>👔 Manager Dashboard</h1>
            <p>Team Health & Performance Insights</p>
        </div>
        
        <div class="health-score-card">
            <div class="health-score">${teamHealthScore}</div>
            <div class="health-label">Team Health Score</div>
            <p style="margin-top: 1rem; color: var(--gray-600);">
                ${teamHealthScore >= 80 ? '🎉 Excellent team performance!' : 
                  teamHealthScore >= 60 ? '👍 Good performance, some areas to improve' : 
                  '⚠️ Team needs attention'}
            </p>
        </div>
        
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-value">${teamMembers.length}</div>
                <div class="metric-label">Team Members</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${submissionRate}%</div>
                <div class="metric-label">Today's Submissions</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${atRiskMembers.length}</div>
                <div class="metric-label">At-Risk Members</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${activeAlerts.length}</div>
                <div class="metric-label">Active Alerts</div>
            </div>
        </div>
`;

    // At-Risk Members Section
    if (atRiskMembers.length > 0) {
      html += `
        <div class="section">
            <div class="section-header">
                <div class="section-title">⚠️ At-Risk Team Members</div>
            </div>
`;
      
      for (const member of atRiskMembers) {
        html += `
            <div class="member-card ${member.riskLevel}-risk">
                <div class="member-header">
                    <div class="member-name">
                        <a href="/user/${member.slackUserId}" style="text-decoration: none; color: inherit;">${escapeHtml(member.slackUserName)}</a>
                    </div>
                    <span class="risk-badge ${member.riskLevel}">${member.riskLevel.toUpperCase()} RISK</span>
                </div>
                <div style="margin-bottom: 0.5rem;">
                    <strong>Performance Score:</strong> ${member.overallScore}/100
                </div>
                ${member.riskFactors && member.riskFactors.length > 0 ? `
                <ul class="risk-factors">
                    ${member.riskFactors.map((factor: string) => `<li>${escapeHtml(factor)}</li>`).join('')}
                </ul>
                ` : ''}
            </div>
`;
      }
      
      html += `
        </div>
`;
    }

    // Active Alerts Section
    if (activeAlerts.length > 0) {
      html += `
        <div class="section">
            <div class="section-header">
                <div class="section-title">🚨 Active Alerts</div>
            </div>
`;
      
      for (const alert of activeAlerts) {
        html += `
            <div class="alert-card ${alert.severity}">
                <div class="alert-title">${escapeHtml(alert.title)}</div>
                <div class="alert-description">${escapeHtml(alert.description)}</div>
                <div class="alert-meta">
                    <span>📌 ${alert.type}</span>
                    <span>👤 ${escapeHtml(alert.affectedUserName)}</span>
                    <span>📅 ${format(new Date(alert.createdAt), 'MMM d, yyyy')}</span>
                </div>
            </div>
`;
      }
      
      html += `
        </div>
`;
    }

    // Recent Blockers Section
    if (recentBlockers.length > 0) {
      html += `
        <div class="section">
            <div class="section-header">
                <div class="section-title">🚧 Recent Blockers (Last 7 Days)</div>
            </div>
`;
      
      for (const blocker of recentBlockers.slice(0, 10)) {
        html += `
            <div class="blocker-item">
                <div class="blocker-header">
                    <span class="blocker-user">${escapeHtml(blocker.slackUserName)}</span>
                    <span class="blocker-date">${blocker.date}</span>
                </div>
                <div class="blocker-text">${escapeHtml(blocker.blockers)}</div>
            </div>
`;
      }
      
      html += `
        </div>
`;
    }

    // Top Performers Section
    if (topPerformers.length > 0) {
      html += `
        <div class="section">
            <div class="section-header">
                <div class="section-title">🏆 Top Performers This Week</div>
            </div>
`;
      
      topPerformers.forEach((performer, index) => {
        html += `
            <div class="performer-card">
                <span class="performer-rank">${index + 1}</span>
                <div style="display: inline-block;">
                    <div class="performer-name">
                        <a href="/user/${performer?.slackUserId}" style="text-decoration: none; color: inherit;">${escapeHtml(performer?.slackUserName || '')}</a>
                    </div>
                    <div class="performer-score">Performance Score: ${performer?.overallScore}/100</div>
                </div>
            </div>
`;
      });
      
      html += `
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
    logger.error('Error generating manager dashboard:', error);
    res.status(500).send('Error generating dashboard');
  }
};
