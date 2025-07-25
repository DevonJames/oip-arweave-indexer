const axios = require('axios');
const { use } = require('../routes/user');
// const e = require('express');
const textToSpeech = require('@google-cloud/text-to-speech');
const ffmpeg = require('fluent-ffmpeg');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const {getCurrentBlockHeight, getBlockHeightFromTxId, lazyFunding, upfrontFunding, arweave} = require('../helpers/arweave');
const FormData = require('form-data');
const { Readable } = require('stream');
const { setTimeout } = require('timers/promises');
const multer = require('multer');
const http = require('http');
const https = require('https');


const client = new textToSpeech.TextToSpeechClient({
  keyFilename: 'config/google-service-account-key.json',
  projectId: 'gentle-shell-442906-t7',
});

function generateAudioFileName(text, extension = 'wav') {
  return crypto.createHash('sha256').update(text).digest('hex') + '.' + extension;
}

async function getVoiceModels(req, res) {
  // router.post('/listVoiceModels', async (req, res) => {
      console.log('Fetching available voice models');
      
      const { useSelfHosted } = req.body;
  
      try {
          let response;
  
          if (useSelfHosted) {
              // Call the self-hosted Coqui TTS API to list models
              response = await axios.post('http://localhost:8082/listModels');
              // response = await axios.post('http://speech-synthesizer:8082/listModels');
              res.json(response.data);  // Assuming the response is a JSON list of models
          } else {
              // If using an external service, handle it here (if applicable)
              res.status(400).json({ error: "External model listing is not supported yet." });
          }
      } catch (error) {
          console.error(error);
          res.status(500).send("Error listing voice models");
      }
  // });
}

async function identifyAuthorNameFromContent(content) {
  console.log('Identifying the author name from the content...');
  
  const messages = [
    {
      role: "system",
      content: `You are a helpful assistant tasked with identifying the author's name from the provided content. Focus on finding the name of the author or writer of the article. It is highly unlikely that the subject of the article is its author, it will probably be just beneath the headine, often labeled "by" or "written by" or "authored by". Respond with JSON containing the author's name and using the key "name".`
    },
    {
      role: "user",
      content: `find author name in this article: ${content}`
    }
  ];
//   messages = [
//     {
//         "role": "user",
//         "content": [
//             {
//                 "type": "image_url",
//                 "image_url": {
//                     "url": content,
//                     "detail": "high",
//                 },
//             },
//             {
//                 "type": "text",
//                 "text": "What's in this image?",
//             },
//         ],
//     },
// ]
  
  try {
      const response = await axios.post('https://api.x.ai/v1/chat/completions', {
        model: 'grok-4',  // Updated to latest model instead of grok-beta
        messages: messages,
        stream: false,
        temperature: 0
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 120000
      });
      
      console.log('x AI response to authorName search:', response.data.choices[0].message.content);
      
      if (response.data && response.data.choices && response.data.choices[0]) {
          // Original content from the response
          const rawcontent = response.data.choices[0].message.content;
          
          // Clean up JSON formatting
          const rawjson = rawcontent.replace(/```json|```/g, '');

          try {
              // Parse the JSON string
              const parsedContent = JSON.parse(rawjson.trim());

              // Extract the "name" value
              const authorName = parsedContent.name;

              console.log('xAI found this Author Name:', authorName);
              return authorName;
          } catch (jsonError) {
              console.error('Error parsing JSON from response:', jsonError);
              // Fallback: try to extract name directly if JSON parsing fails
              const nameMatch = rawcontent.match(/"name"\s*:\s*"([^"]+)"/);
              if (nameMatch && nameMatch[1]) {
                  console.log('Extracted author name directly:', nameMatch[1]);
                  return nameMatch[1];
              }
              return '';
          }
      } else {
          console.error('Unexpected response structure:', response);
          return '';
      }
  }
  catch (error) {
    console.error('Error identifying author name:', error.response ? error.response.data : error.message);
    return '';
  }
}

