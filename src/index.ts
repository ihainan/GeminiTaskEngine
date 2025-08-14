/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export { TaskEngine } from './core/TaskEngine.js';

// Core interfaces and types (original)
export type {
  TaskStrategy,
  ConfigurationBuilder,
  PromptStrategy,
  ProgressTracker,
  TaskWorkflowStep,
  TaskProcessingResult,
  ProgressInfo,
  ToolCall,
  ToolResponse,
  TaskAction,
  ErrorHandlingStrategy,
  ErrorContext,
  ErrorClassification,
  RecoveryAction,
} from './types/interfaces.js';

// Claude-specific interfaces and types
export type {
  ClaudeResponse,
  ClaudeToolCall
} from './types/claude-interfaces.js';

export type {
  TaskRequest,
  TaskStatus,
  TaskResult,
  TaskEngineOptions,
  ThoughtSummary,
} from './types/types.js';

// Default implementations
export { ClaudeConfigurationBuilder, SimplePromptBuilder } from './builders/index.js';