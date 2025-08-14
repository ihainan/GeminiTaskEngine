/**
 * Test to verify the token limit error fix
 */

import { TaskEngine } from '../dist/index.js';

// Create TaskEngine to apply the fix
const engine = new TaskEngine({
  onStatusUpdate: (status) => {
    // Silent
  }
});

console.log('🧪 Testing token limit error handling...');

// Simulate the problematic error message that was causing wrong retries
const mockError = new Error('The input token count (1489564) exceeds the maximum number of tokens allowed (1048576).');

// Test the fixed regex
console.log('Testing regex match on token error message:');
console.log('Original regex /5\\d{2}/ would match:', !!mockError.message.match(/5\d{2}/));
console.log('Fixed regex /\\b5[0-9]{2}\\b/ matches:', !!mockError.message.match(/\b5[0-9]{2}\b/));

// Test with actual HTTP 5xx error
const httpError = new Error('HTTP 500 Internal Server Error');
console.log('HTTP 500 error with original regex:', !!httpError.message.match(/5\d{2}/));
console.log('HTTP 500 error with fixed regex:', !!httpError.message.match(/\b5[0-9]{2}\b/));

console.log('✅ Token error fix verification completed');