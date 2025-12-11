import { format } from 'date-fns';
import { logInfo, logError } from './logger';

/**
 * Default Egyptian Public Holidays (fallback if API fails)
 */
const DEFAULT_HOLIDAYS = [
  // 2025 Fixed holidays
  '2025-01-07', '2025-01-25', '2025-04-25', '2025-05-01',
  '2025-06-30', '2025-07-23', '2025-10-06',
  // 2025 Islamic holidays (approximate)
  '2025-03-30', '2025-03-31', '2025-04-01',
  '2025-06-06', '2025-06-07', '2025-06-08', '2025-06-09',
  '2025-06-26', '2025-09-04',
  // 2026 Fixed holidays
  '2026-01-07', '2026-01-25', '2026-04-25', '2026-05-01',
  '2026-06-30', '2026-07-23', '2026-10-06',
  // 2026 Islamic holidays (approximate)
  '2026-03-20', '2026-03-21', '2026-03-22',
  '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30',
  '2026-06-16', '2026-08-25',
];

// Cache for holidays
let holidaysCache: string[] | null = null;
let lastFetchTime: number = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch Egyptian holidays from free public API
 * Using date.nager.at - a free public holidays API (no API key required)
 * API URL can be overridden via HOLIDAYS_API_URL environment variable
 */
const fetchHolidaysFromAPI = async (year: number): Promise<string[]> => {
  try {
    // Default to free date.nager.at API, but allow override
    const apiUrl = process.env.HOLIDAYS_API_URL || 
                   `https://date.nager.at/api/v3/PublicHolidays/${year}/EG`;

    logInfo(`📅 Fetching holidays from API for year ${year}...`);
    
    const response = await fetch(apiUrl, { 
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    
    if (!response.ok) {
      logError(`API request failed with status: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    // Parse response - date.nager.at returns array of holidays
    let holidays: string[] = [];
    
    if (Array.isArray(data)) {
      holidays = data.map((holiday: any) => {
        // date.nager.at format: { date: "2025-01-07", localName: "...", name: "..." }
        return holiday.date;
      }).filter((date: string) => date); // Remove any null/undefined
    }
    
    logInfo(`✅ Fetched ${holidays.length} holidays from API`);
    return holidays;
    
  } catch (error) {
    logError('❌ Error fetching holidays from API:', error);
    return [];
  }
};

/**
 * Get the list of holidays from API, environment variable, or defaults
 * Priority: 1. API (cached), 2. Environment variable, 3. Defaults
 */
const getHolidays = async (): Promise<string[]> => {
  // Check if we have valid cached data
  const now = Date.now();
  if (holidaysCache && (now - lastFetchTime) < CACHE_DURATION) {
    return holidaysCache;
  }

  // Try to fetch from API
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  
  const currentYearHolidays = await fetchHolidaysFromAPI(currentYear);
  const nextYearHolidays = await fetchHolidaysFromAPI(nextYear);
  
  let holidays: string[] = [...currentYearHolidays, ...nextYearHolidays];
  
  // If API returned holidays, use them
  if (holidays.length > 0) {
    holidaysCache = holidays;
    lastFetchTime = now;
    return holidays;
  }
  
  // Fallback to environment variable
  const envHolidays = process.env.EGYPTIAN_HOLIDAYS;
  if (envHolidays) {
    holidays = envHolidays
      .split(',')
      .map(date => date.trim())
      .filter(date => date.length > 0);
    
    holidaysCache = holidays;
    lastFetchTime = now;
    return holidays;
  }
  
  // Final fallback to defaults
  logInfo('Using default holiday list');
  holidaysCache = DEFAULT_HOLIDAYS;
  lastFetchTime = now;
  return DEFAULT_HOLIDAYS;
};

/**
 * Check if a given date is an Egyptian public holiday
 * @param date - The date to check
 * @returns true if the date is a holiday, false otherwise
 */
export const isEgyptianHoliday = async (date: Date = new Date()): Promise<boolean> => {
  const dateString = format(date, 'yyyy-MM-dd');
  const holidays = await getHolidays();
  
  return holidays.includes(dateString);
};

/**
 * Check if today is a working day (not Friday, Saturday, or a holiday)
 * @returns true if it's a working day, false otherwise
 */
export const isWorkingDay = async (): Promise<boolean> => {
  const today = new Date();
  const dayOfWeek = today.getDay();
  
  // Friday (5) and Saturday (6) are weekends in Egypt
  if (dayOfWeek === 5 || dayOfWeek === 6) {
    return false;
  }
  
  // Check if it's a public holiday
  const isHoliday = await isEgyptianHoliday(today);
  if (isHoliday) {
    return false;
  }
  
  return true;
};