async function identifyPublishDateFromContent(content) {
  console.log('Identifying the publish date from the content...');
  
  const messages = [
    {
      role: "system",
      content: `You are a helpful assistant tasked with identifying the publish date from the provided content. Focus on finding the date when the article was published. Respond with JSON containing the publish date and using the key "date".`
    },
    {
      role: "user",
      content: content
    }
  ];
  
  try {
      const response = await axios.post('https://api.x.ai/v1/chat/completions', {
        model: 'grok-4',  // Updated to latest model instead of grok-beta
        messages: messages,
        stream: false,  // Based on the curl data
        temperature: 0  // Same temperature setting as in the curl command
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.XAI_API_KEY}`,  // Set your bearer token here
          'Content-Type': 'application/json',
        },
        timeout: 120000 // Optional: 120 seconds timeout
      });
      
      console.log('x AI response to publishDate search:', response.data.choices[0].message.content);
      if (response.data && response.data.choices && response.data.choices[0]) {
          // let publishDate = response.data.choices[0].message.content;
          // Original content from the response
          const rawcontent = response.data.choices[0].message.content;
          const rawjson = rawcontent.replace(/```json|```/g, '');

          // Parse the JSON string
          const parsedContent = JSON.parse(rawjson.trim());

          // Extract the "date" value
          let publishDate = parsedContent.date;

          console.log('xAI found this Publish Date:', publishDate);
          // Check if publishDate is in the correct format (YYYY-MM-DD)
          const datePattern = /^\d{4}-\d{2}-\d{2}$/;
          if (datePattern.test(publishDate)) {
              // Convert to unix timestamp
              const date = new Date(publishDate);
              const unixTimestamp = date.getTime() / 1000;
              console.log('Publish Date in Unix Timestamp:', unixTimestamp);
              publishDate = unixTimestamp;
          } else {
              // Check for other common date formats
              const alternativeDatePatterns = [
                  /^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY
                  /^\d{4}\/\d{2}\/\d{2}$/  // YYYY/MM/DD
              ];

              let dateParsed = false;
              for (const pattern of alternativeDatePatterns) {
                  if (pattern.test(publishDate)) {
                      const date = new Date(publishDate);
                      const unixTimestamp = date.getTime() / 1000;
                      console.log('Publish Date in Unix Timestamp:', unixTimestamp);
                      publishDate = unixTimestamp;
                      dateParsed = true;
                  }
              }

              // Additional check for format "MMM. DD" (e.g., "Oct. 30")
              if (!dateParsed) {
                  const monthDayPattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.? (\d{1,2})$/i;
                  const match = publishDate.match(monthDayPattern);

                  if (match) {
                      const month = match[1];
                      const day = match[2];
                      const currentYear = new Date().getFullYear();

                      // Create a full date string with the current year
                      const dateStr = `${currentYear} ${month} ${day}`;
                      const date = new Date(dateStr);
                      const unixTimestamp = date.getTime() / 1000;
                      console.log('Publish Date in Unix Timestamp:', unixTimestamp);
                      publishDate = unixTimestamp;
                      dateParsed = true;
                  }
              }

              if (!dateParsed) {
                  console.log('Publish Date is not in the correct format:', publishDate);
                  // return todays date at 8 am EST in unixtimestamp
                  const date = new Date();
                  date.setUTCHours(12, 0, 0, 0);
                  publishDate = date.getTime() / 1000;

                  console.log('Defaulting to today\'s date at 8 am EST:', publishDate);

              }
          }

      return publishDate;
     
    } else {
      console.error('Unexpected response structure:', response);
      return '';
    }
  }
  catch (error) {
    console.error('Error identifying publish date:', error.response ? error.response.data : error.message);
    return '';
  }
}

/**
 * Call OpenAI API as a backup when xAI fails
 * @param {Object} params - API call parameters 
 * @returns {Promise<Object>} - API response
 */
async function callOpenAiBackup(params) {
  const { 
    messages,
    max_tokens = 500
  } = params;
  
  console.log('Attempting OpenAI backup call...');
  
  // Convert message roles for OpenAI's updated API
  const convertedMessages = messages.map(msg => {
    // Convert "system" role to "developer" 
    if (msg.role === "system") {
      return {
        ...msg,
        role: "developer",
        content: msg.content + "If the article mentions Donald Trump, as of 2025, he is currently the President, do not not refer to him as Former President Trump, refer to him as President Trump."
      };
    }
    return msg;
  });
  
  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: convertedMessages,
      max_tokens: max_tokens,
      temperature: 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000
    });
    
    console.log('OpenAI backup call successful');
    return { data: response.data, status: response.status };
  } catch (error) {
    console.error('OpenAI backup call failed:', error.message);
    throw error;
  }
}

async function generateSummaryFromContent(title, content) {
  // Set the primary model to use - easier to change in one place
  const PRIMARY_MODEL = 'openai'; // Options: 'openai' or 'xai'
  
  console.log('Inside generateSummaryFromContent with title:', title, 'content length:', content.length);
  
  // Truncate content if it's too long
  let processedContent = content;
  if (content.length > 4000) {
    console.log(`Content too long (${content.length} chars), truncating to 4000 chars`);
    processedContent = content.substring(0, 4000) + "... [content truncated]";
  }
  
  const messages = [
    {
      role: "system",
      content: "You are a 160 IQ geopolitics and trivia genius tasked with generating a summary and tags from the provided article content and title. use the labels SUMMARY and TAGS to delineate them in your response. For the SUMMARY, tell a story with a focus on identifying the main points, key information, and overall message of the article - keep it lighthearted and engaging, and don't start with things like 'In this article...' and 'The article discusses...', just jump right in, we all know why we're here. You do not ever abuse cliches and trite phrases like 'In a twist of...'.  Please provide the TAGS in a comma-separated format, with primary topics first, followed by any secondary or related subjects."
    },
    {
      role: "user",
      content: `Here is the title and content of the article in question: | title: ${title} | content: ${processedContent}`
    }
  ];

  // Try methods in sequence until one succeeds
  let allErrors = [];

  if (PRIMARY_MODEL === 'openai') {
    // Try OpenAI first
    try {
      console.log("Using OpenAI as primary model...");
      
      // Create OpenAI-compatible messages
      const openAiMessages = messages.map(msg => {
        // Convert "system" role to "developer" 
        if (msg.role === "system") {
          return {
            ...msg,
            role: "developer"
          };
        }
        return msg;
      });
      
      const openAiResponse = await callOpenAiBackup({
        messages: openAiMessages,
        max_tokens: 400
      });
      
      if (openAiResponse.data?.choices?.[0]?.message?.content) {
        let responseText = openAiResponse.data.choices[0].message.content;
        console.log("OpenAI response received:", responseText);
        
        // Parse the response
        const parsedOpenAi = {
          summary: "",
          tags: ""
        };
        
        if (responseText.includes("**SUMMARY:**") && responseText.includes("**TAGS:**")) {
          const summaryStart = responseText.indexOf("**SUMMARY:**");
          const tagsStart = responseText.indexOf("**TAGS:**");
          
          parsedOpenAi.summary = responseText.slice(summaryStart + 12, tagsStart).trim();
          parsedOpenAi.tags = responseText.slice(tagsStart + 9).trim();
        } else if (responseText.includes("SUMMARY:") && responseText.includes("TAGS:")) {
          const summaryStart = responseText.indexOf("SUMMARY:");
          const tagsStart = responseText.indexOf("TAGS:");
          
          parsedOpenAi.summary = responseText.slice(summaryStart + 8, tagsStart).trim();
          parsedOpenAi.tags = responseText.slice(tagsStart + 5).trim();
        } else {
          // Fallback to simpler parsing
          const lines = responseText.split("\n");
          let foundSummary = false;
          
          for (const line of lines) {
            if (line.toLowerCase().includes("summary")) {
              foundSummary = true;
              continue;
            }
            
            if (line.toLowerCase().includes("tags")) {
              foundSummary = false;
              continue;
            }
            
            if (foundSummary) {
              parsedOpenAi.summary += line + " ";
            } else if (line.includes(",")) {
              parsedOpenAi.tags = line;
            }
          }
          
          // If parsing failed, just use the whole text as summary
          if (!parsedOpenAi.summary) {
            parsedOpenAi.summary = responseText.substring(0, 300);
            parsedOpenAi.tags = "article, news";
          }
        }
        
        return parsedOpenAi;
      } else {
        throw new Error('Invalid response from OpenAI');
      }
    } catch (openAiError) {
      console.log("OpenAI attempt failed:", openAiError);
      allErrors.push(`OpenAI primary call: ${openAiError.message}`);
      
      // Fall back to xAI
      return tryXaiGeneration(title, processedContent, messages, allErrors);
    }
  } else {
    // Primary model is xAI, try it first
    return tryXaiGeneration(title, processedContent, messages, allErrors);
  }
}

// Helper function to try xAI generation
async function tryXaiGeneration(title, processedContent, messages, allErrors) {
  try {
    console.log("Attempting direct HTTPS call to xAI API with 6.5s timeout...");
    
    // Set a shorter timeout for xAI
    const xaiPromise = directXaiCall({
      model: 'grok-4',
      messages: messages,
      max_tokens: 500
    });
    
    // Add a timeout race to quickly fail if xAI is slow
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("xAI timeout - moving to OpenAI")), 6500)
    );
    
    // Race the xAI call against our shorter timeout
    const response = await Promise.race([xaiPromise, timeoutPromise]);
    
    if (response.data && response.data.choices && response.data.choices[0]) {
      console.log('xAI response received successfully');
      let fullResponseText = response.data.choices[0].message.content;
      
      // Normalize fullResponseText by removing extra line breaks and carriage returns
      fullResponseText = fullResponseText.replace(/\r/g, '').replace(/\n+/g, '\n');
          
      // Log the normalized response text for inspection
      console.log('Normalized xAI response text:', fullResponseText);
  
      const parsedResponse = {
        summary: '',
        tags: ''
      };
          
      // Manually locate positions of SUMMARY and TAGS sections
      const summaryStart = fullResponseText.indexOf("**SUMMARY:**");
      const tagsStart = fullResponseText.indexOf("**TAGS:**");

      if (summaryStart !== -1 && tagsStart !== -1) {
        // Extract content by slicing between markers
        parsedResponse.summary = fullResponseText.slice(summaryStart + 12, tagsStart).trim(); // 12 for "**SUMMARY:**"
        parsedResponse.tags = fullResponseText.slice(tagsStart + 9).trim(); // 9 for "**TAGS:**"
      } else {
        console.error("Unable to locate **SUMMARY:** or **TAGS:** markers.");
      }

      // Final parsed results after assignment
      console.log('Final parsed response - summary:', parsedResponse.summary);
      console.log('Final parsed response - tags:', parsedResponse.tags);
      return parsedResponse;
    } else {
      console.error('Unexpected response structure:', response);
      throw new Error('Unexpected response structure from xAI');
    }
  } catch (error) {
    console.log('Error with xAI API call:', error);
    allErrors.push(`xAI call: ${error.message}`);
    
    // Try OpenAI as fallback only if we started with xAI
    try {
      console.log("Trying OpenAI as fallback...");
      
      // Create OpenAI-compatible messages
      const openAiMessages = messages.map(msg => {
        // Convert "system" role to "developer" 
        if (msg.role === "system") {
          return {
            ...msg,
            role: "developer"
          };
        }
        return msg;
      });
      
      // Create OpenAI-compatible messages
      const openAiMessagesForBackup = openAiMessages.map(msg => {
        // Convert "system" role to "developer" 
        if (msg.role === "system") {
          return {
            ...msg,
            role: "developer"
          };
        }
        return msg;
      });
      
      const openAiResponse = await callOpenAiBackup({
        messages: openAiMessagesForBackup,
        max_tokens: 400
      });
      
      if (openAiResponse.data?.choices?.[0]?.message?.content) {
        let openAiText = openAiResponse.data.choices[0].message.content;
        console.log("OpenAI backup response received:", openAiText);
        
        // Parse the OpenAI response
        const parsedOpenAi = {
          summary: "",
          tags: ""
        };
        
        if (openAiText.includes("**SUMMARY:**") && openAiText.includes("**TAGS:**")) {
          const summaryStart = openAiText.indexOf("**SUMMARY:**");
          const tagsStart = openAiText.indexOf("**TAGS:**");
          
          parsedOpenAi.summary = openAiText.slice(summaryStart + 12, tagsStart).trim();
          parsedOpenAi.tags = openAiText.slice(tagsStart + 9).trim();
        } else {
          // Attempt alternative parsing if standard format isn't found
          const lines = openAiText.split("\n").filter(line => line.trim() !== "");
          const summaryLines = [];
          let tagsLine = "";
          
          let foundTags = false;
          for (const line of lines) {
            if (line.toLowerCase().includes("tags:") || foundTags) {
              foundTags = true;
              tagsLine = line.replace(/tags:/i, "").trim();
            } else {
              summaryLines.push(line);
            }
          }
          
          parsedOpenAi.summary = summaryLines.join(" ");
          parsedOpenAi.tags = tagsLine || "article, news";
        }
        
        return parsedOpenAi;
      } else {
        throw new Error('Invalid response from OpenAI');
      }
    } catch (openAiError) {
      console.log("OpenAI backup also failed:", openAiError);
      allErrors.push(`OpenAI backup call: ${openAiError.message}`);
    }
  }
  
  // Ultimate fallback - return something rather than nothing
  console.error("ALL API CALLS FAILED. Errors:", allErrors);
  return {
    summary: `Article about ${title}`,
    tags: "article, news"
  };
}

async function analyzeImageForRecipe(screenshotURL) {
  console.log('Analyzing image for recipe info using XAI API...');

  const messages = [
      {
          role: "system",
          content: "You are an AI tasked with identifying recipe info in a screenshot. Analyze the screenshot, identify the recipes name, prep time, cook time, total time and servings or yeild, as well as its ingredients and its instructions, and if possible also identify its source url, and return all of this info in JSON format."
      },
      {
          role: "user",
          content: [
              {
                  type: "image_url",
                  image_url: {
                      url: screenshotURL,
                      detail: "high"
                  }
              },
              {
                  type: "text",
                  text: "Please extract the recipe information from this screenshot and return it in JSON format."
              }
          ]
      }
  ];

  try {
      const response = await axios.post('https://api.x.ai/v1/chat/completions', {
          model: 'grok-2-vision-latest',
          messages: messages,
          stream: false,
          temperature: 0
      }, {
          headers: {
              'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
              'Content-Type': 'application/json',
          },
          timeout: 30000 // Increased to 30 seconds
      });

      if (response.data && response.data.choices && response.data.choices[0]) {
        const extractedRecipe = response.data.choices[0].message.content.trim();
        console.log('Extracted response:', extractedRecipe);
        return extractedRecipe;
      } else {
          console.error('Unexpected response structure:', response);
          return null;
      }
  } catch (error) {
      console.error('Error analyzing image for recipe:', error);
      if (error.response) {
          console.error('Response status:', error.response.status);
          console.error('Response data:', error.response.data);
      } else if (error.request) {
          console.error('No response received - likely a timeout');
      }
      return null;
  }
}

async function analyzeImageForAuthor(imageUrl) {
  console.log('Analyzing image for author name...');
  
  const messages = [
    {
      role: "system",
      content: "You are an AI tasked with extracting the author name from an article's screenshot. Analyze the screenshot, identify the section where the author (byline) is mentioned, and return the extracted author name in JSON format with the key 'name'."
    },
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: {
            url: imageUrl,
            detail: "high"
          }
        },
        {
          type: "text",
          text: "Please find the author's name in this article screenshot and return it in JSON format with the key 'name'."
        }
      ]
    }
  ];

  try { 
    // Try xAI first
    try {
      const response = await axios.post('https://api.x.ai/v1/chat/completions', {
        model: 'grok-2-vision-latest',
        messages: messages,
        stream: false,
        temperature: 0
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000 // Increased to 30 seconds
      });
      console.log('xAI response:', response.data);
      
      if (response.data && response.data.choices && response.data.choices[0]) {
        const extractedAuthor = response.data.choices[0].message.content.trim();
        console.log('Extracted author name:', extractedAuthor);
        
        // Try parsing as JSON
        try {
          const jsonData = JSON.parse(extractedAuthor);
          return jsonData.name || '';
        } catch (jsonError) {
          // If not valid JSON, try regex extraction
          const nameMatch = extractedAuthor.match(/"name"\s*:\s*"([^"]+)"/);
          if (nameMatch && nameMatch[1]) {
            return nameMatch[1];
          }
          return extractedAuthor; // Return raw text as last resort
        }
      }
      return '';
    } catch (xAiError) {
      console.error('xAI vision API error:', xAiError.message);
      
      // Fall back to OpenAI Vision API
      console.log('Falling back to OpenAI Vision API...');
      try {
        const openAiResponse = await callOpenAiVision({
          imageUrl: imageUrl,
          prompt: "Extract the author's name from this article screenshot. Return ONLY a JSON object with the format: {\"name\": \"Author Name\"}. If no author is found, use {\"name\": \"\"}."
        });
        
        if (openAiResponse.data?.choices?.[0]?.message?.content) {
          const result = openAiResponse.data.choices[0].message.content;
          console.log('OpenAI Vision result:', result);
          
          try {
            const jsonData = JSON.parse(result);
            return jsonData.name || '';
          } catch (jsonError) {
            console.error('Error parsing OpenAI JSON response:', jsonError);
            return '';
          }
        }
      } catch (openAiError) {
        console.error('OpenAI Vision API fallback also failed:', openAiError.message);
      }
    }
    
    return ''; // Default fallback
  } catch (error) {
    console.error('Error analyzing image for author:', error.message);
    return '';
  }
}

async function generateTagsFromContent(title, content) {
  console.log('Generating tags from the title and content...');
  
  const messages = [
    {
      role: "system",
      content: `You are a helpful assistant tasked with generating relevant tags based on article content and title. Focus on identifying the primary subject, relevant topics, and keywords that best represent the article.`
    },
    {
      role: "user",
      content: `Analyze the following content and title. Generate relevant tags for categorizing and understanding the main subjects covered.

      Title: ${title}
      Content: ${content}

      Provide the tags in a comma-separated format, with primary topics first, followed by any secondary or related subjects, but keep it to a reasonable number of tags.`
    }
  ];

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: messages,
      max_tokens: 2000,  // Adjust token limit if needed
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000 // 120 seconds
    });

    if (response.data && response.data.choices && response.data.choices[0]) {
      const responseText = response.data.choices[0].message.content;
      // console.log('GPT response:', responseText);
      // const tagsMatch = responseText.match(/Tags:\n(.*)/);
      // const generatedTags = tagsMatch ? tagsMatch[1].split(',').map(tag => tag.trim()) : [];
      const generatedTags = responseText.split(',').map(tag => tag.trim());

      console.log('Generated tags:', generatedTags);
      return generatedTags;
    } else {
      console.error('Unexpected response structure:', response);
      return [];
    }
  } catch (error) {
    console.error('Error generating tags:', error.response ? error.response.data : error.message);
    return [];
  }
}

function replaceAcronyms(text) {
console.log('Replacing acronyms and common abbreviations in the text...', text);

// Define a map of common abbreviations and their replacements
const abbreviationsMap = {
  'Jr': 'Junior',
  'Sr': 'Senior',
  'Dr': 'Doctor',
  'Dr.': 'Doctor',
  'Mr': 'Mister',
  'Mr.': 'Mister',
  'Mrs': 'Mistress',
  'Mrs.': 'Mistress',
  'Ms': 'Miss',
  'Ms.': 'Miss',
  'Prof': 'Professor',
  'St': 'Saint',
  'St.': 'Street',
  'Ave': 'Avenue',
  'Blvd': 'Boulevard',
  'Rd': 'Road',
  'Ln': 'Lane',
  'Mt': 'Mount',
  'Ft': 'Fort',
  'Dept': 'Department',
  'Univ': 'University',
  'Inc': 'Incorporated',
  'Ltd': 'Limited',
  'Co': 'Company',
  'Co.': 'Company',
};

// Replace acronyms
text = text.replace(/\b([A-Z]{2,})\b/g, (match) => match.split('').join('-'));

// Replace common abbreviations
for (const [abbr, full] of Object.entries(abbreviationsMap)) {
  const regex = new RegExp(`\\b${abbr}\\b`, 'g');
  text = text.replace(regex, full);
}

return text;

}

async function generateCombinedSummaryFromArticles(articles, model, useSelfHosted) {
  console.log('Generating summary from the title and content...');
  
  // get todays date and time
  const currentDate = new Date();
  const currentDateString = currentDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD


  // Initialize combined content and URLs
  let combinedContent = '';
  let combinedUrls = '';

  // Loop through each article and append title, content, and URL to the combined variables
  articles.forEach((article) => {
      combinedContent += `Date: ${article.date}\nTitle: ${article.title}\nContent: ${article.content}\n\n`;
      combinedUrls += `${article.url}\n`;
  });

  const messages = [
    {
      role: "system",
      content: `You are a smooth talking podcaster tasked with writing a 10 minute podcast script that explores each of the selected articles in some amount of depth, and then summarizes what overlap and relationships between them. Take the dates of each articles into account, as well as today's date ${currentDateString}, as you consider your story and the context of each article. Focus on synthesizing common themes and important points and look for connections between the articles.`
  },
    {
      role: "user",
      content: `Analyze the following dates, titles and articles and generate an entertaining 10 minute podcast script that combines the essence of all of them. DO NOT include preparatory statements like "summary" or "these articles are about". Here are the articles: ${combinedContent}`
    }];

    try {
      const response = await axios.post('https://api.x.ai/v1/chat/completions', {
        model: 'grok-4',  // Updated to latest model instead of grok-beta
        messages: messages,
        stream: false,  // Based on the curl data
        temperature: 0  // Same temperature setting as in the curl command
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.XAI_API_KEY}`,  // Set your bearer token here
          'Content-Type': 'application/json',
        },
        timeout: 120000 // Optional: 120 seconds timeout
      });
      
      
      if (response.data && response.data.choices && response.data.choices[0]) {
          let fullResponseText = response.data.choices[0].message.content;
          console.log('x AI fullResponseText:', fullResponseText);
          
          // Normalize fullResponseText by removing extra line breaks and carriage returns
          fullResponseText = fullResponseText.replace(/\r/g, '').replace(/\n+/g, '\n');
              
          // Log the normalized response text for inspection
          console.log('Normalized xAI response text:', fullResponseText);
      
          // Final parsed results after assignment
          console.log('Combined URLs:', combinedUrls.trim());
          // Ensure combinedUrls is a string
          // combinedUrls = combinedUrls.trim();
          return {
              summary: fullResponseText,
              urls: combinedUrls.trim()
          };
  
    } else {
      console.error('Unexpected response structure:', response);
      return '';
    }
  }
  catch (error) {
    console.error('Error generating summary:', error.response ? error.response.data : error.message);
    return '';
  }
}

async function generateDateFromRelativeTime(relativeTime) {
const currentDate = new Date(); // Get the current date and time
const currentDateString = currentDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD

const messages = [
    {
    role: "system",
    content: `You are a helpful assistant tasked with converting relative time expressions to absolute dates. Given a relative time expression and a reference date, calculate the absolute date and output it in the exact format: "publishDate: YYYY-MM-DD HH:MM:SS". Do not include any additional text or explanations.`
    },
    {
    role: "user",
    content: `Reference Date: ${currentDateString}\nRelative Time: "${relativeTime}"\n\nPlease provide the absolute date in the format: publishDate: YYYY-MM-DD HH:MM:SS`
    }
];

try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-3.5-turbo',
    messages: messages,
    max_tokens: 50,
    temperature: 0, // Set temperature to 0 for deterministic output
    }, {
    headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
    },
    timeout: 120000 // 120 seconds
    });
    
    if (response.data && response.data.choices && response.data.choices[0]) {
    const responseText = response.data.choices[0].message.content.trim();
    console.log('GPT response:', responseText);

    // Use a regex to extract the date in the desired format
    const match = responseText.match(/publishDate:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    if (match && match[1]) {
        return match[1];
    } else {
        console.error('Date not found in GPT response.');
        return '';
    }
    } else {
    console.error('Unexpected response structure:', response);
    return '';
    }
} catch(error) {
    console.error('Error generating date:', error.response ? error.response.data : error.message);
    return '';
}
}

// Generic retry function
async function retryAsync(asyncFunction, args = [], options = { maxRetries: 5, delay: 3000, fallbackValue: null }) {
    const { maxRetries, delay, fallbackValue } = options;
    let attempts = 0;

    while (attempts < maxRetries) {
      // console.log('retrying times:', attempts);
        try {
          console.log(`Attempting ${asyncFunction.name}, attempt ${attempts + 1} with args:`, args);
            // Attempt to execute the provided async function with the arguments
            const result = await asyncFunction(...args);
            // If we get a valid result, return it
            if (result !== undefined) {
              console.log(`${asyncFunction.name} succeeded on attempt ${attempts + 1}`);
              return result;
            }
            // return result; // Return the result if successful
        } catch (error) {
            // Log the error
            console.error(`Error in ${asyncFunction.name}:`, error.response ? error.response.data : error.message);
        }

        attempts++;
        console.warn(`Retrying ${asyncFunction.name} (${attempts}/${maxRetries})...`);

        // If max retries are reached, return the fallback value
        if (attempts >= maxRetries) {
            console.error(`Max retries reached for ${asyncFunction.name}. Returning fallback value.`);
            return fallbackValue;
        }

        // Wait for the specified delay before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    // Return fallback if all retries fail or if we never received a valid result
    return fallbackValue;
}

async function synthesizeSpeech(text, voiceConfig, outputFileName, api = 'elevenLabs') {
  console.log('synthesizing speech with:', voiceConfig, outputFileName, api);
  
  // Strip emojis from text before synthesis
  const cleanText = stripEmojisForTTS(text);
  
  if (api === 'google') {
          const output_format = 'MP3';
      const request = {
          input: { text: cleanText },
          voice: voiceConfig.google,
          audioConfig: { audioEncoding: output_format }
      };
      try {
          const [response] = await client.synthesizeSpeech(request);
          await fs.promises.writeFile(outputFileName, response.audioContent, 'binary');
          console.log(`Google TTS: Saved audio to ${outputFileName}`);
          return outputFileName;
      } catch (error) {
          console.error(`Google TTS error: ${error.message}`);
          throw error;
      }
  } else if (api === 'elevenLabs') {
    try {
      // Use a standard MP3 format that's more compatible with ffmpeg
      const output_format = 'mp3_44100_128'; 
          const response = await axios.post(
              `https://api.elevenlabs.io/v1/text-to-speech/${voiceConfig.elevenLabs.voice_id}`,
              {
                  text: cleanText,
                  model_id: voiceConfig.elevenLabs.model_id || 'eleven_monolingual_v1',
                  voice_settings: {
                    stability: voiceConfig.elevenLabs.stability || 0.75,
                    similarity_boost: voiceConfig.elevenLabs.similarity_boost || 0.75
                  },  
                  output_format: output_format
              },
              {
                  headers: {
                      'xi-api-key': process.env.ELEVENLABS_API_KEY,
                      'Content-Type': 'application/json'
                  },
                  responseType: 'arraybuffer'
              }
          );
          console.log('synthesized speech response:', response.data);
          
          // Fix path duplication issue by checking if outputFileName is already absolute
          let audioFilepath;
          if (path.isAbsolute(outputFileName)) {
              // If outputFileName is already absolute, use it directly
              audioFilepath = outputFileName;
              console.log(`Using absolute path: ${audioFilepath}`);
          } else {
              // If it's a relative path, join with the media directory
              const audioDirectory = path.resolve(__dirname, '../media');
              audioFilepath = path.resolve(audioDirectory, outputFileName);
              console.log(`Constructed path: ${audioFilepath}`);
          }
          
          // Create directory if it doesn't exist
          const fileDir = path.dirname(audioFilepath);
          if (!fs.existsSync(fileDir)) {
              console.log(`Creating directory: ${fileDir}`);
              await fs.promises.mkdir(fileDir, { recursive: true });
          }

          // Write the audio file and verify it was written successfully
          await fs.promises.writeFile(audioFilepath, response.data, 'binary');
          
          // Verify file was written successfully
          const stats = await fs.promises.stat(audioFilepath);
          console.log(`Written file size: ${stats.size} bytes`);
          
          // Return data with properly formatted paths
          const data = {
            format: output_format,
            url: `/api/generate/media?id=${outputFileName}`,
            outputFileName: audioFilepath  // Use the absolute path that was actually written
          }
          console.log('synthesized speech data:', data);
          return data;
      } catch (error) {
          console.error(`Eleven Labs error: ${error.message}`);
          if (error.response) {
              console.error(`Response status: ${error.response.status}`);
              console.error(`Response data: ${Buffer.from(error.response.data).toString('utf-8')}`);
          }
          throw error;
      }
  } else {
      throw new Error(`Unsupported API: ${api}`);
  }
}

