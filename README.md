# TaskEngine

A wrapper around Gemini CLI that provides a generic task execution engine with strategy pattern support for executing complex automated tasks.

## Installation

```bash
npm install
npm run build
```

## Usage

The TaskEngine allows you to execute complex tasks by defining custom strategies and prompt builders. See `test-simple.js` for a complete example of how to use the TaskEngine.

### Basic Usage

```javascript
import { TaskEngine } from './dist/index.js';

// Define a simple task strategy
class SimpleTaskStrategy {
  getName() {
    return 'SimpleTaskStrategy';
  }

  calculateProgress(toolCalls, turnCount) {
    return Math.min(turnCount * 20, 100);
  }

  isTaskComplete(toolCalls) {
    return toolCalls.some(call => 
      call.name === 'write_file' && 
      call.status === 'completed'
    );
  }

  getFatalErrorPatterns() {
    return [/ERROR|FAILED/i];
  }

  getWorkflowSteps() {
    return [
      { name: 'read_file', weight: 50, isRequired: true },
      { name: 'write_file', weight: 100, isRequired: true }
    ];
  }

  processToolResult(toolCall, result) {
    return { shouldContinue: true };
  }

  isValidToolCall(toolName, args) {
    return ['read_file', 'write_file'].includes(toolName);
  }
}

// Create TaskEngine instance
const engine = new TaskEngine({
  strategy: new SimpleTaskStrategy(),
  onStatusUpdate: (status) => {
    console.log(`Progress: ${status.progress.percentage}%`);
  }
});

// Execute a task
const result = await engine.executeTask({
  sessionId: 'simple-task-123',
  description: 'Create a hello world text file',
  mcpServerUrl: 'http://localhost:3000/sse',
  taskType: 'file-operation'
});

console.log('Task completed:', result.success);
```

### Example Implementation

For a complete working example, refer to `test-simple.js` which demonstrates how to create custom task and prompt strategies, handle status updates, and implement complex workflows.

