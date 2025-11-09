import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger';

/**
 * Sanitize HTML input to prevent XSS attacks
 * Simple but effective approach without external dependencies
 */
export function sanitizeInput(input: string): string {
  if (!input) return '';
  
  // Strip all HTML tags and dangerous characters
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
    .replace(/<[^>]+>/g, '') // Remove all HTML tags
    .trim();
}

/**
 * Escape HTML for safe display
 */
export function escapeHtml(text: string): string {
  if (!text) return '';
  
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Rate limiter for general API endpoints
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json({
      error: 'Too many requests, please try again later.',
    });
  },
});

/**
 * Rate limiter for Slack command submissions
 */
export const slackCommandLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 commands per minute per user
  keyGenerator: (req, res) => {
    // Use Slack user ID if available
    // If not, let the library use default IP handling (which supports IPv6)
    return req.body?.user_id;
  },
  message: 'Too many standup submissions, please wait a moment.',
  handler: (req, res) => {
    logger.warn('Slack command rate limit exceeded', {
      userId: req.body?.user_id,
      ip: req.ip,
    });
    res.status(429).json({
      error: 'Please wait before submitting another standup.',
    });
  },
});

/**
 * Rate limiter for AI operations (more restrictive due to cost)
 */
export const aiOperationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 AI operations per hour
  message: 'AI rate limit exceeded, please try again later.',
  handler: (req, res) => {
    logger.warn('AI operation rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json({
      error: 'AI usage limit exceeded, please try again later.',
    });
  },
});

/**
 * Rate limiter for authentication attempts
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  skipSuccessfulRequests: true,
  message: 'Too many authentication attempts, please try again later.',
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
    });
    res.status(429).json({
      error: 'Too many authentication attempts.',
    });
  },
});

/**
 * Validate environment variables for security
 */
export function validateSecurityConfig(): void {
  const required = [
    'CLERK_PUBLISHABLE_KEY',
    'CLERK_SECRET_KEY',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.error('Missing required security environment variables', {
      missing,
    });
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }

  logger.info('Security configuration validated');
}