/**
 * Transcribes audio using OpenAI's Whisper API
 * @param {Buffer} audioBuffer - The audio buffer to transcribe
 * @param {Object} options - Transcription options
 * @returns {Promise<string>} The transcribed text
 */
async function transcribeAudio(audioBuffer, options = {}) {
  console.log('Transcribing audio with Whisper API');
  
  const formData = new FormData();
  
  // Create a readable stream from the buffer and add it to form data
  const bufferStream = new Readable();
  bufferStream.push(audioBuffer);
  bufferStream.push(null);
  
  formData.append('file', bufferStream, {
    filename: 'audio.webm',
    contentType: 'audio/webm',
  });
  
  formData.append('model', options.model || 'whisper-1');
  
  if (options.language) {
    formData.append('language', options.language);
  }
  
  if (options.prompt) {
    formData.append('prompt', options.prompt);
  }
  
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          ...formData.getHeaders(),
        },
        timeout: 30000,
      }
    );
    
    return response.data.text;
  } catch (error) {
    console.error('Error in transcription:', error.response?.data || error.message);
    throw new Error(`Whisper API transcription failed: ${error.message}`);
  }
}

/**
 * Generates AI response using x.ai's Grok model with streaming
 * @param {Array} conversationHistory - Previous conversation history
 * @param {string} dialogueId - The unique dialogue ID as a string
 * @param {Object} options - Configuration options
 * @param {Function} onTextChunk - Optional callback for text chunks
 * @returns {Promise<Object>} Success result
 */
