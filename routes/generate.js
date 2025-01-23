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
    let { articles, selectedHosts, targetLengthSeconds } = req.body;
    if (!articles || !selectedHosts) {
        return res.status(400).json({ error: 'articles & selectedHosts are required' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Flush headers to establish SSE connection

    console.log('Received podcast generation request');

    const podcastId = generateAudioFileName(
        articles.map(article => article.url).join(', ') + JSON.stringify(selectedHosts),
        'mp3'
    );

    // Keep connection alive
    const keepAliveInterval = setInterval(() => {
        res.write(`event: ping\n`);
        res.write(`data: "Connection alive for podcast ID: ${podcastId}"\n\n`);
    }, 15000); // Every 15 seconds

    try {
        // Send initial event
        res.write(`event: generatingPodcast\n`);
        res.write(`data: "Podcast generation starting for ID: ${podcastId}"\n\n`);

        // Simulate podcast generation (replace this with your actual generation logic)
        const podcastFile = await generatePodcastFromArticles(
            articles,
            selectedHosts,
            targetLengthSeconds || 3500,
            podcastId,
            res
        );

        const audioFileUrl = `/api/generate/media?id=${podcastId}`;
        console.log('Saving synthesized podcast', podcastId, audioFileUrl);

        res.write(`event: podcastComplete\n`);
        res.write(`data: ${JSON.stringify({ message: "Podcast generation complete!", podcastFile })}\n\n`);
        res.end(); // End the stream when the task is complete
    } catch (error) {
        console.error('Error generating podcast:', error);
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ message: 'An error occurred during podcast generation.' })}\n\n`);
        // res.end(); // End the stream on error
    }

    // Clean up on client disconnect
    req.on('close', () => {
        console.log(`Client disconnected from podcast generation for ID: ${podcastId}`);
        clearInterval(keepAliveInterval); // Stop keep-alive pings
        res.end();
    });
});

// router.post('/summary', authenticateToken, async (req, res) => {
router.post('/summary', async (req, res) => {

    const podcast = true;
    let { articles, selectedHosts, targetLengthSeconds} = req.body;
  
    if (!articles) {
      return res.status(400).json({ error: 'articles are required' });
    }
    if (podcast) {
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
router.post('/speech', async (req, res) => {
    console.log('Speech generation requested');

    const {
        text,
        api = 'elevenLabs', // Default API
        output_format = 'MP3',
        // Google-specific parameters
        voice_name = 'en-GB-Journey-D',
        vocoder_name,
        speaking_rate = 1.2,
        pitch = 0.0,
        emotion = 'neutral'
    } = req.body;

    useSelfHosted = false; // Set to true to use the self-hosted TTS engine
    // const audioDirectory = path.join(__dirname, '../media');
    const audioFileName = generateAudioFileName(text, output_format.toLowerCase());
    const filePath = path.join(audioDirectory, audioFileName);

    if (useSelfHosted) {
        try {
            // Call the self-hosted Coqui TTS API
            const response = await axios.post(
                'http://localhost:8082/synthesize',
                { text, model_name: 'tts_models/en/ljspeech/tacotron2-DDC', vocoder_name },
                { responseType: 'arraybuffer' }
            );

            // Ensure the audio directory exists
            if (!fs.existsSync(audioDirectory)) {
                fs.mkdirSync(audioDirectory, { recursive: true });
            }

            // Save the WAV buffer to a temporary file
            const tempWavFile = path.join(audioDirectory, `${path.parse(audioFileName).name}.wav`);
            if (!fs.existsSync(audioDirectory)) {
                fs.mkdirSync(audioDirectory, { recursive: true });
            }
            fs.writeFileSync(tempWavFile, Buffer.from(response.data, 'binary'));
            console.log(`Self-hosted TTS: Saved audio to ${tempWavFile}`);

            // Convert the WAV file to MP3
            const ffmpeg = require('fluent-ffmpeg');
            await new Promise((resolve, reject) => {
                ffmpeg(tempWavFile)
                    .toFormat('mp3')
                    .on('end', resolve)
                    .on('error', reject)
                    .save(filePath);
            });
            console.log(`Self-hosted TTS: Converted audio to ${output_format} format`);

            // Delete the temporary WAV file
            // fs.unlinkSync(tempWavFile);

            // Return the response in the same format as other APIs
            res.json({
                url: `/api/generate/media?id=${audioFileName}`,
                format: output_format,
                warnings: [],
            });
        } catch (error) {
            console.error('Error in self-hosted TTS:', error);
            res.status(500).json({ error: 'Self-hosted TTS failed.' });
        }
    } else {
        // Hosted services logic (Google, ElevenLabs)
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
    }
});

// Route to serve audio files
router.get('/media', (req, res) => {
    const { id } = req.query;
    const filePath = path.join(audioDirectory, id);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send("File not found");
    }
});

module.exports = router;