import { Request, Response, NextFunction } from 'express';
import { clerkClient, requireAuth } from '@clerk/express';
import { logger } from '../utils/logger';

/**
 * Clerk authentication middleware
 * Ensures user is authenticated before accessing protected routes
 */
export const clerkAuthMiddleware = requireAuth({
  // Redirect unauthenticated users to sign-in page
  signInUrl: '/auth/sign-in',
});

/**
 * Custom middleware to check if user is authenticated
 * More flexible than requireAuth for API endpoints
 */
export const checkAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // @ts-ignore - Clerk adds auth to request
    const userId = req.auth()?.userId;

    if (!userId) {
      logger.warn('Unauthenticated access attempt', {
        path: req.path,
        ip: req.ip,
      });
      
      // Redirect to sign-in page instead of returning JSON
      const returnUrl = encodeURIComponent(req.originalUrl || req.path);
      return res.redirect(`/auth/sign-in?redirect_url=${returnUrl}`);
    }

    // Get user details from Clerk
    const user = await clerkClient.users.getUser(userId);

    // Attach user to request for downstream use
    // @ts-ignore
    req.clerkUser = user;

    logger.debug('User authenticated', {
      userId,
      email: user.emailAddresses[0]?.emailAddress,
    });

    next();
  } catch (error) {
    logger.error('Auth middleware error', error);
    // Redirect on error too
    return res.redirect('/auth/sign-in');
  }
};

/**
 * Optional auth - attaches user if authenticated but doesn't require it
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // @ts-ignore
    const userId = req.auth()?.userId;

    if (userId) {
      const user = await clerkClient.users.getUser(userId);
      // @ts-ignore
      req.clerkUser = user;
    }

    next();
  } catch (error) {
    logger.error('Optional auth error', error);
    next(); // Continue even if there's an error
  }
};

/**
 * Check if user has access to view another user's data
 * (For now, all authenticated users can view all data - can be customized)
 */
export const canViewUserData = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // @ts-ignore
    const currentUserId = req.auth()?.userId;
    const targetUserId = req.params.userId;

    if (!currentUserId) {
      const returnUrl = encodeURIComponent(req.originalUrl || req.path);
      return res.redirect(`/auth/sign-in?redirect_url=${returnUrl}`);
    }

    // For now, all authenticated users can view all data
    // You can add custom logic here (e.g., same workspace, admin role, etc.)
    
    logger.debug('User data access check', {
      currentUserId,
      targetUserId,
    });

    next();
  } catch (error) {
    logger.error('Access check error', error);
    return res.redirect('/auth/sign-in');
  }
};

