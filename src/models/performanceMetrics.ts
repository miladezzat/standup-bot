import mongoose, { Schema, Document } from 'mongoose';

/**
 * Performance Metrics Model
 * Stores aggregated performance data for team members over time
 */

export interface IPerformanceMetrics extends Document {
  slackUserId: string;
  slackUserName: string;
  workspaceId: string;
  
  // Time period
  period: 'week' | 'month' | 'quarter';
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  
  // Core Metrics
  totalSubmissions: number;
  expectedSubmissions: number; // Based on workdays in period
  consistencyScore: number;    // 0-100: submission rate
  
  // Velocity Metrics
  totalTasksCompleted: number;
  totalHoursEstimated: number;
  averageTasksPerDay: number;
  velocityTrend: 'increasing' | 'stable' | 'decreasing';
  
  // Blocker Metrics
  blockerCount: number;
  blockerDays: number; // Days with blockers
  blockerFrequency: number; // Percentage of days with blockers
  recurringBlockers: string[]; // List of repeated blocker keywords
  
  // Engagement Metrics
  engagementScore: number; // 0-100: Quality + consistency
  averageSubmissionTime: string; // e.g., "09:30"
  lateSubmissions: number; // After 12pm
  
  // AI-Generated Insights
  sentimentScore: number; // -1 to 1: negative to positive
  sentimentTrend: 'improving' | 'stable' | 'declining';
  riskLevel: 'low' | 'medium' | 'high';
  riskFactors: string[]; // Reasons for risk assessment
  
  // Performance Score
  overallScore: number; // 0-100: weighted average of all metrics
  
  // Comparison
  teamAverageScore: number;
  percentileRank: number; // 0-100: where user ranks in team
  
  createdAt: Date;
  updatedAt: Date;
}

const PerformanceMetricsSchema: Schema = new Schema(
  {
    slackUserId: {
      type: String,
      required: true,
      index: true
    },
    slackUserName: {
      type: String,
      required: true
    },
    workspaceId: {
      type: String,
      required: true,
      index: true
    },
    period: {
      type: String,
      enum: ['week', 'month', 'quarter'],
      required: true
    },
    startDate: {
      type: String,
      required: true,
      index: true
    },
    endDate: {
      type: String,
      required: true
    },
    // Core Metrics
    totalSubmissions: {
      type: Number,
      default: 0
    },
    expectedSubmissions: {
      type: Number,
      default: 0
    },
    consistencyScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    // Velocity Metrics
    totalTasksCompleted: {
      type: Number,
      default: 0
    },
    totalHoursEstimated: {
      type: Number,
      default: 0
    },
    averageTasksPerDay: {
      type: Number,
      default: 0
    },
    velocityTrend: {
      type: String,
      enum: ['increasing', 'stable', 'decreasing'],
      default: 'stable'
    },
    // Blocker Metrics
    blockerCount: {
      type: Number,
      default: 0
    },
    blockerDays: {
      type: Number,
      default: 0
    },
    blockerFrequency: {
      type: Number,
      default: 0
    },
    recurringBlockers: [{
      type: String
    }],
    // Engagement Metrics
    engagementScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    averageSubmissionTime: {
      type: String,
      default: '00:00'
    },
    lateSubmissions: {
      type: Number,
      default: 0
    },
    // AI Insights
    sentimentScore: {
      type: Number,
      default: 0,
      min: -1,
      max: 1
    },
    sentimentTrend: {
      type: String,
      enum: ['improving', 'stable', 'declining'],
      default: 'stable'
    },
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low'
    },
    riskFactors: [{
      type: String
    }],
    // Performance Score
    overallScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    // Comparison
    teamAverageScore: {
      type: Number,
      default: 0
    },
    percentileRank: {
      type: Number,
      default: 50,
      min: 0,
      max: 100
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for efficient queries
PerformanceMetricsSchema.index({ slackUserId: 1, period: 1, startDate: -1 });
PerformanceMetricsSchema.index({ workspaceId: 1, startDate: -1 });
PerformanceMetricsSchema.index({ riskLevel: 1, startDate: -1 });
PerformanceMetricsSchema.index({ overallScore: -1 });

export default mongoose.model<IPerformanceMetrics>('PerformanceMetrics', PerformanceMetricsSchema);

