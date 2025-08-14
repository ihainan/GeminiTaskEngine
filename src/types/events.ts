/**
 * @license
 * Copyright 2025 AIZGC Team
 * SPDX-License-Identifier: MIT
 */

/**
 * Event-driven status update system for TaskEngine
 * Each event represents a specific moment in time with potentially multiple updates
 */

export interface ProgressUpdate {
  currentTurn: number;
  maxTurns: number;
  percentage: number;
}

export interface LLMResponseUpdate {
  text: string;
  isComplete: boolean;
}

export interface ToolStartUpdate {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultUpdate {
  id: string;
  result: string;
  status: 'completed' | 'error';
  duration?: number;
}

export interface CompletionUpdate {
  success: boolean;
  summary: string;
  error?: string;
}

export interface CurrentActionUpdate {
  type: 'thinking' | 'tool_executing' | 'responding';
  description: string;
}

export interface SystemMessageUpdate {
  model: string;
  cwd: string;
  sessionId: string;
  tools: string[];
  mcpServers?: string[];
  permissionMode: string;
}

export interface ResultMessageUpdate {
  duration: number;
  apiDuration: number;
  turns: number;
  totalCost: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  permissionDenials: number;
}

/**
 * Composite event that can contain multiple types of updates
 */
export interface TaskStatusEvent {
  turn: number;
  timestamp: string;
  sessionId: string;
  
  updates: {
    progress?: ProgressUpdate;
    llmResponse?: LLMResponseUpdate;
    toolStart?: ToolStartUpdate;
    toolResult?: ToolResultUpdate;
    completion?: CompletionUpdate;
    currentAction?: CurrentActionUpdate;
    systemMessage?: SystemMessageUpdate;
    resultMessage?: ResultMessageUpdate;
  };
}

/**
 * Event callback type for clients
 */
export type TaskEventCallback = (event: TaskStatusEvent) => void;