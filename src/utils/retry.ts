import { logWarn, logError } from './logger';

interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
}

/**
 * Retry an async function with exponential backoff
 * @param fn - The async function to retry
 * @param options - Retry configuration
 * @returns The result of the function
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxAttempts) {
        const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1);
        logWarn(`⚠️  Attempt ${attempt}/${maxAttempts} failed. Retrying in ${delay}ms...`, {
          error: lastError.message,
        });
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        logError(`❌ All ${maxAttempts} attempts failed:`, lastError);
      }
    }
  }

  throw lastError;
}
