/**
 * Process a chat with the LLM
 * @param {string} dialogueId - The unique dialogue ID
 * @param {Array} conversationHistory - The conversation history
 * @param {Object} personality - The personality configuration
 * @param {Function} onTextChunk - Callback for text chunks
 */
async function processChatWithLLM(dialogueId, conversationHistory, personality, onTextChunk) {
  console.log('Generating streaming response with', personality.llm);
  console.log('Conversation history length:', conversationHistory.length);
  
  // Print the dialogueId for debugging
  console.log('Making API request to', personality.llm, 'with dialogue ID:', dialogueId);
  
  try {
    // ... existing code ...
    
    // Call the appropriate AI model
    if (personality.llm === 'grok') {
      await streamGrokResponse(dialogueId, conversationHistory, onTextChunk);
    } else {
      // ... existing code ...
    }
    
    // ... existing code ...
  } catch (error) {
    console.error('LLM API error:', error);
    throw error;
  }
}

// Update the prompt for Grok-2 generator to avoid markdown characters
async function generateGrokResponse(conversationHistory, dialogueId) {
    try {
        // Format conversation history
        const formattedConversation = formatConversationForGrok(conversationHistory);
        
        // Custom system prompt for general contractor customer service with instructions to avoid markdown
        const systemPrompt = `You are providing customer service for a general contractor's business, primarily coordinating when people will show up where. Be helpful, professional, and provide clear information about scheduling, services, and availability. Answer questions concisely and accurately.

IMPORTANT: Do not use any markdown formatting, asterisks (*), underscores (_), hashtags (#), backticks (\`), or any special characters in your responses as they will be spoken aloud by text-to-speech. Use plain text only. Do not use bullet points, numbered lists, or any special formatting. Just write natural, conversational text that will sound good when read aloud.`;
        
        // Rest of the function implementation...
    } catch (error) {
        console.error('Grok-2 generation error:', error);
        throw error;
    }
} 