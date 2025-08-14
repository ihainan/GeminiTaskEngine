# TaskEngine

A wrapper around Gemini CLI that provides a generic task execution engine with strategy pattern support for executing complex automated tasks.

## Installation

```bash
npm install
npm run build
```

## Usage

The TaskEngine allows you to execute complex tasks by defining custom strategies and prompt builders. See the examples in the `examples/` directory for complete working examples.

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

## Examples

The TaskEngine includes several example implementations in the `examples/` directory:

### Available Examples

1. **examples/test-simple.js** - Basic binary analysis example
   - Demonstrates simple task and prompt strategies
   - Shows how to handle status updates and implement workflows
   - Uses Ghidra MCP for binary modification tasks

2. **examples/test-appsynth.js** - AppSynth implementation  
   - Advanced example for generating Electron desktop applications
   - Analyzes binary files using Ghidra MCP and creates functional apps
   - Includes complete workflow from binary analysis to app packaging
   - Targets Windows x64 platform with FasterCap binary example

### Running Examples

```bash
# Build the project first
npm run build

# Run the simple binary analysis example  
node examples/test-simple.js

# Run the AppSynth Electron app generation example
node examples/test-appsynth.js
```

### Example Implementation Details

Both examples demonstrate:
- Custom task strategies with workflow definitions
- Progress tracking and status updates  
- Error handling and fatal error patterns
- Integration with MCP (Model Context Protocol) servers
- Structured prompt building for complex tasks

