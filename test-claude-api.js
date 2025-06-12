require('dotenv').config();
const axios = require('axios');
const tiktoken = require('tiktoken-node');

// Utility function to estimate token count
function estimateTokenCount(text) {
  try {
    const enc = tiktoken.getEncoding("cl100k_base");
    return enc.encode(text).length;
  } catch (error) {
    console.error("Error estimating token count:", error);
    return Math.ceil(text.length / 4);
  }
}

// Function to call Claude API
async function callClaudeAPI(messages, model = "claude-3-7-sonnet-20250219", maxTokens = 4000) {
  try {
    console.log(`Calling Claude API with model: ${model}`);
    
    // Extract system message
    const systemMessage = messages.find(msg => msg.role === "system");
    
    // Filter out system message from messages array
    const userMessages = messages.filter(msg => msg.role !== "system").map(msg => ({
      role: msg.role,
      content: [
        {
          type: "text",
          text: msg.content
        }
      ]
    }));
    
    console.log('System Message:', systemMessage?.content);
    console.log('User Messages:', userMessages);
    
    // Prepare API request
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: model,
        max_tokens: maxTokens,
        messages: userMessages,
        system: systemMessage?.content || "",
        temperature: 0.7,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('Error calling Claude API:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

async function testClaudeAPI() {
  try {
    const systemPrompt = "You are a helpful assistant that provides clear, informative answers.";
    const userPrompt = "Explain what a large language model is in simple terms.";
    
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
    
    // Estimate token count
    const promptText = systemPrompt + userPrompt;
    const estimatedTokens = estimateTokenCount(promptText);
    console.log(`Estimated token count for prompt: ${estimatedTokens}`);
    
    // Call the API
    const response = await callClaudeAPI(messages);
    
    console.log('\nResponse from Claude API:\n');
    console.log(response.content[0].text);
    
    // Estimate token count of the response
    const responseTokens = estimateTokenCount(response.content[0].text);
    console.log(`\nEstimated token count for response: ${responseTokens}`);
    console.log(`Total tokens used: ${estimatedTokens + responseTokens}`);
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
testClaudeAPI(); 