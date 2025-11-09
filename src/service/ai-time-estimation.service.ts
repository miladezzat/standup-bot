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
    const prompt = `You are a SENIOR SOFTWARE ENGINEER with 10+ years of experience. Estimate REALISTICALLY how many hours this task actually took, based on real-world development experience.

Task: "${task}"

REALISTIC ESTIMATION RULES (based on actual development):

Quick Tasks (0.5-1h):
- Simple code reviews (< 100 lines)
- Minor text/UI changes
- Simple bug fixes (typos, small logic errors)
- Config changes
- Documentation updates

Short Tasks (1-2h):
- Standard code reviews (100-300 lines)
- Simple bug fixes with testing
- Small UI components
- Basic API endpoints
- Simple database queries
- Meetings (most are 1h)

Medium Tasks (2-4h):
- Complex bug fixes (debugging + fix + testing)
- Medium features (full implementation + tests)
- API integration with third party
- Complex code reviews
- Database schema changes
- Research and spike work

Long Tasks (4-6h):
- Large features (design + implement + test)
- Complex integrations
- Performance optimization work
- Major refactoring
- Architecture work

Very Long Tasks (6-8h):
- Full feature development (multiple components)
- Complex system integration
- Production debugging sessions
- Major migrations

BE HONEST AND REALISTIC:
- If task says "started" or "X% complete" - estimate based on % (e.g., 50% of 8h = 4h)
- If task is vague "worked on X" - estimate lower (1-2h)
- Research tasks are often longer than expected (2-4h)
- Production bugs take longer than dev bugs (add 30-50%)
- Tasks with "urgent" or "critical" often take longer (people underestimate)
- "Set up environment" is often 1-3h depending on complexity

Respond ONLY with JSON:
{
  "hours": <honest decimal number 0.5-8>,
  "confidence": "<low|medium|high>"
}

Be a senior engineer - estimate honestly. Don't be generous, don't be stingy. Be realistic.`;

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

