import { Request, Response, NextFunction } from 'express';
import { clerkClient, requireAuth, getAuth } from '@clerk/express';
import { logger } from '../utils/logger';
import { SLACK_TEAM_ID } from '../config';

export interface DashboardAccess {
  workspaceId: string;
  slackUserId: string;
  role: 'member' | 'manager';
}

declare global {
  namespace Express {
    interface Request { dashboardAccess?: DashboardAccess; }
  }
}

// Only server-managed Clerk private metadata is trusted. User-editable metadata
// and request parameters must never grant workspace membership or manager access.
export function parseDashboardAccess(metadata: Record<string, unknown>): DashboardAccess | null {
  const value = metadata.standup as Partial<DashboardAccess> | null;
  if (!value || typeof value !== 'object' || value.workspaceId !== SLACK_TEAM_ID ||
      !/^T[A-Z0-9]+$/.test(value.workspaceId) ||
      typeof value.slackUserId !== 'string' || !/^[UW][A-Z0-9]+$/.test(value.slackUserId) ||
      (value.role !== 'member' && value.role !== 'manager')) return null;
  return value as DashboardAccess;
}

export const clerkAuthMiddleware = requireAuth({ signInUrl: '/auth/sign-in' });

export const checkAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getAuth(req).userId;
    if (!userId) {
      return res.redirect(`/auth/sign-in?redirect_url=${encodeURIComponent(req.originalUrl || req.path)}`);
    }
    const user = await clerkClient.users.getUser(userId);
    const access = parseDashboardAccess(user.privateMetadata);
    if (!access) return res.status(403).send('Access to this workspace has not been granted.');
    req.dashboardAccess = access;
    next();
  } catch (error) {
    logger.error('Auth middleware error', error);
    return res.redirect('/auth/sign-in');
  }
};

export const requireManager = (req: Request, res: Response, next: NextFunction) => {
  if (req.dashboardAccess?.role !== 'manager') return res.status(403).send('Manager access required.');
  next();
};

export const canViewUserData = (req: Request, res: Response, next: NextFunction) => {
  const access = req.dashboardAccess;
  if (!access || (access.role !== 'manager' && access.slackUserId !== req.params.userId)) {
    return res.status(403).send('You can only view your own report.');
  }
  next();
};
