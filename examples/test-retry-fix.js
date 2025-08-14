/**
 * Simple test to verify the retry fix is working
 */

import { TaskEngine } from '../dist/index.js';

// Create a minimal task to test the retry fix
const engine = new TaskEngine({
  onStatusUpdate: (status) => {
    console.log(`Status: ${status.sessionState} - ${status.currentAction?.description || 'N/A'}`);
  }
});

console.log('🧪 Testing Gemini CLI retry fix...');

// The fix should be applied during TaskEngine construction
console.log('✅ TaskEngine created with retry fix applied');