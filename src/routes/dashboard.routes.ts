import type { Express, RequestHandler } from 'express';
import { getStandupHistory } from '../service/standup-history.service';
import { getSubmissionsDashboard } from '../service/submissions-dashboard.service';
import { getUserReport } from '../service/user-report.service';
import { getManagerDashboard } from '../service/manager-dashboard.service';
import { getTeamAnalyticsDashboard } from '../service/team-analytics-dashboard.service';
import { getBreaksDashboard } from '../service/breaks-dashboard.service';
import { serveWorkflowDashboard } from '../service/workflow.service';
import { serveLinearNotes } from '../service/linear-notes.service';
import { exportStandupsCSV, exportPerformanceMetricsCSV, exportAlertsCSV, exportAchievementsCSV, exportUserReportCSV } from '../service/export.service';
import { checkAuth, requireManager, canViewUserData } from '../middleware/clerk-auth.middleware';

export function registerDashboardRoutes(expressApp: Express, hasClerk: boolean) {
  // Protected dashboard routes (require auth if Clerk is configured)
  const publicAccess: RequestHandler = (_req, _res, next) => next();
  const authMiddleware = hasClerk ? checkAuth : publicAccess;
  const managerMiddleware = hasClerk ? requireManager : publicAccess;

  expressApp.get('/', authMiddleware, getSubmissionsDashboard);
  expressApp.get('/submissions', authMiddleware, getSubmissionsDashboard);
  expressApp.get('/user/:userId', authMiddleware, hasClerk ? canViewUserData : publicAccess, getUserReport); // Individual user report
  expressApp.get('/history', authMiddleware, getStandupHistory); // Legacy thread-based view
  expressApp.get('/manager', authMiddleware, managerMiddleware, getManagerDashboard); // Manager insights dashboard
  expressApp.get('/analytics', authMiddleware, managerMiddleware, getTeamAnalyticsDashboard); // Team analytics with charts
  expressApp.get('/breaks', authMiddleware, getBreaksDashboard); // Breaks tracking dashboard
  expressApp.get('/workflow', authMiddleware, serveWorkflowDashboard); // Task workflow visualization
  expressApp.get('/linear-notes', authMiddleware, serveLinearNotes); // Linear notes dashboard

  // Export routes
  expressApp.get('/export/standups', authMiddleware, managerMiddleware, exportStandupsCSV); // Export standups to CSV
  expressApp.get('/export/metrics', authMiddleware, managerMiddleware, exportPerformanceMetricsCSV); // Export performance metrics to CSV
  expressApp.get('/export/alerts', authMiddleware, managerMiddleware, exportAlertsCSV); // Export alerts to CSV
  expressApp.get('/export/achievements', authMiddleware, managerMiddleware, exportAchievementsCSV); // Export achievements to CSV
  expressApp.get('/export/user/:userId', authMiddleware, managerMiddleware, exportUserReportCSV); // Export comprehensive user report to CSV

}
