/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Content, GenerateContentResponse } from '@google/genai';
import type { Config, MCPServerConfig } from '@google/gemini-cli-core';
import type { TaskRequest, TaskResult, TaskStatus } from './types.js';

/**
 * Core strategy interface for handling different task types
 */
export interface TaskStrategy {
  /**
   * Calculate task progress based on completed tool calls and current state
   */
  calculateProgress(toolCalls: ToolCall[], turnCount: number): number;
  
  /**
   * Determine if the task has been completed successfully
   */
  isTaskComplete(toolCalls: ToolCall[], response?: GenerateContentResponse): boolean;
  
  /**
   * Get patterns for fatal errors that should terminate execution
   */
  getFatalErrorPatterns(): RegExp[];
  
  /**
   * Get expected workflow steps for this task type
   */
  getWorkflowSteps(): TaskWorkflowStep[];
  
  /**
   * Process tool call results for domain-specific logic
   */
  processToolResult(toolCall: ToolCall, result: ToolResponse): TaskProcessingResult;
  
  /**
   * Validate if a tool call is expected for this task type
   */
  isValidToolCall(toolName: string, args: Record<string, unknown>): boolean;
  
  /**
   * Get strategy name for logging and debugging
   */
  getName(): string;
}

/**
 * Configuration builder interface for creating Config instances
 */
export interface ConfigurationBuilder {
  /**
   * Build a configuration for the given task request
   */
  buildConfiguration(request: TaskRequest): Promise<Config>;
  
  /**
   * Validate configuration parameters
   */
  validateConfiguration(config: Partial<ConfigParams>): ValidationResult;
}

/**
 * Prompt strategy interface for flexible prompt building
 */
export interface PromptStrategy {
  /**
   * Build the initial prompt for task execution
   */
  buildPrompt(request: TaskRequest, config?: Config): Promise<string>;
  
  /**
   * Get the system prompt to use
   */
  getSystemPrompt(config?: Config): Promise<string | undefined>;
  
  /**
   * Combine user prompt with system prompt
   */
  combinePrompts(systemPrompt: string | undefined, userPrompt: string): string;
  
  /**
   * Get strategy name for logging and debugging
   */
  getName(): string;
}

/**
 * Progress tracker interface for managing task progress
 */
export interface ProgressTracker {
  /**
   * Update progress based on current state
   */
  updateProgress(state: TaskExecutionState): ProgressInfo;
  
  /**
   * Get current progress information
   */
  getCurrentProgress(): ProgressInfo;
  
  /**
   * Reset progress to initial state
   */
  reset(): void;
}

// Supporting types and interfaces

export interface TaskWorkflowStep {
  name: string;
  weight: number; // Progress weight (0-100)
  isRequired: boolean;
  dependencies?: string[]; // Required preceding steps
}

export interface TaskProcessingResult {
  shouldContinue: boolean;
  extractedData?: Record<string, unknown>;
  finalResult?: Partial<TaskResult>;
}

export interface ConfigParams {
  sessionId: string;
  mcpServerConfig?: MCPServerConfig; // Optional: MCP server configuration
  model: string;
  maxTurns: number;
  workingDirectory: string;
  approvalMode: string; // ApprovalMode enum
  customOptions?: Record<string, unknown>;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}

export interface TaskExecutionState {
  toolCalls: ToolCall[];
  turnCount: number;
  sessionTurnCount: number;
  currentAction: TaskAction;
  strategy: TaskStrategy;
}

export interface ProgressInfo {
  percentage: number;
  currentStep?: string;
  estimatedTimeRemaining?: number;
  completedSteps: string[];
  remainingSteps: string[];
}

export interface ToolCall {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  status: 'pending' | 'executing' | 'completed' | 'error';
  startTime: number;
  duration?: number;
  result?: string;
  error?: string;
  exportPath?: string;
  responseParts?: any[];
}

export interface ToolResponse {
  error?: Error & { message: string };
  resultDisplay?: string | any;
  responseParts?: any | any[];
}

export interface TaskAction {
  type: 'thinking' | 'tool_executing' | 'responding';
  description: string;
}

/**
 * Error handling strategy interface
 */
export interface ErrorHandlingStrategy {
  classifyError(error: Error, context: ErrorContext): ErrorClassification;
  shouldRetry(error: Error, attemptCount: number): boolean;
  getRecoveryAction(error: Error): RecoveryAction;
}

export interface ErrorContext {
  toolName: string;
  args: Record<string, unknown>;
  turnCount: number;
  previousErrors: Error[];
}

export interface ErrorClassification {
  severity: 'fatal' | 'recoverable' | 'warning';
  category: 'network' | 'auth' | 'tool' | 'configuration' | 'unknown';
  shouldTerminate: boolean;
  shouldRetry: boolean;
}

export interface RecoveryAction {
  type: 'retry' | 'skip' | 'fallback' | 'terminate';
  fallbackTool?: string;
  retryDelay?: number;
  maxRetries?: number;
}