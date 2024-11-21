const express = require('express');
const axios = require('axios');
const router = express.Router();
const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware

const fs = require('fs');
const crypto = require('crypto');  // For generating a unique hash
const path = require('path');
const { generateCombinedSummaryFromArticles, replaceAcronyms } = require('../helpers/generators');
// Create a directory to store the audio files if it doesn't exist
const audioDirectory = path.join(__dirname, '../media');

if (!fs.existsSync(audioDirectory)) {
    fs.mkdirSync(audioDirectory);
}

// Utility function to create a unique hash based on the URL or text
function generateAudioFileName(text) {
    return crypto.createHash('sha256').update(text).digest('hex') + '.wav';
}

// Route for text generation (switches between self-hosted and external models)
router.post('/text', async (req, res) => {
    const { prompt, useSelfHosted } = req.body;

    try {
        let response;
        
        if (useSelfHosted) {
            // Call the self-hosted LLaMA2 API
            response = await axios.post('http://text-generator:8080/generate', { prompt });
        } else {
            // Call the external API (e.g., OpenAI)
            response = await axios.post('https://api.openai.com/v1/completions', {
                model: "text-davinci-003",
                prompt: prompt,
                max_tokens: 500
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                }
            });
        }

        res.json(response.data);
    } catch (error) {
        console.error(error);
        res.status(500).send("Error generating text");
    }
});

router.post('/summary', authenticateToken, async (req, res) => {
// router.post('/summary', async (req, res) => {
    console.log('Generating summary for multiple articles...');
    let { articles } = req.body;
  
    if (!articles) {
      return res.status(400).json({ error: 'articles are required' });
    }
  
    try {
      let combinedArticles = await generateCombinedSummaryFromArticles(articles, model = 'xAI', useSelfHosted = false);
    //   res.json({ summary });
        let summary = combinedArticles.summary;
        let urlString = Array.isArray(combinedArticles.urls) ? combinedArticles.urls.join(', ') : combinedArticles.urls;
      const script = replaceAcronyms(summary);
      // **create audio of summary**
      const audioFileName = generateAudioFileName(urlString);
      const filePath = path.join(audioDirectory, audioFileName);
      console.log('url and filepath:', audioFileName, urlString, filePath);
      // Check if the file already exists
      if (fs.existsSync(filePath)) {
        // If the file already exists, return the URL
        return res.json({ url: `/api/generate/media?id=${audioFileName}` });
      }
      // const response = await axios.post('http://localhost:8082/synthesize', 
        const response = await axios.post('http://speech-synthesizer:8082/synthesize', 
            { text: script, model_name: model, vocoder_name: 'vocoder_name' }, 
            { responseType: 'arraybuffer', timeout: 90000 } // 90 seconds timeout for testing
        );
      console.log('saving Synthesized speech');
      // Save the audio file locally
      fs.writeFileSync(filePath, Buffer.from(response.data, 'binary'));
    return res.json({ url: `/api/generate/media?id=${audioFileName}` });


    } catch (error) {
      console.error('Error generating summary:', error);
      return res.status(500).json({ error: 'An error occurred while generating the summary.' });
    }
});

// Route for listing available voice models
router.post('/listVoiceModels', async (req, res) => {
    console.log('Fetching available voice models');

    // response = await getVoiceModels(req)
    // res.json(response)
    
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
});

// Route for speech synthesis (switches between self-hosted and external models)
// router.post('/speech', async (req, res) => {
router.post('/speech', authenticateToken, async (req, res) => {
    console.log('speech being generated');
    const { text, model_name = 'tts_models/en/ljspeech/tacotron2-DDC', vocoder_name, useSelfHosted } = req.body;

    try {
        let response;

        if (useSelfHosted) {
            // Generate a unique filename based on the text
            const audioFileName = generateAudioFileName(text);
            const filePath = path.join(audioDirectory, audioFileName);

            // Check if the file already exists
            if (fs.existsSync(filePath)) {
                // If the file already exists, return the URL
                return res.json({ url: `/api/generate/media?id=${audioFileName}` });
            }
            // Call the self-hosted Coqui TTS API
            // response = await axios.post('http://localhost:8082/synthesize',
            response = await axios.post('http://speech-synthesizer:8082/synthesize',
                { text, model_name, vocoder_name }, 
                 { responseType: 'arraybuffer' });

            // Save the audio file locally
            fs.writeFileSync(filePath, Buffer.from(response.data, 'binary'));

            // Return the URL for the stored file
            res.json({ url: `/api/generate/media?id=${audioFileName}` });
            // const sizeOfResponse = Buffer.byteLength(response.data);
            // console.log('sending audio to client, its byte size is', sizeOfResponse);
            // res.setHeader('Content-Type', 'audio/wav');
            // res.send(Buffer.from(response.data, 'binary'));
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
});

// Route to serve audio files
// router.get('/media', (req, res) => {
router.get('/media', (req, res) => {
    const { id } = req.query;
    const filePath = path.join(audioDirectory, id);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send("File not found");
    }
});

// async function generateSpeech(req, res) {
//     const { text, model_name, vocoder_name, useSelfHosted } = req.body;

//     try {
//         let response;

//         if (useSelfHosted) {
//             // Call the self-hosted Coqui TTS API
//             response = await axios.post('http://speech-synthesizer:8082/synthesize',
//                 { text, model_name, vocoder_name }, 
//                  { responseType: 'arraybuffer' });
//             res.setHeader('Content-Type', 'audio/wav');
//             res.send(Buffer.from(response.data, 'binary'));
//         } else {
//             // Call the external speech synthesis API (e.g., Google TTS)
//             response = await axios.post('https://texttospeech.googleapis.com/v1/text:synthesize', {
//                 input: { text: text },
//                 voice: { languageCode: 'en-US', ssmlGender: 'FEMALE' },
//                 audioConfig: { audioEncoding: 'MP3' }
//                 }, {
//                     headers: {
//                         'Authorization': `Bearer ${process.env.GOOGLE_API_KEY}`
//                     }
//                 });
//                 res.json(response.data);
//             }
//         } catch (error) {
//             console.error(error);
//             res.status(500).send("Error synthesizing speech");
//         }   
// }

// router.post('/speech', async (req, res) => {
//     console.log('speech API!')
//     response = await generateSpeech(req)
//     res.json(response)
// })

module.exports = router;