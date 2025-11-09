import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

interface TaskEstimate {
  task: string;
  estimatedHours: number;
  confidence: 'low' | 'medium' | 'high';
}

/**
 * Extract tasks from standup text (bullet points)
 */
function extractTasks(text: string): string[] {
  if (!text) return [];
  
  // Split by bullet points or numbered lists
  const tasks = text
    .split(/\n/)
    .map(line => line.trim())
    .filter(line => {
      // Match lines starting with bullet points or numbers
      return /^[•\-–*]/.test(line) || /^\d+\./.test(line);
    })
    .map(line => {
      // Remove bullet points and numbers
      return line.replace(/^[•\-–*]\s*/, '').replace(/^\d+\.\s*/, '').trim();
    })
    .filter(line => line.length > 0);

  return tasks;
}

/**
 * Estimate time for a single task using OpenAI
 */
async function estimateTaskTime(task: string): Promise<TaskEstimate> {
  try {
    const prompt = `You are a software development time estimation expert. Estimate how many hours this SINGLE task likely took to complete.

Task: "${task}"

IMPORTANT RULES:
- Maximum 8 hours for any single task
- Most tasks are 1-4 hours
- Bug fixes: 0.5-3 hours
- Code reviews: 0.5-1.5 hours
- Small features: 1-3 hours
- Medium features: 2-6 hours
- Large features: 4-8 hours (split if bigger)
- Meetings: Usually 0.5-2 hours
- Research: 1-4 hours
- Setup tasks: 0.5-2 hours

Respond ONLY with JSON in this EXACT format:
{
  "hours": <number between 0.5 and 8>,
  "confidence": "<low|medium|high>"
}

Be realistic - most tasks take 1-3 hours. Only respond with the JSON, nothing else.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 100,
    });

    const response = completion.choices[0]?.message?.content?.trim();
    
    if (!response) {
      throw new Error('No response from OpenAI');
    }

    // Parse JSON response
    const estimate = JSON.parse(response);
    
    // Validate and constrain the hours (safety check)
    let hours = estimate.hours || 2;
    if (hours > 8) hours = 8; // Max 8 hours per task
    if (hours < 0.5) hours = 0.5; // Min 0.5 hours
    
    return {
      task,
      estimatedHours: Math.round(hours * 2) / 2, // Round to nearest 0.5
      confidence: estimate.confidence || 'medium',
    };
  } catch (error) {
    console.error(`Error estimating time for task: ${task}`, error);
    // Default fallback estimate
    return {
      task,
      estimatedHours: 2,
      confidence: 'low',
    };
  }
}

/**
 * Estimate time for all tasks in standup sections
 */
export async function estimateStandupTime(
  yesterday: string,
  today: string
): Promise<{
  yesterdayEstimates: TaskEstimate[];
  todayEstimates: TaskEstimate[];
  totalYesterdayHours: number;
  totalTodayHours: number;
}> {
  // Check if OpenAI is configured
  if (!process.env.OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY not configured - skipping time estimation');
    return {
      yesterdayEstimates: [],
      todayEstimates: [],
      totalYesterdayHours: 0,
      totalTodayHours: 0,
    };
  }

  try {
    // Extract tasks from both sections
    const yesterdayTasks = extractTasks(yesterday);
    const todayTasks = extractTasks(today);

    // Estimate time for each task
    const yesterdayEstimates = await Promise.all(
      yesterdayTasks.map(task => estimateTaskTime(task))
    );
    
    const todayEstimates = await Promise.all(
      todayTasks.map(task => estimateTaskTime(task))
    );

    // Calculate totals
    let totalYesterdayHours = yesterdayEstimates.reduce(
      (sum, est) => sum + est.estimatedHours,
      0
    );
    
    let totalTodayHours = todayEstimates.reduce(
      (sum, est) => sum + est.estimatedHours,
      0
    );

    // Sanity check: Cap at reasonable maximums
    // A typical work day is 6-8 hours of actual coding
    if (totalYesterdayHours > 10) {
      console.warn(`Yesterday estimate too high (${totalYesterdayHours}h), capping at 10h`);
      totalYesterdayHours = 10;
    }
    
    if (totalTodayHours > 10) {
      console.warn(`Today estimate too high (${totalTodayHours}h), capping at 10h`);
      totalTodayHours = 10;
    }

    return {
      yesterdayEstimates,
      todayEstimates,
      totalYesterdayHours: Math.round(totalYesterdayHours * 2) / 2, // Round to nearest 0.5
      totalTodayHours: Math.round(totalTodayHours * 2) / 2,
    };
  } catch (error) {
    console.error('Error in estimateStandupTime:', error);
    return {
      yesterdayEstimates: [],
      todayEstimates: [],
      totalYesterdayHours: 0,
      totalTodayHours: 0,
    };
  }
}

/**
 * Format task estimates as text with time annotations
 */
export function formatTasksWithEstimates(
  originalText: string,
  estimates: TaskEstimate[]
): string {
  if (estimates.length === 0) return originalText;

  const lines = originalText.split('\n');
  let estimateIndex = 0;

  const formattedLines = lines.map(line => {
    const trimmed = line.trim();
    
    // Check if this line is a task (starts with bullet or number)
    if (/^[•\-–*]/.test(trimmed) || /^\d+\./.test(trimmed)) {
      if (estimateIndex < estimates.length) {
        const estimate = estimates[estimateIndex];
        estimateIndex++;
        
        // Add time estimate to the line
        const confidence = estimate.confidence === 'high' ? '' : ' (est)';
        return `${line} - ${estimate.estimatedHours}h${confidence}`;
      }
    }
    
    return line;
  });

  return formattedLines.join('\n');
}

