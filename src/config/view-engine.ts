import { Express } from 'express';
import { engine } from 'express-handlebars';
import { format } from 'date-fns';
import fs from 'fs';
import path from 'path';

const appPackage = require('../../package.json') as { version?: string };
const lucidePackageRoot = path.dirname(require.resolve('lucide-static/package.json'));
const lucideIconsDir = path.join(lucidePackageRoot, 'icons');
const iconCache = new Map<string, string>();

function sanitizeIconClass(className?: string): string {
  if (!className) return '';

  return className
    .split(/\s+/)
    .filter((token) => /^[A-Za-z0-9_:-]+$/.test(token))
    .join(' ');
}

/**
 * Render a Lucide SVG from lucide-static.
 * Icon names must be server-controlled slugs, never user input.
 */
export function renderIcon(name: string, className?: string): string {
  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    return '';
  }

  const classes = ['icon', sanitizeIconClass(className)].filter(Boolean).join(' ');
  const cacheKey = `${name}:${classes}`;
  const cached = iconCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const iconPath = path.join(lucideIconsDir, `${name}.svg`);

  if (!iconPath.startsWith(lucideIconsDir) || !fs.existsSync(iconPath)) {
    return '';
  }

  const source = fs.readFileSync(iconPath, 'utf8')
    .trim()
    .replace(/<svg\b/, '<svg aria-hidden="true" focusable="false"');

  const svg = source.includes('class="')
    ? source.replace(/\bclass="([^"]*)"/, `class="${classes} $1"`)
    : source.replace(/<svg\b/, `<svg class="${classes}"`);

  iconCache.set(cacheKey, svg);
  return svg;
}

/**
 * Configure Handlebars view engine for Express
 */
export function configureViewEngine(app: Express): void {
  const viewsPath = path.join(__dirname, '../views');
  
  // Configure Handlebars engine
  app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: path.join(viewsPath, 'layouts'),
    partialsDir: path.join(viewsPath, 'partials'),
    helpers: {
      // Equality check helper
      eq: (a: any, b: any) => a === b,
      
      // Greater than helper
      gt: (a: number, b: number) => a > b,
      
      // Less than helper
      lt: (a: number, b: number) => a < b,
      
      // Not equal helper
      neq: (a: any, b: any) => a !== b,
      
      // And helper
      and: (...args: any[]) => {
        // Remove the last argument (Handlebars options)
        args.pop();
        return args.every(Boolean);
      },
      
      // Or helper
      or: (...args: any[]) => {
        args.pop();
        return args.some(Boolean);
      },
      
      // JSON stringify helper
      json: (context: any) => JSON.stringify(context),

      // Render a server-controlled Lucide SVG icon
      icon: (name: string, options?: { hash?: { class?: string } }) => {
        return renderIcon(name, options?.hash?.class);
      },
      
      // Format date helper with date-fns
      formatDate: (date: string | Date, formatStr?: string) => {
        if (!date) return '';
        try {
          const d = typeof date === 'string' ? new Date(date) : date;
          // Default format if not provided
          const fmt = formatStr && typeof formatStr === 'string' ? formatStr : 'MMM d, yyyy';
          return format(d, fmt);
        } catch {
          return String(date);
        }
      },
      
      // Format duration in minutes to human readable
      formatDuration: (minutes: number) => {
        if (minutes < 60) {
          return `${minutes} min${minutes !== 1 ? 's' : ''}`;
        }
        const hours = Math.floor(minutes / 60);
        const remainingMins = minutes % 60;
        if (remainingMins === 0) {
          return `${hours} hour${hours !== 1 ? 's' : ''}`;
        }
        return `${hours}h ${remainingMins}m`;
      },
      
      // Pluralize helper
      pluralize: (count: number, singular: string, plural?: string) => {
        return count === 1 ? singular : (plural || singular + 's');
      },
      
      // Truncate text helper
      truncate: (str: string, len: number) => {
        if (!str) return '';
        if (str.length <= len) return str;
        return str.substring(0, len) + '...';
      },
      
      // Default value helper
      defaultVal: (value: any, defaultValue: any) => {
        return value || defaultValue;
      },
      
      // Conditional class helper
      classIf: (condition: boolean, className: string) => {
        return condition ? className : '';
      },
      
      // Math add helper
      add: (a: number, b: number) => (a || 0) + (b || 0),
      
      // Math subtract helper
      subtract: (a: number, b: number) => (a || 0) - (b || 0),
      
      // Math multiply helper
      multiply: (a: number, b: number) => (a || 0) * (b || 0),
      
      // Math divide helper
      divide: (a: number, b: number) => b ? (a || 0) / b : 0,
      
      // Get user initial from name
      userInitial: (name: string) => {
        if (!name) return '?';
        return name.charAt(0).toUpperCase();
      },
      
      // Heatmap color class based on percentage
      heatmapClass: (rate: number) => {
        if (rate >= 50) return 'heat-high';
        if (rate >= 25) return 'heat-medium';
        if (rate > 0) return 'heat-low';
        return 'heat-none';
      },
      
      // Score class based on percentage
      scoreClass: (score: number) => {
        if (score >= 80) return 'score-excellent';
        if (score >= 60) return 'score-good';
        if (score >= 40) return 'score-fair';
        return 'score-low';
      },
      
      // Health score class for dashboard display
      healthScoreClass: (score: number) => {
        if (score >= 80) return 'health-excellent';
        if (score >= 60) return 'health-good';
        if (score >= 40) return 'health-fair';
        return 'health-low';
      },
      
      // Lookup hours from workload data by username
      lookupHours: (workloadData: any[], userName: string) => {
        const entry = workloadData?.find((w: any) => w.userName === userName);
        return entry ? `${entry.totalHours}h` : '0h';
      },
      
      // Loop helper with index
      times: (n: number, options: any) => {
        let result = '';
        for (let i = 0; i < n; i++) {
          result += options.fn({ index: i, first: i === 0, last: i === n - 1 });
        }
        return result;
      },
      
      // Safe HTML output (already escaped by Handlebars by default)
      // Use triple braces {{{html}}} for raw HTML
      
      // Get array length
      length: (arr: any[]) => arr?.length || 0,
      
      // Check if array is empty
      isEmpty: (arr: any[]) => !arr || arr.length === 0,
      
      // Check if array is not empty
      isNotEmpty: (arr: any[]) => arr && arr.length > 0
    }
  }));
  
  app.set('view engine', 'hbs');
  app.set('views', viewsPath);
}

/**
 * Common render data for all views
 */
export interface BaseViewData {
  title: string;
  currentPage: string;
  hasClerk: boolean;
  appVersion: string;
  autoRefresh?: boolean;
  autoRefreshMs?: number;
  pageStyles?: string;
  pageScripts?: string;
}

/**
 * Create base view data with defaults
 */
export function createBaseViewData(
  title: string,
  currentPage: string,
  hasClerk: boolean,
  options?: Partial<BaseViewData>
): BaseViewData {
  return {
    title,
    currentPage,
    hasClerk,
    appVersion: appPackage.version || '1.0.0',
    autoRefresh: false,
    autoRefreshMs: 120000, // 2 minutes default
    ...options
  };
}