async function generateStreamingResponse(conversationHistory, dialogueId, options = {}, onTextChunk = null) {
    try {
        // Import required modules
        const socketManager = require('../socket/socketManager');
        
        // CRUCIAL FIX: Always convert dialogueId to string and validate
        dialogueId = String(dialogueId);
        
        if (typeof dialogueId !== 'string' || dialogueId.includes('function')) {
            console.error('ERROR: dialogueId must be a string, received:', typeof dialogueId);
            throw new Error('Invalid dialogueId parameter: must be a string');
        }
        
        console.log(`Generating streaming response with grok`);
        console.log(`Conversation history length: ${conversationHistory.length}`);
        
        // Format messages for xAI API
        let messages = Array.isArray(conversationHistory) ? 
            conversationHistory.map(msg => ({
                role: msg.role,
                content: msg.content
            })) : 
            [{ role: "user", content: "Hello, how can I help you today?" }];
            
        // Add system prompt if provided, or use a default one
        const systemPrompt = options.systemPrompt || "You are a helpful AI assistant. IMPORTANT: Do not use emojis, asterisks, or other special symbols in your responses as they interfere with text-to-speech synthesis. Keep your responses conversational and natural.";
        
        // Prepend system message to conversation
        messages.unshift({
            role: "system",
            content: systemPrompt
        });
        
        console.log(`Added system prompt, total messages: ${messages.length}`);
        
        // Make API request to xAI with streaming enabled
        const response = await axios({
            method: 'post',
            url: 'https://api.x.ai/v1/chat/completions',
            headers: {
                'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: {
                model: options.model || 'grok-4',
                messages: messages,
                stream: true,
                temperature: options.temperature || 0.7
            },
            responseType: 'stream'
        });
        
        // Track full response for logging
        let fullResponse = '';
        
        // Process the streaming response
        response.data.on('data', (chunk) => {
            const chunkStr = chunk.toString().trim();
            if (!chunkStr) return;
            
            // Handle SSE format
            const lines = chunkStr.split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.substring(6);
                    if (data === '[DONE]') continue;
                    
                    try {
                        // Skip empty data lines
                        if (!data.trim()) return;
                        
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content || '';
                        
                        if (content) {
                            // Add to full response
                            fullResponse += content;
                            
                            // Use the callback if provided
                            if (typeof onTextChunk === 'function') {
                                onTextChunk(content);
                            } else {
                                // Send to client through socket
                                socketManager.sendToClients(dialogueId, {
                                    role: 'assistant',
                                    text: content
                                });
                            }
                        }
                    } catch (e) {
                        // Only log JSON parsing errors if the data isn't empty
                        if (data.trim()) {
                            console.error('Error parsing stream data:', e);
                            console.error('Problematic data chunk:', data.substring(0, 100));
                        }
                    }
                }
            }
        });
        
        // Handle stream completion
        return new Promise((resolve, reject) => {
            response.data.on('end', () => {
                console.log('Stream completed, full response:', fullResponse);
                
                // Notify clients of completion
                socketManager.sendToClients(dialogueId, { 
                    type: 'complete',
                    message: 'Stream completed'
                });
                
                resolve({ success: true, fullResponse });
            });
            
            response.data.on('error', (error) => {
                console.error('Stream error:', error);
                reject(error);
            });
        });
    } catch (error) {
        console.error('Error in streaming response:', error);
        throw error;
    }
}

