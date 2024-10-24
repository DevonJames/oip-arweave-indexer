const axios = require('axios');

async function generateSpeech(req, res) {
    const { text, model_name, vocoder_name, useSelfHosted } = req.body;

    try {
        let response;

        if (useSelfHosted) {
            // Call the self-hosted Coqui TTS API
            response = await axios.post('http://speech-synthesizer:8082/synthesize',
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
                response = await axios.post('http://speech-synthesizer:8082/listModels');
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

async function generateSummaryFromContent(title, content) {
    console.log('Generating summary from the title and content...');
    
    const messages = [
      {
        role: "system",
        content: `You are a helpful assistant tasked with generating a summary based on article content and title. Focus on identifying the main points, key information, and overall message of the article but keep it as short as sweet as it can be.`
      },
      {
        role: "user",
        content: `Analyze the following content and title. Generate a concise summary that captures the essence of the article.`,
        title: title,
        content: content
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
        
      // console.log('response', response.data, response);
  
      if (response.data && response.data.choices && response.data.choices[0]) {
        let responseText = response.data.choices[0].message.content;
        if (responseText.startsWith("**Summary**")) {
          responseText = responseText.replace(/^\*\*Summary\*\*\s*[\r\n]*/, '');
        }
        console.log('xAI response:', responseText);
        return responseText;
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

  async function generateCombinedSummaryFromArticles(articles) {
    console.log('Generating a combined summary for multiple related articles...');
  
    // Initialize combined content
    let combinedContent = '';
    let combinedTitle = 'Summary of Multiple Related Articles: ';
  
    // Loop through each article and append title and content to the combined variables
    articles.forEach((article, index) => {
      combinedTitle += `\nArticle ${index + 1}: ${article.title}`;
      combinedContent += `\n\nTitle: ${article.title}\nContent: ${article.content}`;
    });
  
    const messages = [
      {
        role: "system",
        content: `You are a helpful assistant tasked with generating a summary that combines and captures the main ideas, key information, and overall messages from multiple related articles. Focus on synthesizing common themes and important points.`
      },
      {
        role: "user",
        content: `Analyze the following articles and generate a concise summary that combines the essence of all of them.`,
        title: combinedTitle,
        content: combinedContent
      }
    ];
  
    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4-turbo',  // Use GPT-4 Turbo with 128k token limit
        messages: messages,
        max_tokens: 4096, // Adjust token limit if needed
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 180000  
      });
  
      if (response.data && response.data.choices && response.data.choices[0]) {
        const responseText = response.data.choices[0].message.content;
        console.log('Combined GPT response:', responseText);
        return responseText;
      } else {
        console.error('Unexpected response structure:', response);
        return '';
      }
    }
    catch (error) {
      console.error('Error generating combined summary:', error.response ? error.response.data : error.message);
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

module.exports = {
    generateSpeech,
    getVoiceModels,
    generateSummaryFromContent,
    generateTagsFromContent,
    generateCombinedSummaryFromArticles,
    generateDateFromRelativeTime
}