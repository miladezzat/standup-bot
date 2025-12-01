import { Request, Response } from 'express';
import StandupEntry from '../models/standupEntry';
import PerformanceMetrics from '../models/performanceMetrics';
import Alert from '../models/alerts';
import { format, subDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { logger } from '../utils/logger';
import { hasClerk } from '../index';
import { APP_TIMEZONE } from '../config';
import { createBaseViewData } from '../config/view-engine';

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
    }).sort({ date: -1 }).limit(10).lean();

    // Top performers (top 3)
    const topPerformers = [...validMetrics]
      .sort((a, b) => (b?.overallScore || 0) - (a?.overallScore || 0))
      .slice(0, 3);

    // Render template
    res.render('manager', {
      ...createBaseViewData('👔 Manager Dashboard', 'manager', !!hasClerk),
      teamHealthScore,
      teamSize: teamMembers.length,
      submissionRate,
      atRiskCount: atRiskMembers.length,
      alertCount: activeAlerts.length,
      atRiskMembers,
      activeAlerts,
      recentBlockers,
      topPerformers,
      pageStyles: managerStyles
    });
  } catch (error) {
    logger.error('Error generating manager dashboard:', error);
    res.status(500).send('Error generating dashboard');
  }
};

// Additional styles specific to manager dashboard
const managerStyles = `
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

/* Health Score Card */
.health-score-card {
    background: white;
    border-radius: 16px;
    padding: 3rem;
    margin-bottom: 2rem;
    text-align: center;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
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
    background: linear-gradient(90deg, #667eea, #764ba2);
}

.health-score {
    font-size: 5rem;
    font-weight: 800;
    background: linear-gradient(135deg, #667eea, #764ba2);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1;
    margin-bottom: 0.5rem;
}

.health-score.health-excellent {
    background: linear-gradient(135deg, #10b981, #34d399);
    -webkit-background-clip: text;
    background-clip: text;
}

.health-score.health-good {
    background: linear-gradient(135deg, #3b82f6, #60a5fa);
    -webkit-background-clip: text;
    background-clip: text;
}

.health-score.health-fair {
    background: linear-gradient(135deg, #f59e0b, #fbbf24);
    -webkit-background-clip: text;
    background-clip: text;
}

.health-score.health-low {
    background: linear-gradient(135deg, #ef4444, #f87171);
    -webkit-background-clip: text;
    background-clip: text;
}

.health-label {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--gray-800);
    margin-bottom: 0.5rem;
}

.health-description {
    font-size: 0.875rem;
    color: var(--gray-600);
}

/* Metrics Grid */
.metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
}

.metric-card {
    background: white;
    border-radius: 12px;
    padding: 1.5rem;
    text-align: center;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.metric-icon {
    font-size: 2rem;
    margin-bottom: 0.5rem;
}

.metric-value {
    font-size: 2rem;
    font-weight: 800;
    color: var(--gray-800);
}

.metric-label {
    font-size: 0.875rem;
    color: var(--gray-600);
}

/* Section Styles */
.section {
    background: white;
    border-radius: 16px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.section-header {
    margin-bottom: 1rem;
}

.section-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--gray-800);
}

/* Risk Grid */
.risk-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1rem;
}

.risk-card {
    background: var(--gray-50);
    border-radius: 12px;
    padding: 1.25rem;
    border-left: 4px solid var(--gray-300);
}

.risk-card.high {
    border-left-color: #ef4444;
    background: #fef2f2;
}

.risk-card.medium {
    border-left-color: #f59e0b;
    background: #fffbeb;
}

.risk-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
}

.user-initial {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 700;
    font-size: 1rem;
}

.risk-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.risk-name {
    font-weight: 600;
    color: var(--gray-800);
    text-decoration: none;
}

.risk-name:hover {
    color: #667eea;
}

.risk-badge {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
}

.risk-badge.high {
    background: #fecaca;
    color: #dc2626;
}

.risk-badge.medium {
    background: #fde68a;
    color: #b45309;
}

.risk-metrics {
    display: flex;
    gap: 1rem;
}

.risk-metric {
    display: flex;
    flex-direction: column;
}

.risk-metric .metric-name {
    font-size: 0.7rem;
    color: var(--gray-600);
    text-transform: uppercase;
}

.risk-metric .metric-value {
    font-size: 1rem;
    font-weight: 700;
    color: var(--gray-800);
}

/* Alert Card */
.alert-card {
    background: var(--gray-50);
    border-radius: 10px;
    padding: 1rem;
    margin-bottom: 0.75rem;
    border-left: 4px solid var(--gray-300);
}

.alert-card.critical {
    border-left-color: #ef4444;
    background: #fef2f2;
}

.alert-card.high {
    border-left-color: #f97316;
    background: #fff7ed;
}

.alert-card.medium {
    border-left-color: #f59e0b;
    background: #fffbeb;
}

.alert-card.low {
    border-left-color: #3b82f6;
    background: #eff6ff;
}

.alert-title {
    font-weight: 600;
    color: var(--gray-800);
    margin-bottom: 0.25rem;
}

.alert-description {
    font-size: 0.875rem;
    color: var(--gray-600);
    margin-bottom: 0.5rem;
}

.alert-meta {
    display: flex;
    gap: 1rem;
    font-size: 0.75rem;
    color: var(--gray-500);
}

/* Blocker Item */
.blocker-item {
    padding: 1rem;
    background: var(--gray-50);
    border-radius: 8px;
    margin-bottom: 0.75rem;
    border-left: 3px solid #ef4444;
}

.blocker-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.5rem;
}

.blocker-user {
    font-weight: 600;
    color: var(--gray-800);
}

.blocker-date {
    font-size: 0.875rem;
    color: var(--gray-500);
}

.blocker-text {
    font-size: 0.875rem;
    color: var(--gray-700);
    line-height: 1.6;
}

/* Performer Card */
.performer-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--gray-50);
    border-radius: 10px;
    margin-bottom: 0.75rem;
}

.performer-rank {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: linear-gradient(135deg, #f59e0b, #fbbf24);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 800;
    font-size: 1.25rem;
}

.performer-info {
    display: flex;
    flex-direction: column;
}

.performer-name {
    font-weight: 600;
    color: var(--gray-800);
    text-decoration: none;
}

.performer-name:hover {
    color: #667eea;
}

.performer-score {
    font-size: 0.875rem;
    color: var(--gray-600);
}

/* Responsive */
@media (max-width: 768px) {
    .health-score {
        font-size: 4rem;
    }
    
    .metrics-grid {
        grid-template-columns: repeat(2, 1fr);
    }
    
    .risk-grid {
        grid-template-columns: 1fr;
    }
    
    .risk-metrics {
        flex-wrap: wrap;
    }
}
`;