/**
 * Stream text to speech using local TTS service (Chatterbox/Edge TTS)
 * @param {string} text - The text to convert to speech
 * @param {Object} voiceConfig - Voice configuration (local TTS settings)
 * @param {Function} onAudioChunk - Callback for audio chunks (optional)
 * @param {string} dialogueId - Optional dialogue ID
 * @returns {Promise<Buffer>} - The complete audio buffer
 */
async function streamTextToSpeech(text, voiceConfig = {}, onAudioChunk, dialogueId = null) {
    try {
        console.log('Streaming text to speech with local TTS service');
        
        // Strip emojis from text before processing
        const cleanText = stripEmojisForTTS(text);
        console.log('Text to speech input:', cleanText);
        
        const socketManager = require('../socket/socketManager');
        
        // Add a short delay to ensure client connection is fully established
        if (dialogueId) {
            console.log(`Waiting for client connection to stabilize for dialogueId: ${dialogueId}`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Check if there are still clients for this dialogue before proceeding
        if (dialogueId && !socketManager.hasClients(dialogueId)) {
            console.log(`No active clients for dialogueId: ${dialogueId}, skipping text-to-speech`);
            return Buffer.from([]);
        }
        
        // Use local TTS service instead of ElevenLabs for real-time streaming
        try {
            console.log('🎤 Using local TTS service for streaming audio');
            
            // Call the local TTS service that supports streaming
            const FormData = require('form-data');
            const formData = new FormData();
            formData.append('text', cleanText);
            formData.append('gender', 'female');
            formData.append('emotion', 'expressive');
            formData.append('exaggeration', '0.5');
            formData.append('cfg_weight', '0.7');
            formData.append('voice_cloning', 'false');
            
            const ttsResponse = await axios.post('http://tts-service:8005/synthesize', formData, {
                headers: {
                    ...formData.getHeaders()
                },
                responseType: 'arraybuffer',
                timeout: 30000
            });
            
            if (ttsResponse.status === 200 && ttsResponse.data) {
                console.log(`🎤 Local TTS generated ${ttsResponse.data.byteLength} bytes of audio`);
                
                // Convert to base64 for streaming
                const audioBase64 = Buffer.from(ttsResponse.data).toString('base64');
                
                // Call the onAudioChunk callback to stream to client via EventSource
                if (onAudioChunk && typeof onAudioChunk === 'function') {
                    console.log(`🎤 Calling onAudioChunk with ${audioBase64.length} characters of base64 audio`);
                    await onAudioChunk(audioBase64);
                } else {
                    console.log('🎤 No onAudioChunk callback provided, audio will not be streamed');
                }
                
                return Buffer.from(ttsResponse.data);
            } else {
                throw new Error('Local TTS service failed');
            }
            
        } catch (localTtsError) {
            console.error('Local TTS service failed:', localTtsError.message);
            
            // Fallback to ElevenLabs non-streaming
            console.log('🎤 Falling back to ElevenLabs non-streaming');
            
            const voiceId = voiceConfig.voice_id || 'pNInz6obpgDQGcFmaJgB';
            const modelId = voiceConfig.model_id || 'eleven_turbo_v2';
            const stability = voiceConfig.stability || 0.5;
            const similarityBoost = voiceConfig.similarity_boost || 0.75;
            
            const elevenLabsResponse = await axios.post(
                `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
                {
                    text: cleanText,
                    model_id: modelId,
                    voice_settings: {
                        stability: stability,
                        similarity_boost: similarityBoost
                    },
                    output_format: 'mp3_44100_128'
                },
                {
                    headers: {
                        'xi-api-key': process.env.ELEVENLABS_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'arraybuffer'
                }
            );
            
            if (elevenLabsResponse.status === 200 && elevenLabsResponse.data) {
                console.log(`🎤 ElevenLabs generated ${elevenLabsResponse.data.byteLength} bytes of audio`);
                
                // Convert to base64 for streaming
                const audioBase64 = Buffer.from(elevenLabsResponse.data).toString('base64');
                
                // Call the onAudioChunk callback to stream to client via EventSource
                if (onAudioChunk && typeof onAudioChunk === 'function') {
                    console.log(`🎤 Calling onAudioChunk with ${audioBase64.length} characters of base64 audio (ElevenLabs fallback)`);
                    await onAudioChunk(audioBase64);
                } else {
                    console.log('🎤 No onAudioChunk callback provided, audio will not be streamed (ElevenLabs fallback)');
                }
                
                return Buffer.from(elevenLabsResponse.data);
            } else {
                throw new Error('ElevenLabs TTS also failed');
            }
        }
        
    } catch (error) {
        console.error('Error streaming text to speech:', error);
        throw error;
    }
}

/**
 * Remove emojis and other problematic Unicode characters for TTS
 * @param {string} text - Text that may contain emojis
 * @returns {string} - Text with emojis removed
 */
function stripEmojisForTTS(text) {
    if (!text || typeof text !== 'string') return text;
    
    // Remove emojis using comprehensive Unicode ranges
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F018}-\u{1F270}]|[\u{238C}-\u{2454}]|[\u{20D0}-\u{20FF}]|[\u{FE0F}]|[\u{200D}]/gu;
    
    // Also remove other problematic characters that TTS might struggle with
    const problematicChars = /[^\x00-\x7F\u00A0-\u00FF\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF]/g;
    
    // First remove emojis specifically
    let cleanText = text.replace(emojiRegex, '');
    
    // Then remove other problematic Unicode characters, but preserve common accented characters
    cleanText = cleanText.replace(problematicChars, '');
    
    // IMPORTANT: For streaming chunks, preserve spaces! Only collapse multiple consecutive spaces
    // but do NOT trim leading/trailing spaces as they might be important for word boundaries
    cleanText = cleanText.replace(/\s{2,}/g, ' '); // Only replace 2+ spaces with 1 space
    
    if (cleanText !== text) {
        console.log(`🚫 EMOJI STRIPPED: Original="${text}" → Clean="${cleanText}"`);
        console.log(`🚫 Stripped characters: ${text.length - cleanText.length} chars removed`);
    }
    
    return cleanText;
}

/**
 * Stream text to speech using chunked approach for low latency
 * @param {string} text - Individual text chunk from streaming LLM
 * @param {Object} textAccumulator - Object to track accumulated text and state
 * @param {Object} voiceConfig - Voice configuration
 * @param {Function} onAudioChunk - Callback for audio chunks
 * @param {string} dialogueId - Dialogue ID for client streaming
 * @returns {Promise<void>}
 */
async function streamChunkedTextToSpeech(text, textAccumulator, voiceConfig = {}, onAudioChunk, dialogueId = null) {
    try {
        const socketManager = require('../socket/socketManager');
        
        // Initialize accumulator if needed
        if (!textAccumulator.buffer) {
            textAccumulator.buffer = '';
            textAccumulator.sentenceCount = 0;
            textAccumulator.lastSentTime = Date.now();
        }
        
        // Debug voice configuration
        console.log(`🎤 streamChunkedTextToSpeech called with engine: ${voiceConfig.engine}`);
        console.log(`🎤 Full voice config:`, JSON.stringify(voiceConfig, null, 2));
        
        // Ensure voice config has proper structure
        if (!voiceConfig.engine) {
            console.warn(`🎤 No engine specified in voiceConfig, defaulting to chatterbox`);
            voiceConfig.engine = 'chatterbox';
        }
        
        if (voiceConfig.engine === 'edge_tts' && !voiceConfig.edge) {
            console.warn(`🎤 Edge TTS selected but no edge config found, defaulting to chatterbox`);
            voiceConfig.engine = 'chatterbox';
        }
        
        if (voiceConfig.engine === 'chatterbox' && !voiceConfig.chatterbox) {
            console.warn(`🎤 Chatterbox selected but no chatterbox config found, using defaults`);
            voiceConfig.chatterbox = {
                selectedVoice: 'female_expressive',
                exaggeration: 0.6,
                cfg_weight: 0.7,
                voiceCloning: { enabled: false }
            };
        }
        
        // Strip emojis from text before processing
        const cleanText = stripEmojisForTTS(text);
        
        // Add new clean text to buffer  
        textAccumulator.buffer += cleanText;
        
        // Define chunking parameters
        const MIN_CHUNK_LENGTH = 75;   // Minimum characters before considering TTS
        const MAX_CHUNK_LENGTH = 150;  // Maximum characters to prevent very long chunks
        const SENTENCE_ENDINGS = /[.!?]+[\s]*$/; // Sentence ending patterns
        const PHRASE_ENDINGS = /[,;:]+[\s]*$/;   // Phrase ending patterns
        const MAX_WAIT_TIME = 2000;    // Max time to wait before forcing TTS (2 seconds)
        
        let shouldProcessChunk = false;
        let chunkToProcess = '';
        
        // Check if we should process a chunk
        const timeSinceLastSent = Date.now() - textAccumulator.lastSentTime;
        
        if (textAccumulator.buffer.length >= MIN_CHUNK_LENGTH) {
            // Look for sentence endings first (best breaking points)
            if (SENTENCE_ENDINGS.test(textAccumulator.buffer)) {
                shouldProcessChunk = true;
                chunkToProcess = textAccumulator.buffer.trim();
                console.log(`🎤 Chunking at sentence end: "${chunkToProcess.substring(0, 50)}..."`);
            }
            // If buffer is getting long, look for phrase endings
            else if (textAccumulator.buffer.length >= 100 && PHRASE_ENDINGS.test(textAccumulator.buffer)) {
                shouldProcessChunk = true;
                chunkToProcess = textAccumulator.buffer.trim();
                console.log(`🎤 Chunking at phrase end: "${chunkToProcess.substring(0, 50)}..."`);
            }
            // Force chunking if buffer is too long or too much time has passed
            else if (textAccumulator.buffer.length >= MAX_CHUNK_LENGTH || timeSinceLastSent >= MAX_WAIT_TIME) {
                // Try to break at a space to avoid cutting words
                let breakPoint = textAccumulator.buffer.lastIndexOf(' ', MAX_CHUNK_LENGTH);
                if (breakPoint === -1 || breakPoint < MIN_CHUNK_LENGTH) {
                    breakPoint = Math.min(textAccumulator.buffer.length, MAX_CHUNK_LENGTH);
                }
                
                chunkToProcess = textAccumulator.buffer.substring(0, breakPoint).trim();
                textAccumulator.buffer = textAccumulator.buffer.substring(breakPoint).trim();
                shouldProcessChunk = true;
                console.log(`🎤 Force chunking at length/time: "${chunkToProcess.substring(0, 50)}..."`);
            }
        }
        
        // Process the chunk if ready
        if (shouldProcessChunk && chunkToProcess.length > 0) {
            console.log(`🎤 Processing TTS chunk (${chunkToProcess.length} chars): "${chunkToProcess.substring(0, 100)}..."`);
            
            // Clear the buffer if we used all of it
            if (chunkToProcess === textAccumulator.buffer.trim()) {
                textAccumulator.buffer = '';
            }
            
            textAccumulator.lastSentTime = Date.now();
            textAccumulator.sentenceCount++;
            
            // Check if clients are still connected
            if (dialogueId && !socketManager.hasClients(dialogueId)) {
                console.log(`No active clients for dialogueId: ${dialogueId}, skipping chunk TTS`);
                return;
            }
            
            // Call TTS service for this chunk based on selected engine
            try {
                let audioBase64;
                
                console.log(`🎤 Checking engine selection: voiceConfig.engine="${voiceConfig.engine}"`);
                
                if (voiceConfig.engine === 'edge_tts') {
                    console.log(`🎤 Using Edge TTS for chunk with voice: ${voiceConfig.edge.selectedVoice}`);
                    console.log(`🎤 Voice config for Edge TTS:`, JSON.stringify(voiceConfig.edge, null, 2));
                    
                    // Call Edge TTS via the voice service
                    const FormData = require('form-data');
                    const formData = new FormData();
                    formData.append('text', chunkToProcess);
                    formData.append('voice_id', voiceConfig.edge.selectedVoice);
                    formData.append('speed', voiceConfig.edge.speed.toString());
                    formData.append('pitch', voiceConfig.edge.pitch.toString());
                    formData.append('volume', voiceConfig.edge.volume.toString());
                    formData.append('engine', 'edge_tts');
                    
                    console.log(`🎤 Sending Edge TTS request with parameters: voice_id=${voiceConfig.edge.selectedVoice}, engine=edge_tts`);
                    
                    const ttsResponse = await axios.post('http://tts-service:8005/synthesize', formData, {
                        headers: {
                            ...formData.getHeaders()
                        },
                        responseType: 'arraybuffer',
                        timeout: 15000 // Edge TTS is faster
                    });
                    
                    if (ttsResponse.status === 200 && ttsResponse.data) {
                        console.log(`🎤 Edge TTS generated ${ttsResponse.data.byteLength} bytes for chunk ${textAccumulator.sentenceCount}`);
                        audioBase64 = Buffer.from(ttsResponse.data).toString('base64');
                    } else {
                        throw new Error(`Edge TTS returned status: ${ttsResponse.status}`);
                    }
                    
                } else {
                    // Use Chatterbox TTS (default)
                    console.log(`🎤 Using Chatterbox TTS for chunk with voice: ${voiceConfig.chatterbox.selectedVoice}`);
                    
                    const FormData = require('form-data');
                    const formData = new FormData();
                    formData.append('text', chunkToProcess);
                    formData.append('gender', 'female'); // Could be mapped from voice selection
                    formData.append('emotion', 'expressive');
                    formData.append('exaggeration', voiceConfig.chatterbox.exaggeration.toString());
                    formData.append('cfg_weight', voiceConfig.chatterbox.cfg_weight.toString());
                    
                    // Handle voice cloning if enabled
                    if (voiceConfig.chatterbox.voiceCloning && voiceConfig.chatterbox.voiceCloning.enabled && voiceConfig.chatterbox.voiceCloning.audioFile) {
                        formData.append('voice_cloning', 'true');
                        formData.append('audio_prompt', voiceConfig.chatterbox.voiceCloning.audioFile);
                    } else {
                        formData.append('voice_cloning', 'false');
                    }
                    
                    const ttsResponse = await axios.post('http://tts-service:8005/synthesize', formData, {
                        headers: {
                            ...formData.getHeaders()
                        },
                        responseType: 'arraybuffer',
                        timeout: 30000
                    });
                    
                    if (ttsResponse.status === 200 && ttsResponse.data) {
                        console.log(`🎤 Chatterbox generated ${ttsResponse.data.byteLength} bytes for chunk ${textAccumulator.sentenceCount}`);
                        audioBase64 = Buffer.from(ttsResponse.data).toString('base64');
                    } else {
                        throw new Error(`Chatterbox returned status: ${ttsResponse.status}`);
                    }
                }
                
                // Send audio chunk to client
                if (audioBase64) {
                    if (onAudioChunk && typeof onAudioChunk === 'function') {
                        await onAudioChunk(audioBase64, textAccumulator.sentenceCount, chunkToProcess);
                    }
                    
                    // Also send via socket manager
                    if (dialogueId) {
                        socketManager.sendToClients(dialogueId, {
                            type: 'audioChunk',
                            audio: audioBase64,
                            chunkIndex: textAccumulator.sentenceCount,
                            text: chunkToProcess
                        });
                    }
                }
                
            } catch (ttsError) {
                console.error(`Error calling ${voiceConfig.engine} TTS service for chunk:`, ttsError.message);
                
                // Try ElevenLabs fallback for this chunk
                try {
                    console.log('🎤 Trying ElevenLabs fallback for chunk');
                    const elevenLabsResponse = await axios.post(
                        `https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB`,
                        {
                            text: chunkToProcess,
                            model_id: 'eleven_turbo_v2',
                            voice_settings: {
                                stability: 0.5,
                                similarity_boost: 0.75
                            },
                            output_format: 'mp3_44100_128'
                        },
                        {
                            headers: {
                                'xi-api-key': process.env.ELEVENLABS_API_KEY,
                                'Content-Type': 'application/json'
                            },
                            responseType: 'arraybuffer'
                        }
                    );
                    
                    if (elevenLabsResponse.status === 200 && elevenLabsResponse.data) {
                        console.log(`🎤 ElevenLabs fallback generated ${elevenLabsResponse.data.byteLength} bytes`);
                        
                        const audioBase64 = Buffer.from(elevenLabsResponse.data).toString('base64');
                        
                        if (onAudioChunk && typeof onAudioChunk === 'function') {
                            await onAudioChunk(audioBase64, textAccumulator.sentenceCount, chunkToProcess);
                        }
                        
                        if (dialogueId) {
                            socketManager.sendToClients(dialogueId, {
                                type: 'audioChunk',  
                                audio: audioBase64,
                                chunkIndex: textAccumulator.sentenceCount,
                                text: chunkToProcess
                            });
                        }
                    }
                } catch (fallbackError) {
                    console.error('ElevenLabs fallback also failed:', fallbackError.message);
                }
            }
        }
        
    } catch (error) {
        console.error('Error in streamChunkedTextToSpeech:', error);
    }
}

/**
 * Process any remaining text in the accumulator when stream completes
 * @param {Object} textAccumulator - The text accumulator object
 * @param {Object} voiceConfig - Voice configuration
 * @param {Function} onAudioChunk - Callback for audio chunks
 * @param {string} dialogueId - Dialogue ID for client streaming
 */
async function flushRemainingText(textAccumulator, voiceConfig = {}, onAudioChunk, dialogueId = null) {
    if (textAccumulator.buffer && textAccumulator.buffer.trim().length > 0) {
        console.log(`🎤 Flushing remaining text: "${textAccumulator.buffer.substring(0, 50)}..."`);
        console.log(`🎤 Flush function using engine: ${voiceConfig.engine}`);
        await streamChunkedTextToSpeech('', textAccumulator, voiceConfig, onAudioChunk, dialogueId, true);
        
        // Force process whatever is left
        if (textAccumulator.buffer.trim().length > 0) {
            const remainingText = stripEmojisForTTS(textAccumulator.buffer.trim());
            textAccumulator.buffer = '';
            textAccumulator.lastSentTime = Date.now();
            textAccumulator.sentenceCount++;
            
            console.log(`🎤 Processing final chunk: "${remainingText}"`);
            
            try {
                let audioBase64;
                
                // Ensure voice config has proper structure for final chunk too
                if (!voiceConfig.engine) {
                    console.warn(`🎤 No engine specified for final chunk, defaulting to chatterbox`);
                    voiceConfig.engine = 'chatterbox';
                }
                
                if (voiceConfig.engine === 'edge_tts') {
                    console.log(`🎤 Using Edge TTS for final chunk with voice: ${voiceConfig.edge?.selectedVoice || 'unknown'}`);
                    
                    const FormData = require('form-data');
                    const formData = new FormData();
                    formData.append('text', remainingText);
                    formData.append('voice_id', voiceConfig.edge.selectedVoice);
                    formData.append('speed', voiceConfig.edge.speed.toString());
                    formData.append('pitch', voiceConfig.edge.pitch.toString());
                    formData.append('volume', voiceConfig.edge.volume.toString());
                    formData.append('engine', 'edge_tts');
                    
                    const ttsResponse = await axios.post('http://tts-service:8005/synthesize', formData, {
                        headers: {
                            ...formData.getHeaders()
                        },
                        responseType: 'arraybuffer',
                        timeout: 15000
                    });
                    
                    if (ttsResponse.status === 200 && ttsResponse.data) {
                        audioBase64 = Buffer.from(ttsResponse.data).toString('base64');
                    }
                } else {
                    // Use Chatterbox TTS (default)
                    console.log(`🎤 Using Chatterbox TTS for final chunk with voice: ${voiceConfig.chatterbox.selectedVoice}`);
                    
                    const FormData = require('form-data');
                    const formData = new FormData();
                    formData.append('text', remainingText);
                    formData.append('gender', 'female');
                    formData.append('emotion', 'expressive');
                    formData.append('exaggeration', voiceConfig.chatterbox.exaggeration.toString());
                    formData.append('cfg_weight', voiceConfig.chatterbox.cfg_weight.toString());
                    
                    // Handle voice cloning if enabled
                    if (voiceConfig.chatterbox.voiceCloning && voiceConfig.chatterbox.voiceCloning.enabled && voiceConfig.chatterbox.voiceCloning.audioFile) {
                        formData.append('voice_cloning', 'true');
                        formData.append('audio_prompt', voiceConfig.chatterbox.voiceCloning.audioFile);
                    } else {
                        formData.append('voice_cloning', 'false');
                    }
                    
                    const ttsResponse = await axios.post('http://tts-service:8005/synthesize', formData, {
                        headers: {
                            ...formData.getHeaders()
                        },
                        responseType: 'arraybuffer',
                        timeout: 30000
                    });
                    
                    if (ttsResponse.status === 200 && ttsResponse.data) {
                        audioBase64 = Buffer.from(ttsResponse.data).toString('base64');
                    }
                }
                
                if (audioBase64) {
                    if (onAudioChunk && typeof onAudioChunk === 'function') {
                        await onAudioChunk(audioBase64, textAccumulator.sentenceCount, remainingText, true);
                    }
                    
                    if (dialogueId) {
                        const socketManager = require('../socket/socketManager');
                        socketManager.sendToClients(dialogueId, {
                            type: 'audioChunk',
                            audio: audioBase64,
                            chunkIndex: textAccumulator.sentenceCount,
                            text: remainingText,
                            isFinal: true
                        });
                    }
                }
            } catch (error) {
                console.error('Error processing final text chunk:', error);
            }
        }
    }
}

/**
 * Get available voice options from ElevenLabs
 * @returns {Promise<Array>} List of available voices
 */
async function getElevenLabsVoices() {
  try {
    const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      }
    });
    
    return response.data.voices;
  } catch (error) {
    console.error('Error fetching ElevenLabs voices:', error.message);
    throw error;
  }
}

// Add a new function for streaming audio directly to the client
async function streamAudioToClient(dialogueId, text, voiceConfig) {
    try {
        const socketManager = require('../socket/socketManager');
        
        // ElevenLabs API request
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceConfig.voice_id}`,
            {
                text,
                model_id: voiceConfig.model_id || 'eleven_monolingual_v1',
                voice_settings: {
                    stability: voiceConfig.stability || 0.75,
                    similarity_boost: voiceConfig.similarity_boost || 0.75
                },
                output_format: 'mp3_44100_128', // Explicitly use Safari-compatible format
            },
            {
                headers: {
                    'xi-api-key': process.env.ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer'
            }
        );
        
        // Convert to base64 and send to client
        const audioBase64 = Buffer.from(response.data).toString('base64');
        
        socketManager.sendToClients(dialogueId, {
            type: 'audio',
            data: {
                format: 'mp3',
                audio: audioBase64
            }
        });
        
        return { success: true };
    } catch (error) {
        console.error('Error streaming audio to client:', error);
        throw error;
    }
}

/**
 * Alternative API caller using native https module instead of axios
 * @param {Object} params - API call parameters
 * @returns {Promise<Object>} - API response
 */
async function directXaiCall(params) {
  const { 
    model = 'grok-4',
    messages,
    max_tokens = 500
  } = params;
  
  // Truncate content to ensure reasonable size
  const processedMessages = messages.map(msg => {
    if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.length > 4000) {
      return {
        ...msg,
        content: msg.content.substring(0, 4000) + ' [content truncated]'
      };
    }
    return msg;
  });
  
  // Prepare request data
  const postData = JSON.stringify({
    model: model,
    messages: processedMessages,
    stream: false,
    temperature: 0.2,
    max_tokens: max_tokens
  });
  
  return new Promise((resolve, reject) => {
    // Request options
    const options = {
      hostname: 'api.x.ai',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 60000 // 60 seconds
    };
    
    console.log(`Making direct HTTPS call to xAI API for model ${model}`);
    console.log(`Message content length: ${processedMessages[1]?.content?.length || 0} characters`);
    
    // Create request
    const req = https.request(options, (res) => {
      let responseData = '';
      
      // Collect response data
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      // Process complete response
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsedData = JSON.parse(responseData);
            console.log(`Direct API call successful with status ${res.statusCode}`);
            resolve({ data: parsedData, status: res.statusCode });
          } else {
            console.error(`API returned error status: ${res.statusCode}`);
            reject(new Error(`API error: ${res.statusCode} - ${responseData}`));
          }
        } catch (error) {
          console.error('Error parsing API response:', error);
          reject(error);
        }
      });
    });
    
    // Handle request errors
    req.on('error', (error) => {
      console.error('Request error:', error);
      reject(error);
    });
    
    // Handle timeout
    req.on('timeout', () => {
      console.error('Request timed out');
      req.destroy();
      reject(new Error('Request timed out'));
    });
    
    // Send request data
    req.write(postData);
    req.end();
  });
}

