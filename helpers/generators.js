const axios = require('axios');
const { use } = require('../routes/user');
const e = require('express');

async function generateSpeech(req, res) {
    const { text, model_name, vocoder_name, useSelfHosted } = req.body;

    try {
        let response;

        if (useSelfHosted) {
            // Call the self-hosted Coqui TTS API
            // response = await axios.post('http://speech-synthesizer:8082/synthesize',
            response = await axios.post('http://localhost:8082/synthesize',
                { text, model_name, vocoder_name }, 
                 { responseType: 'arraybuffer' });
            res.setHeader('Content-Type', 'audio/wav');
            res.send(Buffer.from(response.data, 'binary'));
        } else {
            // Call the external speech synthesis API (e.g., Google TTS)
            response = await axios.post('https://texttospeech.googleapis.com/v1/text:synthesize', {
                input: { text: text },
                voice: { languageCode: 'en-US', ssmlGender: 'FEMALE' },
                audioConfig: { audioEncoding: 'MP3' }
                }, {
                    headers: {
                        'Authorization': `Bearer ${process.env.GOOGLE_API_KEY}`
                    }
                });
                res.json(response.data);
            }
        } catch (error) {
            console.error(error);
            res.status(500).send("Error synthesizing speech");
        }   
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
        content: `You are a helpful assistant tasked with identifying the author's name from the provided content. Focus on finding the name of the author or writer of the article. It is highly unlikely that the subject of the article is its author.  Respond with JSON containing the author's name and using the key "name".`
      },
      {
        role: "user",
        content: `find author name in this article: ${content}`
      }
    ];
    
    try {
        const response = await axios.post('https://api.x.ai/v1/chat/completions', {
          model: 'grok-beta',  // Same model as in the curl command
          messages: messages,
          stream: false,  // Based on the curl data
          temperature: 0  // Same temperature setting as in the curl command
        }, {
          headers: {
            'Authorization': `Bearer ${process.env.XAI_BEARER_TOKEN}`,  // Set your bearer token here
            'Content-Type': 'application/json',
          },
          timeout: 120000 // Optional: 120 seconds timeout
        });
        
        console.log('x AI response to authorName search:', response.data.choices[0].message.content);
        if (response.data && response.data.choices && response.data.choices[0]) {
            // let authorName = response.data.choices[0].message.content;
            // Original content from the response
            const rawcontent = response.data.choices[0].message.content;
            const rawjson = rawcontent.replace(/```json|```/g, '');

            // Parse the JSON string
            const parsedContent = JSON.parse(rawjson.trim());

            // Extract the "name" value
            const authorName = parsedContent.name;

            console.log('xAI found this Author Name:', authorName);
            // console.log('x AI found this authorName', authorName);
        

        return authorName;
       
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
          model: 'grok-beta',  // Same model as in the curl command
          messages: messages,
          stream: false,  // Based on the curl data
          temperature: 0  // Same temperature setting as in the curl command
        }, {
          headers: {
            'Authorization': `Bearer ${process.env.XAI_BEARER_TOKEN}`,  // Set your bearer token here
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
                        break;
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

// Function to generate summary with retries
// async function generateSummaryWithRetries(title, content, maxRetries = 5) {
//     let attempts = 0;

//     while (attempts < maxRetries) {
//         try {
//             // Attempt to generate the summary
//             const generatedText = await generateSummaryFromContent(title, content);
//             return generatedText;  // If successful, return the generated summary
//         } catch (error) {
//             // Log the error
//             console.error('Error generating summary:', error.response ? error.response.data : error.message);
            
//             attempts++;
//             console.warn(`Retrying summary generation (${attempts}/${maxRetries})...`);
            
//             // If the max retries have been reached, return a default value
//             if (attempts >= maxRetries) {
//                 console.error('Max retries reached. Returning default summary.');
//                 return "no summary";
//             }
            
//             // Wait 3 seconds before the next attempt
//             await new Promise(resolve => setTimeout(resolve, 3000));
//         }
//     }
// }

async function generateSummaryFromContent(title, content) {
  console.log('Inside generateSummaryFromContent with title:', title, 'content:', content);
    
    const messages = [
      {
        role: "system",
        content: `You are quick thinking podcaster tasked with generating a summary and tags from the provided article content and title. Focus on identifying the main points, key information, and overall message of the article. Make it engaging and enjoyable to read. use the labels SUMMARY and TAGS to delineate them in your response. You do not abuse cliches and trite phrases.`
      },
      {
        role: "user",
        content: `Analyze the following title and content and generate a summary, as well as a list of tags, and use the labels SUMMARY and TAGS to delineate them in your response. Focus on identifying the main points, key information, and overall message of the article and inject levity when its appropriate but keep it as short and sweet as it can be. Please provide the tags in a comma-separated format, with primary topics first, followed by any secondary or related subjects.
            title: ${title},
            content: ${content}`
      }];
  
      try {
        const response = await axios.post('https://api.x.ai/v1/chat/completions', {
          model: 'grok-beta',  // Same model as in the curl command
          messages: messages,
          stream: false,  // Based on the curl data
          temperature: 0  // Same temperature setting as in the curl command
        }, {
          headers: {
            'Authorization': `Bearer ${process.env.XAI_BEARER_TOKEN}`,  // Set your bearer token here
            'Content-Type': 'application/json',
          },
          timeout: 120000 // Optional: 120 seconds timeout
        });
        
        
        if (response.data && response.data.choices && response.data.choices[0]) {
            let fullResponseText = response.data.choices[0].message.content;
            // console.log('x AI fullResponseText:', fullResponseText);
            
            // Normalize fullResponseText by removing extra line breaks and carriage returns
            fullResponseText = fullResponseText.replace(/\r/g, '').replace(/\n+/g, '\n');
                
            // Log the normalized response text for inspection
            // console.log('Normalized xAI response text:', fullResponseText);
        
            const parsedResponse = {
                summary: '',
                tags: ''
            };
                
            // Manually locate positions of SUMMARY and TAGS sections
            const summaryStart = fullResponseText.indexOf("**SUMMARY:**");
            const tagsStart = fullResponseText.indexOf("**TAGS:**");

            // console.log('Position of **SUMMARY:**:', summaryStart);
            // console.log('Position of **TAGS:**:', tagsStart);

            if (summaryStart !== -1 && tagsStart !== -1) {
                // Extract content by slicing between markers
                parsedResponse.summary = fullResponseText.slice(summaryStart + 12, tagsStart).trim(); // 8 for "SUMMARY:"
                parsedResponse.tags = fullResponseText.slice(tagsStart + 9).trim(); // 5 for "TAGS:"

                // console.log('Parsed summary:', parsedResponse.summary);
                // console.log('Parsed tags:', parsedResponse.tags);
            } else {
                console.error("Unable to locate **SUMMARY:** or **TAGS:** markers.");
            }

            // Final parsed results after assignment
            console.log('Final parsed response - summary:', parsedResponse.summary);
            console.log('Final parsed response - tags:', parsedResponse.tags);
            return parsedResponse;
    } else {
      console.error('Unexpected response structure:', response);
      return "no summary"; // Return fallback on error
    }
  }
  catch (error) {
    console.error('Error generating summary:', error.response ? error.response.data : error.message);
    return "no summary"; // Return fallback on error
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
  
  Please provide the tags in a comma-separated format, with primary topics first, followed by any secondary or related subjects.`
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
    'Mr': 'Mister',
    'Mrs': 'Mistress',
    'Ms': 'Miss',
    'Prof': 'Professor',
    'St': 'Saint',
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
    'Co': 'Company'
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
          model: 'grok-beta',  // Same model as in the curl command
          messages: messages,
          stream: false,  // Based on the curl data
          temperature: 0  // Same temperature setting as in the curl command
        }, {
          headers: {
            'Authorization': `Bearer ${process.env.XAI_BEARER_TOKEN}`,  // Set your bearer token here
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

// old one
// async function generateCombinedSummaryFromArticles(articles, model, useSelfHosted) {
//     console.log('Generating a combined summary for multiple related articles...', {useSelfHosted});

//     // Initialize combined content
//     let combinedContent = '';
//     // let combinedTitle = 'Summary of Multiple Related Articles: ';

//     // Loop through each article and append title and content to the combined variables
//     articles.forEach((article) => {
//         combinedContent += `Title: ${article.title}\nContent: ${article.content}\n\n`;
//     });

//     const messages = [
//         {
//         role: "system",
//         content: `You are a helpful assistant tasked with generating a summary that combines and captures the main ideas, key information, and overall messages from multiple related articles. Focus on synthesizing common themes and important points.`
//         },
//         {
//         role: "user",
//         content: `Analyze the following titles and articles and generate a concise summary that combines the essence of all of them.${combinedContent}`
//         }
//     ];
//     if (model === 'gpt-4-turbo') {
//         try {
//             const response = await axios.post('https://api.openai.com/v1/chat/completions', {
//             model: 'gpt-4-turbo',  // Use GPT-4 Turbo with 128k token limit
//             messages: messages,
//             max_tokens: 4096, // Adjust token limit if needed
//             }, {
//             headers: {
//                 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
//                 'Content-Type': 'application/json',
//             },
//             timeout: 180000  
//             });

//             if (response.data && response.data.choices && response.data.choices[0]) {
//             const responseText = response.data.choices[0].message.content;
//             console.log('Combined GPT response:', responseText);
//             return responseText;
//             } else {
//             console.error('Unexpected response structure:', response);
//             return '';
//             }
//         }
//         catch (error) {
//             console.error('Error generating combined summary:', error.response ? error.response.data : error.message);
//             return '';
//         }
//     } else if (model === 'xAI') {
//         try {
//             const response = await axios.post('https://api.x.ai/v1/chat/completions', {
//             model: 'grok-beta',  // Use the x AI model
//             messages: messages,
//             stream: false,
//             temperature: 0
//             }, {
//             headers: {
//                 'Authorization': `Bearer ${process.env.XAI_BEARER_TOKEN}`,
//                 'Content-Type': 'application/json',
//             },
//             timeout: 180000  
//             });

//             if (response.data && response.data.choices && response.data.choices[0]) {
//             const responseText = response.data.choices[0].message.content;
//             console.log('Combined x AI response:', responseText);
//             return responseText;
//             } else {
//             console.error('Unexpected response structure:', response);
//             return '';
//             }
//         }
//         catch (error) {
//             console.error('Error generating combined summary:', error.response ? error.response.data : error.message);
//             return '';
//         }
//     }
// }

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

module.exports = {
    generateSpeech,
    getVoiceModels,
    replaceAcronyms,
    identifyAuthorNameFromContent,
    identifyPublishDateFromContent,
    generateSummaryFromContent,
    generateTagsFromContent,
    generateCombinedSummaryFromArticles,
    generateDateFromRelativeTime,
    retryAsync
}