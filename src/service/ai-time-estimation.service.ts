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
    const prompt = `You are a software development time estimation expert. Estimate how many hours this task likely took to complete.

Task: "${task}"

Provide your estimate in this exact JSON format:
{
  "hours": <number>,
  "confidence": "<low|medium|high>"
}

Consider:
- Code complexity
- Testing requirements
- Common development patterns
- Bug fixing typically takes 1-4 hours
- New features typically take 2-8 hours
- Reviews typically take 0.5-2 hours
- Meetings are usually listed as actual duration

Be realistic and concise. Only respond with the JSON, nothing else.`;

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
    
    return {
      task,
      estimatedHours: estimate.hours || 2,
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
    const totalYesterdayHours = yesterdayEstimates.reduce(
      (sum, est) => sum + est.estimatedHours,
      0
    );
    
    const totalTodayHours = todayEstimates.reduce(
      (sum, est) => sum + est.estimatedHours,
      0
    );

    return {
      yesterdayEstimates,
      todayEstimates,
      totalYesterdayHours: Math.round(totalYesterdayHours * 10) / 10,
      totalTodayHours: Math.round(totalTodayHours * 10) / 10,
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