/**
 * Makes a robust API call to xAI with retries and proper error handling
 * @param {Object} params - API call parameters
 * @returns {Promise<Object>} - API response
 */
async function callXaiApi(params) {
  const {
    model = 'grok-4',
    messages,
    isVision = false,
    maxRetries = 5, // Changed back to 5 from 0
    initialTimeout = isVision ? 90000 : 90000 // 90 seconds for both types
  } = params;
  
  // Process messages to limit content length even more aggressively
  const processedMessages = messages.map(msg => {
    if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.length > 6000) {
      console.log(`Truncating message content from ${msg.content.length} to 6000 characters`);
      return {
        ...msg,
        content: msg.content.substring(0, 6000) + ' [content truncated due to length]'
      };
    }
    return msg;
  });
  
  let retries = 0;
  let lastError = null;
  
  // Try direct API call first
  while (retries <= maxRetries) {
    try {
      console.log(`Making xAI API call to model ${model} (attempt ${retries + 1}/${maxRetries + 1})`);
      
      // Log the first 100 chars of the content for debugging
      if (processedMessages[1] && processedMessages[1].content) {
        console.log(`Content preview: ${processedMessages[1].content.substring(0, 100)}...`);
        console.log(`Content length: ${processedMessages[1].content.length} characters`);
      }
      
      const timeout = initialTimeout * (retries + 1); // Increase timeout with each retry
      
      const response = await axios.post('https://api.x.ai/v1/chat/completions', {
        model: model,
        messages: processedMessages,
        stream: false,
        temperature: 0.2,
        max_tokens: 500 // Limit the response size to speed up processing
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: timeout,
        maxContentLength: 10 * 1024 * 1024,
        maxBodyLength: 10 * 1024 * 1024,
        decompress: true,
        httpAgent: new http.Agent({ keepAlive: true }),
        httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false })
      });
      
      console.log(`API call successful with status ${response.status}`);
      return response;
      
    } catch (error) {
      lastError = error;
      retries++;
      
      // More detailed error logging
      console.error(`API call attempt ${retries}/${maxRetries + 1} failed:`);
      if (error.response) {
        console.error(`Status: ${error.response.status}, Data:`, error.response.data);
        // Don't retry on 4xx errors except 429 (rate limit)
        if (error.response.status >= 400 && error.response.status < 500 && error.response.status !== 429) {
          break;
        }
      } else if (error.request) {
        console.error(`Network error: ${error.code}, Message: ${error.message}`);
        // For timeout errors, try with even more aggressive content truncation
        if (error.code === 'ECONNABORTED' && processedMessages[1] && processedMessages[1].content.length > 3000) {
          console.log(`Timeout occurred. Further truncating content to 3000 characters for next attempt`);
          processedMessages[1].content = processedMessages[1].content.substring(0, 3000) + ' [severely truncated]';
        }
      } else {
        console.error(`Error: ${error.message}`);
      }
      
      if (retries <= maxRetries) {
        const delay = Math.pow(2, retries) * 1000;
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // If we got here, all retries failed
  throw lastError || new Error('All API call attempts failed');
}

/**
 * Call OpenAI Vision API as a backup for image analysis
 * @param {Object} params - Image analysis parameters
 * @returns {Promise<Object>} - API response
 */
async function callOpenAiVision(params) {
  const { 
    imageUrl,
    prompt,
    max_tokens = 300
  } = params;
  
  console.log('Attempting OpenAI Vision API call...');
  
  try {
    // Prepare image data - handle both URLs and base64
    let imageContent;
    if (imageUrl.startsWith('data:image')) {
      // It's a base64 image
      imageContent = { type: "image_url", image_url: { url: imageUrl } };
    } else {
      // It's a URL
      imageContent = { type: "image_url", image_url: { url: imageUrl } };
    }
    
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4-vision-preview',
      messages: [
        {
          role: 'system',
          content: 'You are an AI that analyzes images accurately and responds in JSON format.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            imageContent
          ]
        }
      ],
      max_tokens: max_tokens,
      temperature: 0.3,
      response_format: { type: "json_object" }
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000
    });
    
    console.log('OpenAI Vision call successful');
    return { data: response.data, status: response.status };
  } catch (error) {
    console.error('OpenAI Vision call failed:', error.message);
    throw error;
  }
}

module.exports = {
    getVoiceModels,
    replaceAcronyms,
    identifyAuthorNameFromContent,
    identifyPublishDateFromContent,
    generateSummaryFromContent,
    analyzeImageForRecipe,
    analyzeImageForAuthor,
    generateTagsFromContent,
    generateCombinedSummaryFromArticles,
    generateDateFromRelativeTime,
    synthesizeSpeech,
    retryAsync,
    transcribeAudio,
    generateStreamingResponse,
    streamTextToSpeech,
    getElevenLabsVoices,
    streamAudioToClient,
    callXaiApi,
    directXaiCall,
    callOpenAiBackup,
    callOpenAiVision,
    streamChunkedTextToSpeech,
    flushRemainingText,
    stripEmojisForTTS
}

