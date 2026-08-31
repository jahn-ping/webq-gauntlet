/**
 * Benchmark Types for webQ-Gauntlet Evaluation Harness
 * 
 * Defines the schema for benchmark cases across 5 categories:
 * factual, reasoning, coding, security, adversarial
 */

import { z } from 'zod';

// ============================================================================
// Benchmark Case Schema
// ============================================================================

export const BenchmarkCategorySchema = z.enum([
  'factual',
  'reasoning',
  'coding',
  'security',
  'adversarial'
]);

export type BenchmarkCategory = z.infer<typeof BenchmarkCategorySchema>;

export const ExpectedClaimSchema = z.object({
  factHash: z.string(),
  importanceWeight: z.number().min(0).max(1).default(1.0),
});

export const EvidenceRequirementSchema = z.object({
  domain: z.string(),
  minTypeCount: z.number().min(1).default(1),
});

export const AdversarialConfigSchema = z.object({
  enabled: z.boolean().default(false),
  injectionPayloads: z.array(z.string()).optional(),
  contradictorySources: z.array(z.string()).optional(),
});

export const BenchmarkThresholdsSchema = z.object({
  minimumScore: z.number().min(0).max(1),
  maximumCostUsd: z.number().optional(),
  maximumLatencyMs: z.number().optional(),
});

export const BenchmarkCaseSchema = z.object({
  id: z.string(),
  category: BenchmarkCategorySchema,
  prompt: z.string(),
  expected: z.object({
    answer: z.unknown().optional(),
    claims: z.array(ExpectedClaimSchema).optional(),
    requiredEvidence: z.array(EvidenceRequirementSchema).optional(),
    forbiddenClaims: z.array(z.string()).optional(),
  }),
  adversarial: AdversarialConfigSchema.optional(),
  thresholds: BenchmarkThresholdsSchema,
  tags: z.array(z.string()).default([]),
});

export type BenchmarkCase = z.infer<typeof BenchmarkCaseSchema>;

// ============================================================================
// Benchmark Suite
// ============================================================================

export const BenchmarkSuiteSchema = z.object({
  category: BenchmarkCategorySchema,
  cases: z.array(BenchmarkCaseSchema),
  metadata: z.object({
    version: z.string(),
    createdAt: z.string().datetime(),
    description: z.string().optional(),
  }).optional(),
});

export type BenchmarkSuite = z.infer<typeof BenchmarkSuiteSchema>;

// ============================================================================
// Evaluation Result Types
// ============================================================================

export const ClaimEvaluationSchema = z.object({
  factHash: z.string(),
  found: z.boolean(),
  confidence: z.number().min(0).max(1),
  supportScore: z.number().min(0).max(1),
  importanceWeight: z.number().min(0).max(1),
});

export const EvidenceEvaluationSchema = z.object({
  domain: z.string(),
  found: z.boolean(),
  typeCount: z.number(),
  minRequired: z.number(),
});

export const BenchmarkResultSchema = z.object({
  benchmarkId: z.string(),
  runId: z.string(),
  category: BenchmarkCategorySchema,
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  claimEvaluations: z.array(ClaimEvaluationSchema),
  evidenceEvaluations: z.array(EvidenceEvaluationSchema),
  forbiddenClaimsTriggered: z.array(z.string()),
  costUsd: z.number(),
  latencyMs: z.number(),
  roundsUsed: z.number(),
  gateResults: z.array(z.object({
    gateId: z.string(),
    passed: z.boolean(),
    score: z.number(),
    severity: z.enum(['info', 'warning', 'high', 'critical']),
  })),
  completedAt: z.string().datetime(),
});

export type BenchmarkResult = z.infer<typeof BenchmarkResultSchema>;

// ============================================================================
// Evaluation Suite Result
// ============================================================================

export const EvaluationSuiteResultSchema = z.object({
  suiteId: z.string(),
  benchmarkResults: z.array(BenchmarkResultSchema),
  aggregate: z.object({
    totalBenchmarks: z.number(),
    passed: z.number(),
    failed: z.number(),
    avgScore: z.number(),
    avgCostUsd: z.number(),
    avgLatencyMs: z.number(),
    avgRounds: z.number(),
    gatePassRates: z.record(z.string(), z.number()),
  }),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
});

export type EvaluationSuiteResult = z.infer<typeof EvaluationSuiteResultSchema>;