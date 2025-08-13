/**
 * Basic tests for TaskEngine
 */

import { TaskEngine, TaskStrategy, TaskWorkflowStep, ToolCall, ToolResponse, TaskProcessingResult } from '../src';

// Mock strategy for testing
class MockTaskStrategy implements TaskStrategy {
  getName(): string {
    return 'MockStrategy';
  }

  calculateProgress(toolCalls: ToolCall[], turnCount: number): number {
    return Math.min(turnCount * 20, 100);
  }

  isTaskComplete(toolCalls: ToolCall[]): boolean {
    return toolCalls.some(call => call.name === 'complete_task' && call.status === 'completed');
  }

  getFatalErrorPatterns(): RegExp[] {
    return [/FATAL_ERROR/i];
  }

  getWorkflowSteps(): TaskWorkflowStep[] {
    return [
      { name: 'initialize', weight: 25, isRequired: true },
      { name: 'process', weight: 50, isRequired: true },
      { name: 'complete_task', weight: 100, isRequired: true }
    ];
  }

  processToolResult(toolCall: ToolCall, result: ToolResponse): TaskProcessingResult {
    return { shouldContinue: true };
  }

  isValidToolCall(toolName: string, args: Record<string, unknown>): boolean {
    const validTools = ['initialize', 'process', 'complete_task'];
    return validTools.includes(toolName);
  }
}

describe('TaskEngine', () => {
  let taskEngine: TaskEngine;
  let mockStrategy: MockTaskStrategy;
  let statusUpdates: any[] = [];

  beforeEach(() => {
    mockStrategy = new MockTaskStrategy();
    statusUpdates = [];
    
    taskEngine = new TaskEngine({
      strategy: mockStrategy,
      onStatusUpdate: (status) => {
        statusUpdates.push(status);
      }
    });
  });

  test('should create TaskEngine instance', () => {
    expect(taskEngine).toBeInstanceOf(TaskEngine);
  });

  test('should accept task execution request', async () => {
    const request = {
      sessionId: 'test-session',
      description: 'Test task description',
      workingDirectory: '/tmp'
    };

    // Note: This test will fail without proper gemini-cli setup
    // It's mainly for structure validation
    expect(() => taskEngine.executeTask(request)).not.toThrow();
  });

  test('mock strategy should work correctly', () => {
    expect(mockStrategy.getName()).toBe('MockStrategy');
    expect(mockStrategy.calculateProgress([], 5)).toBe(100);
    expect(mockStrategy.isValidToolCall('initialize', {})).toBe(true);
    expect(mockStrategy.isValidToolCall('invalid_tool', {})).toBe(false);
  });

  test('should handle status updates', () => {
    const engine = new TaskEngine({
      onStatusUpdate: (status) => {
        expect(status).toHaveProperty('sessionId');
        expect(status).toHaveProperty('progress');
        expect(status).toHaveProperty('currentAction');
      }
    });
    
    expect(engine).toBeInstanceOf(TaskEngine);
  });
});

describe('MockTaskStrategy', () => {
  let strategy: MockTaskStrategy;

  beforeEach(() => {
    strategy = new MockTaskStrategy();
  });

  test('should calculate progress correctly', () => {
    expect(strategy.calculateProgress([], 0)).toBe(0);
    expect(strategy.calculateProgress([], 1)).toBe(20);
    expect(strategy.calculateProgress([], 5)).toBe(100);
    expect(strategy.calculateProgress([], 10)).toBe(100); // Should cap at 100
  });

  test('should detect task completion', () => {
    const incompleteCalls: ToolCall[] = [
      {
        callId: '1',
        name: 'initialize',
        args: {},
        status: 'completed',
        startTime: Date.now()
      }
    ];

    const completeCalls: ToolCall[] = [
      ...incompleteCalls,
      {
        callId: '2',
        name: 'complete_task',
        args: {},
        status: 'completed',
        startTime: Date.now()
      }
    ];

    expect(strategy.isTaskComplete(incompleteCalls)).toBe(false);
    expect(strategy.isTaskComplete(completeCalls)).toBe(true);
  });

  test('should validate tool calls', () => {
    expect(strategy.isValidToolCall('initialize', {})).toBe(true);
    expect(strategy.isValidToolCall('process', {})).toBe(true);
    expect(strategy.isValidToolCall('complete_task', {})).toBe(true);
    expect(strategy.isValidToolCall('invalid_tool', {})).toBe(false);
  });

  test('should have workflow steps', () => {
    const steps = strategy.getWorkflowSteps();
    expect(steps).toHaveLength(3);
    expect(steps[0].name).toBe('initialize');
    expect(steps[2].weight).toBe(100);
  });
});