import { z } from "zod";

// Boolean fields from Appearance model
export const createAppearanceSchema = z.object({
  // Dashboard Sections Visibility
  calendar: z.boolean(),
  hotlist: z.boolean(),
  callingGroupsWorkspace: z.boolean(),
  dialerHealth: z.boolean(),
  callStatistics: z.boolean(),
  foldersLists: z.boolean(),
  recentActivity: z.boolean(),

  // AI & Intelligence Sections
  bestTimeToCall: z.boolean(),
  leadIntelligence: z.boolean(),
  aiCoachingCallAnalysis: z.boolean(),
  callOutcomeIntelligence: z.boolean(),
  efficiencyAutomation: z.boolean(),
  complianceRiskMonitoring: z.boolean(),
  callingGroupsAiSidekick: z.boolean(),
  agentImprovementScores: z.boolean(),
  pipelineAccelerationIndex: z.boolean(),

  // Additional Options
  lockGroups: z.boolean(),
  birthdays: z.boolean(),
  homeCloseDate: z.boolean(),

  // Time Zone
  timeZone: z.string(),
});

// For update, all fields optional
export const updateAppearanceSchema = createAppearanceSchema.partial();
