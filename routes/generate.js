const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
// const { ClientOptions } = require('@google-cloud/common');
// const client = new TextToSpeechClient();
const express = require('express');
const axios = require('axios');
const router = express.Router();
const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware



const fs = require('fs');
const crypto = require('crypto');  // For generating a unique hash
const path = require('path');
const { generateCombinedSummaryFromArticles, replaceAcronyms, synthesizeSpeech } = require('../helpers/generators');
const { generatePodcastFromArticles } = require('../helpers/podcast-generator');
// Create a directory to store the audio files if it doesn't exist
const audioDirectory = path.join(__dirname, '../media');

const ongoingPodcastProduction = new Map();

if (!fs.existsSync(audioDirectory)) {
    fs.mkdirSync(audioDirectory);
}

// Utility function to create a unique hash based on the URL or text
function generateAudioFileName(text, extension = 'wav') {
    return crypto.createHash('sha256').update(text).digest('hex') + '.' + extension;
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

router.post('/podcast', async (req, res) => {
    let { articles, selectedHosts, targetLengthSeconds} = req.body;
    if (!articles || !selectedHosts ) {
      return res.status(400).json({ error: 'articles & selectedHosts are required' });
    }

      // Set SSE headers
    // res.setHeader('Content-Type', 'text/event-stream');
    // res.setHeader('Cache-Control', 'no-cache');
    // res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Flush headers to establish SSE connection

    // Keep track of active streams
    const clientConnection = { res };
    const podcastText = articles.map(article => article.url).join(', ') + JSON.stringify(selectedHosts);
    console.log('podcastText:', podcastText);
    const podcastId = generateAudioFileName(podcastText, 'mp3');
    ongoingPodcastProduction.set(podcastId, clientConnection);

    req.on('close', () => {
        console.log(`Client disconnected from podcast generation for ID: ${podcastId}`);
        ongoingPodcastProduction.delete(podcastId);
    });

    // send a response to acknowledge that the server received the request
    // res.status(200).json({ message: 'Podcast generation request received, podcastId:',podcastId});
    console.log('Received request to generate podcast with', articles.length, 'articles');
    console.log('Selected hosts:', selectedHosts);
    console.log('Target length:', targetLengthSeconds, 'seconds');

    res.write(`event: generatingPodcast\n`);
    res.write(`data: "Podcast generation starting for ID: ${podcastId}"\n\n`);
  
    // const podcastId = generatePodcastId(articles, selectedHosts);
    // const podcastId = 1;
    // res.flushHeaders(); // Flush headers to establish the SSE connection

    // Keep the connection alive by sending periodic "ping" events
    const keepAliveInterval = setInterval(() => {
        res.write(`event: ping\n`);
        res.write(`data: "Keep connection alive"\n\n`);
    }, 15000); // Every 15 seconds

    try {

        await generatePodcastFromArticles(articles, selectedHosts, targetLengthSeconds = 3500, podcastId, res);
        const audioFileUrl = `/api/generate/media?id=${podcastId}`;
        console.log('saving Synthesized Podcast', podcastId, audioFileUrl);
    } catch (error) {
        console.error('Error generating podcast:', error);
        return res.status(500).json({ error: 'An error occurred while generating the podcast.' });
    }
    // When the client disconnects
    req.on('close', () => {
        console.log('Client disconnected from stream.');
        clearInterval(keepAliveInterval); // Clear the keep-alive interval
        res.end(); // Close the SSE connection
    });
});

// router.post('/summary', authenticateToken, async (req, res) => {
router.post('/summary', async (req, res) => {

    const podcast = true;
// router.post('/summary', async (req, res) => {
    // console.log('Generating summary for multiple articles...');
    let { articles, selectedHosts, targetLengthSeconds} = req.body;
  
    if (!articles) {
      return res.status(400).json({ error: 'articles are required' });
    }
    if (podcast) {
    // let podcast = await generateDialogueFromArticles(articles);
    let audioFileName = await generatePodcastFromArticles(articles, selectedHosts, targetLengthSeconds = 3500);
    // const audioFileName = podcast.audioFileName;
    audioFileUrl = `/api/generate/media?id=${audioFileName}`;
    console.log('saving Synthesized Dialog', audioFileName);

    return res.json({ url: `/api/generate/media?id=${audioFileName}` });

    } else {
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
    //   const response = await axios.post('http://localhost:8082/synthesize', 
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
// // router.post('/speech', authenticateToken, async (req, res) => {
//     console.log('speech being generated');
//     // const { text, model_name = 'tts_models/en/ljspeech/tacotron2-DDC', vocoder_name, useSelfHosted } = req.body;
//     // 'en-US-Studio-O'
//     const { text, voice_name = 'en-US-Studio-M', vocoder_name, useSelfHosted=false, speaking_rate = 1.3, pitch = 0.0, emotion = 'neutral', output_format = 'MP3' } = req.body;
//     try {
//         let response;

//         if (useSelfHosted) {
//             // Generate a unique filename based on the text
//             const audioFileName = generateAudioFileName(text, "wav");
//             const filePath = path.join(audioDirectory, audioFileName);

//             // Check if the file already exists
//             if (fs.existsSync(filePath)) {
//                 // If the file already exists, return the URL
//                 return res.json({ url: `/api/generate/media?id=${audioFileName}` });
//             }
//             // Call the self-hosted Coqui TTS API
//             response = await axios.post('http://localhost:8082/synthesize',
//             // response = await axios.post('http://speech-synthesizer:8082/synthesize',
//                 { text, model_name, vocoder_name },
//                 { responseType: 'arraybuffer' });

//             // Save the audio file locally
//             fs.writeFileSync(filePath, Buffer.from(response.data, 'binary'));
//             const duration = response.data.length / (44100 * 2); // Assuming 44.1kHz, 16-bit
//             // Return the URL for the stored file
//             res.json({
//                 url: `/api/generate/media?id=${audioFileName}`,
//                 format: 'wav',
//                 duration: parseFloat(duration.toFixed(2)),
//                 warnings: []
//             });
//         } else {
//             console.log('External model being used');
//             const fileExtension = output_format.toLowerCase();
//             const audioFileName = generateAudioFileName(text, fileExtension);
//             const filePath = path.join(audioDirectory, audioFileName);

//             // Check if the file already exists
//             if (fs.existsSync(filePath)) {
//                 // If the file already exists, return the URL
//                 return res.json({ 
//                     url: `/api/generate/media?id=${audioFileName}`,
//                     format: output_format,
//                     warnings: []
//                 });
//             }

//             // Validate required fields
//             if (!text) {
//                 return res.status(400).json({ error: 'text is required' });
//             }

//             // Validate parameters
//             if (speaking_rate < 0.25 || speaking_rate > 4.0) {
//                 return res.status(400).json({ error: 'speaking_rate must be between 0.25 and 4.0' });
//             }
//             if (pitch < -20.0 || pitch > 20.0) {
//                 return res.status(400).json({ error: 'pitch must be between -20.0 and 20.0' });
//             }
//             if (!['neutral', 'sad', 'angry'].includes(emotion)) {
//                 return res.status(400).json({ error: 'Invalid emotion. Supported emotions are: neutral, sad, angry' });
//             }
//             if (!['MP3', 'WAV', 'OGG'].includes(output_format)) {
//                 return res.status(400).json({ error: 'Invalid output format' });
//             }

//             // Initialize Google Cloud TTS client
//             const client = new TextToSpeechClient();

//             // Set up synthesis input
//             const synthesisInput = emotion === 'neutral'
//                 ? { text }
//                 : {
//                     ssml: `<speak><express-as style="${emotion}">${text}</express-as></speak>`,
//                 };

//             // Build the voice request
//             const voice = {
//                 languageCode: "en-US",
//                 name: voice_name,
//             };

//             // Generate warnings for unsupported features
//             const warnings = [];
//             if (pitch !== 0.0) {
//                 warnings.push("Pitch modification is not supported for Studio voices");
//             }

//             // Configure audio output
//             const audioConfig = {
//                 audioEncoding: output_format === 'MP3' ? 'MP3' : output_format === 'WAV' ? 'LINEAR16' : 'OGG_OPUS',
//                 speakingRate: speaking_rate,
//                 pitch,
//             };

//             // Perform the text-to-speech request
//             let response;
//             try {
//                 response = await client.synthesizeSpeech({
//                     input: synthesisInput,
//                     voice,
//                     audioConfig,
//                 });
//                 console.log('response 123:', response);
//             } catch (error) {
//                 console.error('Speech synthesis failed:', error);
//                 return res.status(500).json({ error: 'Speech synthesis failed' });
//             }

//             // Extract audio content from the correct location in the response
//             const audioContent = response.audioContent || (Array.isArray(response) && response[0]?.audioContent);
//             if (!audioContent) {
//                 console.error('Audio content is missing in the response:', response);
//                 return res.status(500).json({ error: 'No audio content in the response' });
//             }

//             try {
//             // Save the audio file
//             fs.writeFileSync(filePath, Buffer.from(audioContent));
//             // const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
//             // const filename = `generated_speech_${timestamp}_${Math.random().toString(36).substring(2, 10)}.${fileExtension}`;
//             // const outputPath = path.join(audioDirectory, filename);
//             // Ensure directory exists and save file
//                 // fs.mkdirSync(audioDirectory, { recursive: true });
//                 // Access the audio content correctly
//                 // const audioContent = response[0]?.audioContent;
//                 // if (!audioContent) {
//                 //     console.error('Audio content is missing in the response:', response);
//                 //     return res.status(500).json({ error: 'No audio content in the response' });
//                 // }
//                 // console.log(`Audio file saved successfully at ${outputPath}`);

//                 // fs.writeFileSync(outputPath, Buffer.from(response.audioContent));
//                 // fs.writeFileSync(outputPath, response.audioContent, 'binary');
//                 // Calculate approximate duration
//                 // const duration = response.audioContent.length / (44100 * 2); // Assuming 44.1kHz, 16-bit
//             } catch (error) {
//                 console.error('Failed to save audio file:', error);
//                 return res.status(500).json({ error: 'Failed to save audio file' });
//             }
                
//                 // Return success response
//                 res.json({
//                     url: `/api/generate/media?id=${audioFileName}`,
//                     format: output_format,
//                     // duration: parseFloat(duration.toFixed(2)),
//                     warnings,
//                 });
//         }
//     } catch (error) {
//         console.error(error);
//         res.status(500).send("Error synthesizing speech");
//     }
// });

// async function synthesizeSpeech(text, voiceConfig, outputFileName, api = 'elevenLabs') {
//   if (api === 'google') {
//       const request = {
//           input: { text },
//           voice: voiceConfig.google,
//           audioConfig: { audioEncoding: 'MP3' }
//       };
//       try {
//           const [response] = await client.synthesizeSpeech(request);
//           await fs.promises.writeFile(outputFileName, response.audioContent, 'binary');
//           console.log(`Google TTS: Saved audio to ${outputFileName}`);
//           return outputFileName;
//       } catch (error) {
//           console.error(`Google TTS error: ${error.message}`);
//           throw error;
//       }
//   } else if (api === 'elevenLabs') {
//       try {
//           const response = await axios.post(
//               `https://api.elevenlabs.io/v1/text-to-speech/${voiceConfig.elevenLabs.voice_id}`,
//               {
//                   text,
//                   // model_id: 'eleven_turbo_v2', // Use the best-supported model
//                   model_id: voiceConfig.elevenLabs.model_id,
//                   voice_settings: {
//                     stability: voiceConfig.elevenLabs.stability || 0.75, // Default stability
//                     similarity_boost: voiceConfig.elevenLabs.similarity_boost || 0.75 // Default similarity boost
//                 },  
//                   output_format: 'mp3_44100_128', // High-quality audio
//                   apply_text_normalization: 'auto' // Default normalization
//               },
//               {
//                   headers: {
//                       'xi-api-key': process.env.ELEVENLABS_API_KEY,
//                       'Content-Type': 'application/json'
//                   },
//                   responseType: 'arraybuffer'
//               }
//           );
//           await fs.promises.writeFile(outputFileName, response.data, 'binary');
//           console.log(`Eleven Labs: Saved audio to ${outputFileName}`);
//           return outputFileName;
//       } catch (error) {
//           console.error(`Eleven Labs error: ${error.message}`);
//           if (error.response) {
//               console.error(`Response status: ${error.response.status}`);
//               console.error(`Response data: ${Buffer.from(error.response.data).toString('utf-8')}`);
//           }
//           throw error;
//       }
//   } else {
//       throw new Error(`Unsupported API: ${api}`);
//   }
// }

router.post('/speech', async (req, res) => {
    console.log('Speech generation requested');

    const {
        text,
        api = 'elevenLabs', // Default API
        output_format = 'MP3',
        // Google-specific parameters
        voice_name = 'en-US-Studio-M',
        vocoder_name,
        speaking_rate = 1.3,
        pitch = 0.0,
        emotion = 'neutral'
    } = req.body;

    // Default voice configuration for each API
    const defaultVoiceConfig = {
        google: { languageCode: 'en-GB', name: 'en-GB-Journey-D', ssmlGender: 'MALE' },
        elevenLabs: {
            voice_id: 'TWOFxz3HmcZPjoBTPVjd',
            model_id: 'eleven_monolingual_v1',
            stability: 0.5,
            similarity_boost: 0.75,
        },
    };

    try {
        const fileExtension = output_format.toLowerCase();
        const audioFileName = generateAudioFileName(text, fileExtension);
        const filePath = path.join(audioDirectory, audioFileName);

        // Check if the file already exists
        if (fs.existsSync(filePath)) {
            return res.json({
                url: `/api/generate/media?id=${audioFileName}`,
                format: output_format,
                warnings: api === 'google' ? [] : ['Google-specific parameters ignored for ElevenLabs.'],
            });
        }

        // Validate input for Google TTS only
        if (api === 'google') {
            if (!['MP3', 'WAV', 'OGG'].includes(output_format)) {
                return res.status(400).json({ error: 'Invalid output format for Google TTS.' });
            }
            if (speaking_rate < 0.25 || speaking_rate > 4.0) {
                return res.status(400).json({ error: 'speaking_rate must be between 0.25 and 4.0' });
            }
            if (pitch < -20.0 || pitch > 20.0) {
                return res.status(400).json({ error: 'pitch must be between -20.0 and 20.0' });
            }
        } else if (api === 'elevenLabs') {
            // ElevenLabs does not support these parameters, log warning
            if (voice_name || vocoder_name || speaking_rate !== 1.3 || pitch !== 0.0 || emotion !== 'neutral') {
                console.warn('Google-specific parameters ignored for ElevenLabs TTS.');
            }
        }

        // Synthesize speech
        try {
            const voiceConfig = {
                google: {
                    ...defaultVoiceConfig.google,
                    name: voice_name,
                    speaking_rate, // Google-specific parameter
                    pitch, // Google-specific parameter
                },
                elevenLabs: defaultVoiceConfig.elevenLabs, // ElevenLabs-specific config
            };

            await synthesizeSpeech(text, voiceConfig, filePath, api);

            res.json({
                url: `/api/generate/media?id=${audioFileName}`,
                format: output_format,
                warnings: api === 'google' ? [] : ['Google-specific parameters ignored for ElevenLabs.'],
            });
        } catch (error) {
            console.error('Speech synthesis failed:', error.message);
            res.status(500).json({ error: 'Speech synthesis failed.' });
        }
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('Error generating speech');
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