/**
 * Test script for improved error formatting in AppSynth
 */

// Import the formatPlainStatus function from test-appsynth.js
import fs from 'fs';

// Mock status objects to test error formatting
const testStatus1 = {
  progress: { currentTurn: 6, percentage: 37.69230769230769 },
  sessionState: 'error',
  finalResult: {
    success: false,
    summary: 'Task failed due to token limit exceeded',
    error: `Turn 6 started (37.69230769230769%)
Attempt 1 failed with 5xx error. Retrying with backoff... GaxiosError: [{
  "error": {
    "code": 400,
    "message": "The input token count (1489564) exceeds the maximum number of tokens allowed (1048576).",
    "errors": [
      {
        "message": "The input token count (1489564) exceeds the maximum number of tokens allowed (1048576).",
        "domain": "global",
        "reason": "badRequest"
      }
    ],
    "status": "INVALID_ARGUMENT"
  }
}
]
    at Gaxios._request (/Users/ihainan/Projects/AIZGC/Workspace/task-engine/node_modules/gaxios/build/src/gaxios.js:142:23)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)`
  },
  toolCalls: [
    { name: 'analyze_binary', status: 'completed' },
    { name: 'generate_feature_spec', status: 'error', error: 'Token limit exceeded' }
  ]
};

const testStatus2 = {
  progress: { currentTurn: 3, percentage: 15.5 },
  sessionState: 'error',
  finalResult: {
    success: false,
    summary: 'MCP connection failed',
    error: 'ConnectionError: Failed to connect to MCP server at http://127.0.0.1:28080/sse\n    at MCPClient.connect (file:///path/to/client.js:45:12)'
  },
  toolCalls: [
    { name: 'import_binary', status: 'error', error: 'Connection refused' }
  ]
};

// Test function to simulate the error formatting
function testErrorFormatting() {
  console.log('🧪 Testing improved error formatting\n');
  
  console.log('=== Test 1: Token Limit Error ===');
  simulateStatusUpdate(testStatus1);
  
  console.log('\n=== Test 2: Connection Error ===');
  simulateStatusUpdate(testStatus2);
  
  console.log('\n✅ Error formatting tests completed');
}

function simulateStatusUpdate(status) {
  // Simulate the error handling part of formatPlainStatus
  if (status.sessionState === 'error' && status.finalResult) {
    console.log(`\n✕ Task failed at Turn ${status.progress.currentTurn}`);
    
    if (status.finalResult.error) {
      const error = status.finalResult.error;
      
      // Parse structured errors like Gemini CLI
      try {
        // Look for JSON error structure
        let jsonStr = null;
        let jsonStart = error.indexOf('[{');
        
        if (jsonStart !== -1) {
          // Handle array format like [{...}]
          let depth = 0;
          let jsonEnd = jsonStart;
          for (let i = jsonStart; i < error.length; i++) {
            if (error[i] === '[' || error[i] === '{') depth++;
            if (error[i] === ']' || error[i] === '}') depth--;
            if (depth === 0) {
              jsonEnd = i + 1;
              break;
            }
          }
          jsonStr = error.substring(jsonStart, jsonEnd);
        } else {
          // Look for single object format like {...}
          jsonStart = error.indexOf('{"error"');
          if (jsonStart !== -1) {
            let depth = 0;
            let jsonEnd = jsonStart;
            for (let i = jsonStart; i < error.length; i++) {
              if (error[i] === '{') depth++;
              if (error[i] === '}') depth--;
              if (depth === 0) {
                jsonEnd = i + 1;
                break;
              }
            }
            jsonStr = error.substring(jsonStart, jsonEnd);
          }
        }
        
        if (jsonStr) {
          const errorObj = JSON.parse(jsonStr);
          
          // Handle array format
          if (Array.isArray(errorObj) && errorObj[0]?.error) {
            const apiError = errorObj[0].error;
            console.log(`✕ [API Error: ${apiError.message}]`);
            if (apiError.status && apiError.status !== apiError.message) {
              console.log(`   Status: ${apiError.status}`);
            }
            if (apiError.code) {
              console.log(`   Code: ${apiError.code}`);
            }
          }
          // Handle direct object format
          else if (errorObj?.error) {
            const apiError = errorObj.error;
            console.log(`✕ [API Error: ${apiError.message}]`);
            if (apiError.status && apiError.status !== apiError.message) {
              console.log(`   Status: ${apiError.status}`);
            }
            if (apiError.code) {
              console.log(`   Code: ${apiError.code}`);
            }
          }
        } else {
          // Handle other structured errors
          const errorLines = error.split('\n').filter(line => line.trim());
          const mainError = errorLines.find(line => 
            line.includes('Error:') || 
            line.includes('Exception:') ||
            line.includes('token count') ||
            line.includes('exceeds')
          );
          
          if (mainError) {
            const cleanError = mainError
              .replace(/^.*?Error:\s*/, '')
              .replace(/^.*?Exception:\s*/, '')
              .trim();
            console.log(`✕ [${cleanError}]`);
          } else {
            console.log(`✕ [${errorLines[0] || error.substring(0, 100)}]`);
          }
        }
      } catch (parseError) {
        // Fallback: show first meaningful line
        const firstLine = error.split('\n')[0];
        console.log(`✕ [${firstLine}]`);
      }
    }
    
    if (status.finalResult.summary) {
      console.log(`   Summary: ${status.finalResult.summary}`);
    }
    
    // Show failed tools for context
    const failedTools = status.toolCalls.filter(call => call.status === 'error');
    if (failedTools.length > 0) {
      console.log(`   Failed tools: ${failedTools.map(t => t.name).join(', ')}`);
    }
  }
}

// Run the test
testErrorFormatting();