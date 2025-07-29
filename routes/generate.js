const { TextToSpeechClient } = require('@google-cloud/text-to-speech');

const express = require('express');
const axios = require('axios');
const router = express.Router();
const ffmpeg = require('fluent-ffmpeg');
const { ongoingDialogues } = require('../helpers/sharedState');
const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware
const fs = require('fs');
const crypto = require('crypto');  // For generating a unique hash
const path = require('path');
const { generateCombinedSummaryFromArticles, replaceAcronyms, synthesizeSpeech, transcribeAudio, generateStreamingResponse, streamTextToSpeech, getElevenLabsVoices, streamChunkedTextToSpeech, flushRemainingText } = require('../helpers/generators');
const { generatePodcastFromArticles, generateInvestigativeReportFromDocuments, synthesizeDialogueTurn, getAudioDuration, personalities } = require('../helpers/podcast-generator');
const e = require('express');
const multer = require('multer');
const socketManager = require('../socket/socketManager');

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

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Add this near the top of the file, before any functions
const defaultPersonality = {
    voices: {
        elevenLabs: {
            voiceId: "21m00Tcm4TlvDq8ikWAM", // Default voice ID
            modelId: "eleven_monolingual_v1",
            stability: 0.5,
            similarityBoost: 0.75
        }
    }
};

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

        // Generate podcast
        const podcastFile = await generatePodcastFromArticles(
            articles,
            selectedHosts,
            targetLengthSeconds || 3500,
            podcastId,
            res
        );

        // Only attempt to write completion event if podcast generation didn't return null
        if (podcastFile) {
            const audioFileUrl = `/api/generate/media?id=${podcastId}`;
            console.log('Saving synthesized podcast', podcastId, audioFileUrl);

            res.write(`event: podcastComplete\n`);
            res.write(`data: ${JSON.stringify({ message: "Podcast generation complete!", podcastFile })}\n\n`);
        }
    } catch (error) {
        console.error('Error generating podcast:', error);
        // Only write error if response is still writable
        if (!res.writableEnded) {
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({ message: 'An error occurred during podcast generation: ' + error.message })}\n\n`);
        }
    } finally {
        // End the response if it hasn't been ended yet
        if (!res.writableEnded) {
            res.end();
        }
        clearInterval(keepAliveInterval); // Make sure to clear the interval
    }

    // Clean up on client disconnect
    req.on('close', () => {
        console.log(`Client disconnected from podcast generation for ID: ${podcastId}`);
        clearInterval(keepAliveInterval); // Stop keep-alive pings
        // Only end the response if it's still writable
        if (!res.writableEnded) {
            res.end();
        }
    });
});

// New endpoint for investigative reports
router.post('/investigative-report', async (req, res) => {
    console.log('Received investigative report generation request');
    let { documents, metadata, investigation, selectedInvestigators, targetLengthSeconds } = req.body;
    
    // Default investigation if not provided
    investigation = investigation || "The JFK Assassination Investigation";
    
    // Default investigators if not provided
    selectedInvestigators = selectedInvestigators || ["reporter", "privateEye" ];
    
    if (!documents) {
        return res.status(400).json({ error: 'documents are required' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Flush headers to establish SSE connection


    const reportId = generateAudioFileName(
        (documents.map(doc => doc.id || doc.url || "doc").join(', ') + investigation + JSON.stringify(selectedInvestigators)),
        'mp3'
    );

    // Keep connection alive
    const keepAliveInterval = setInterval(() => {
        res.write(`event: ping\n`);
        res.write(`data: "Connection alive for report ID: ${reportId}"\n\n`);
    }, 15000); // Every 15 seconds

    try {
        // Send initial event
        res.write(`event: generatingReport\n`);
        res.write(`data: "Investigative report generation starting for ID: ${reportId}"\n\n`);
        console.log('Generating investigative report', investigation, selectedInvestigators, targetLengthSeconds, reportId);
        // Generate investigative report
        const reportFile = await generateInvestigativeReportFromDocuments(
            documents,
            metadata,
            investigation,
            selectedInvestigators,
            targetLengthSeconds = 3600,
            reportId,
            res
        );

        // Only attempt to write completion event if report generation didn't return null
        if (reportFile) {
            const audioFileUrl = `/api/generate/media?id=${reportId}`;
            console.log('Saving synthesized investigative report', reportId, audioFileUrl);

            res.write(`event: reportComplete\n`);
            res.write(`data: ${JSON.stringify({ message: "Investigative report generation complete!", reportFile })}\n\n`);
        }
    } catch (error) {
        console.error('Error generating investigative report:', error);
        // Only write error if response is still writable
        if (!res.writableEnded) {
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({ message: 'An error occurred during report generation: ' + error.message })}\n\n`);
        }
    } finally {
        // End the response if it hasn't been ended yet
        if (!res.writableEnded) {
            res.end();
        }
        clearInterval(keepAliveInterval); // Make sure to clear the interval
    }

    // Clean up on client disconnect
    req.on('close', () => {
        console.log(`Client disconnected from report generation for ID: ${reportId}`);
        clearInterval(keepAliveInterval); // Stop keep-alive pings
        // Only end the response if it's still writable
        if (!res.writableEnded) {
            res.end();
        }
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
// // THIS ONE WORKS BUT CUTS OFF THE LAST SPEAKER
// async function mergeAudioFiles(audioFiles, outputFileName) {
//     return new Promise(async (resolve, reject) => {
//         const ffmpegCommand = ffmpeg();

//         // Add all input files
//         audioFiles.forEach((file) => {
//             ffmpegCommand.input(file);
            
//         });

//         let speaker1Inputs = [];
//         let speaker2Inputs = [];
//         let filterGraph = [];

//         // Retrieve actual durations from each file
//         const durations = await Promise.all(audioFiles.map(getAudioDuration));

//         let lastSpeaker1Duration = 0; // Track last turn duration of Speaker 1
//         let lastSpeaker2Duration = 0; // Track last turn duration of Speaker 2
//         let speaker1End = 0; // When Speaker 1's last turn ends
//         let speaker2End = 0; // When Speaker 2's last turn ends

//         // Process each file
//         audioFiles.forEach((file, index) => {
//             let label = `[${index}:a]`;

//             // 🔥 FIXED: Delay is **ONLY** the previous speaker's duration
//             let delayMs = (index % 2 === 0 ? lastSpeaker2Duration : lastSpeaker1Duration) * 1000;
//             let delayedLabel = `[delayed${index}]`;

//             filterGraph.push(`${label}adelay=${delayMs}|${delayMs}${delayedLabel}`);

            
//             if (index % 2 === 0) {
//                 // Speaker 1's turn
//                 speaker1Inputs.push(delayedLabel);
//                 lastSpeaker1Duration = durations[index]; // Store duration for next turn
//                 speaker1End += lastSpeaker1Duration;
//             } else {
//                 // Speaker 2's turn
//                 speaker2Inputs.push(delayedLabel);
//                 lastSpeaker2Duration = durations[index]; // Store duration for next turn
//                 speaker2End += lastSpeaker2Duration;
//             }
//         });

//         // Merge sequences properly
//         if (speaker1Inputs.length > 0) {
//             filterGraph.push(`${speaker1Inputs.join("")}concat=n=${speaker1Inputs.length}:v=0:a=1[speaker1]`);
//         } else {
//             filterGraph.push(`aevalsrc=0:d=1[speaker1]`);
//         }

//         if (speaker2Inputs.length > 0) {
//             filterGraph.push(`${speaker2Inputs.join("")}concat=n=${speaker2Inputs.length}:v=0:a=1[speaker2]`);
//         } else {
//             filterGraph.push(`aevalsrc=0:d=1[speaker2]`);
//         }

//         // Merge into stereo with proper channel mapping
//         filterGraph.push(`[speaker1][speaker2]amerge=inputs=2,pan=stereo|c0=c0|c1=c1[aout]`);

//         const filterComplex = filterGraph.join("; ");

//         console.log("✅ FFmpeg Final Filter Complex:", filterComplex);

//         ffmpegCommand
//             .complexFilter(filterComplex)
//             .outputOptions(["-map [aout]", "-c:a flac", "-shortest"])
//             .on("end", () => {
//                 console.log("✅ FFmpeg merge completed successfully.");
//                 resolve(outputFileName);
//             })
//             .on("error", (err) => {
//                 console.error("🚨 FFmpeg error:", err.message);
//                 reject(new Error(`FFmpeg merge failed: ${err.message}`));
//             })
//             .save(outputFileName);
//     });
// }

// still truncating the last speaker
async function mergeAudioFiles(audioFiles, outputFileName) {
    return new Promise(async (resolve, reject) => {
        const ffmpegCommand = ffmpeg();

        // Add all input files
        audioFiles.forEach((file) => {
            ffmpegCommand.input(file);
        });

        let speaker1Inputs = [];
        let speaker2Inputs = [];
        let filterGraph = [];

        // Retrieve actual durations
        const durations = await Promise.all(audioFiles.map(getAudioDuration));

        let lastSpeaker1Duration = 0;
        let lastSpeaker2Duration = 0;

        audioFiles.forEach((file, index) => {
            let label = `[${index}:a]`;
            let delayedLabel = `[delayed${index}]`;

            let delayMs = (index % 2 === 0 ? lastSpeaker2Duration : lastSpeaker1Duration) * 1000;
            filterGraph.push(`${label}adelay=${delayMs}|${delayMs}${delayedLabel}`);

            if (index % 2 === 0) {
                speaker1Inputs.push(delayedLabel);
                lastSpeaker1Duration = durations[index];
            } else {
                speaker2Inputs.push(delayedLabel);
                lastSpeaker2Duration = durations[index];
            }
        });

        // Merge sequences properly
        if (speaker1Inputs.length > 0) {
            filterGraph.push(`${speaker1Inputs.join("")}concat=n=${speaker1Inputs.length}:v=0:a=1[speaker1]`);
        } else {
            filterGraph.push(`aevalsrc=0:d=1[speaker1]`);
        }

        if (speaker2Inputs.length > 0) {
            filterGraph.push(`${speaker2Inputs.join("")}concat=n=${speaker2Inputs.length}:v=0:a=1[speaker2]`);
        } else {
            filterGraph.push(`aevalsrc=0:d=1[speaker2]`);
        }

        // Merge into stereo with proper channel mapping
        filterGraph.push(`[speaker1][speaker2]amerge=inputs=2,pan=stereo|c0=c0|c1=c1[aout]`);

        const filterComplex = filterGraph.join("; ");
        console.log("✅ FFmpeg Final Filter Complex:", filterComplex);

        ffmpegCommand
            .complexFilter(filterComplex)
            .outputOptions(["-map [aout]", "-c:a flac"]) // ❌ Removed `-shortest`
            .on("end", () => {
                console.log("✅ FFmpeg merge completed successfully.");
                resolve(outputFileName);
            })
            .on("error", (err) => {
                console.error("🚨 FFmpeg error:", err.message);
                reject(new Error(`FFmpeg merge failed: ${err.message}`));
            })
            .save(outputFileName);
    });
}

// async function mergeAudioFiles(audioFiles, outputFileName) {
//     return new Promise(async (resolve, reject) => {
//         const ffmpegCommand = ffmpeg();

//         // Add all input files
//         audioFiles.forEach((file) => {
//             ffmpegCommand.input(file);
//         });

//         let speaker1Inputs = [];
//         let speaker2Inputs = [];
//         let filterGraph = [];

//         // Retrieve actual durations
//         const durations = await Promise.all(audioFiles.map(getAudioDuration));

//         let cumulativeDelaySpeaker1 = 0;
//         let cumulativeDelaySpeaker2 = 0;

//         // Process each file
//         audioFiles.forEach((file, index) => {
//             let label = `[${index}:a]`;
//             let delayedLabel = `[delayed${index}]`;

//             let delayMs = index % 2 === 0 ? cumulativeDelaySpeaker2 * 1000 : cumulativeDelaySpeaker1 * 1000;

//             filterGraph.push(`${label}adelay=${delayMs}:all=true${delayedLabel}`);

//             if (index % 2 === 0) {
//                 speaker1Inputs.push(delayedLabel);
//                 cumulativeDelaySpeaker1 += durations[index];
//             } else {
//                 speaker2Inputs.push(delayedLabel);
//                 cumulativeDelaySpeaker2 += durations[index];
//             }
//         });

//         // 🔥 Remove apad, just ensure normal concat
//         if (speaker1Inputs.length > 0) {
//             filterGraph.push(`${speaker1Inputs.join("")}concat=n=${speaker1Inputs.length}:v=0:a=1[speaker1]`);
//         } else {
//             filterGraph.push(`anullsrc=r=44100:cl=mono:d=1[speaker1]`);
//         }

//         if (speaker2Inputs.length > 0) {
//             filterGraph.push(`${speaker2Inputs.join("")}concat=n=${speaker2Inputs.length}:v=0:a=1[speaker2]`);
//         } else {
//             filterGraph.push(`anullsrc=r=44100:cl=mono:d=1[speaker2]`);
//         }

//         // Merge into stereo
//         filterGraph.push(`[speaker1][speaker2]amerge=inputs=2,pan=stereo|c0=c0|c1=c1[aout]`);

//         const filterComplex = filterGraph.join("; ");
//         console.log("✅ FFmpeg Final Filter Complex:", filterComplex);

//         ffmpegCommand
//             .complexFilter(filterComplex)
//             .outputOptions([
//                 "-map [aout]",
//                 "-c:a flac",
//                 "-af aresample=44100"
//             ])
//             .on("end", () => {
//                 console.log("✅ FFmpeg merge completed successfully.");
//                 resolve(outputFileName);
//             })
//             .on("error", (err) => {
//                 console.error("🚨 FFmpeg error:", err.message);
//                 reject(new Error(`FFmpeg merge failed: ${err.message}`));
//             })
//             .save(outputFileName);
//     });
// }






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

// Route for real-time conversation with SSE
router.post('/converse', async (req, res) => {
    try {
        const { userInput, model, systemPrompt, temperature } = req.body;
        
        // Generate a unique dialogue ID
        const dialogueId = req.body.dialogueId || `dialogue-${Date.now()}-${Math.random().toString(36).substring(2, 12)}`;
        console.log('Using dialogueId:', dialogueId);
        
        // Get conversation history if provided
        const conversationHistory = req.body.conversationHistory || [];
        
        // Initialize ongoingStream if it doesn't exist
        if (!ongoingDialogues.has(dialogueId)) {
            ongoingDialogues.set(dialogueId, {
                clients: [],
                data: []
            });
        }
        
        const ongoingStream = ongoingDialogues.get(dialogueId);
        
        // Add the current message to conversation history
        if (userInput) {
            conversationHistory.push({
                role: 'user',
                content: userInput
            });
        }
        
        // Return success immediately, client will connect to SSE stream
        res.json({
            success: true,
            dialogueId: dialogueId
        });
        
        // UPDATED: Use chunked streaming approach for real-time TTS
        
        // 1. Define a chunked text handler for immediate audio generation
        let responseText = '';
        const textAccumulator = {}; // Initialize text accumulator for chunking
        
        const handleTextChunk = async (textChunk) => {
            responseText += textChunk;
            
            // Send text chunk to client for real-time display
            socketManager.sendToClients(dialogueId, {
                type: 'textChunk',
                role: 'assistant',
                text: textChunk
            });
            
            ongoingStream.data.push({
                event: 'textChunk',
                data: {
                    role: 'assistant',
                    text: textChunk
                }
            });
            
            // NEW: Use chunked streaming TTS for immediate audio generation
            try {
                // For /converse endpoint, use default voice settings since no voice config is passed
                const defaultVoiceSettings = {
                    engine: 'chatterbox',
                    enabled: true,
                    chatterbox: {
                        selectedVoice: 'female_expressive',
                        exaggeration: 0.6,
                        cfg_weight: 0.7,
                        voiceCloning: { enabled: false }
                    }
                };
                
                await streamChunkedTextToSpeech(
                    textChunk,
                    textAccumulator,
                    defaultVoiceSettings,
                    (audioChunk, chunkIndex, chunkText, isFinal = false) => {
                        console.log(`🎤 Streaming audio chunk ${chunkIndex} via /converse for text: "${chunkText.substring(0, 50)}..."`);
                        
                        // Send audio chunk to client immediately
                        socketManager.sendToClients(dialogueId, {
                            type: 'audioChunk',
                            audio: audioChunk,
                            chunkIndex: chunkIndex,
                            text: chunkText,
                            isFinal: isFinal
                        });
                        
                        ongoingStream.data.push({
                            event: 'audioChunk',
                            data: {
                                audio: audioChunk,
                                chunkIndex: chunkIndex,
                                text: chunkText,
                                isFinal: isFinal
                            }
                        });
                    },
                    String(dialogueId)
                );
            } catch (ttsError) {
                console.error('Error in chunked TTS via /converse:', ttsError.message);
            }
        };
        
        // 2. Call the function with very explicit parameters
        console.log(`Starting generation with dialogueId: "${dialogueId}" (type: ${typeof dialogueId})`);
        
        try {
            // IMPORTANT: Pass parameters in the correct order with explicit naming
            await generateStreamingResponse(
                conversationHistory,             // Parameter 1: conversation history
                String(dialogueId),              // Parameter 2: dialogueId as a STRING (force conversion)
                {                                // Parameter 3: options object
                    temperature: temperature || 0.7,
                    model: model || 'grok-2',
                    systemPrompt: systemPrompt
                },
                handleTextChunk                 // Parameter 4: callback function
            );
            
            // NEW: Flush any remaining text in the accumulator
            try {
                await flushRemainingText(
                    textAccumulator,
                    defaultVoiceSettings,
                    (audioChunk, chunkIndex, chunkText, isFinal = true) => {
                        console.log(`🎤 Flushing final audio chunk ${chunkIndex} via /converse for text: "${chunkText.substring(0, 50)}..."`);
                        
                        // Send final audio chunk to client
                        socketManager.sendToClients(dialogueId, {
                            type: 'audioChunk',
                            audio: audioChunk,
                            chunkIndex: chunkIndex,
                            text: chunkText,
                            isFinal: true
                        });
                        
                        ongoingStream.data.push({
                            event: 'audioChunk',
                            data: {
                                audio: audioChunk,
                                chunkIndex: chunkIndex,
                                text: chunkText,
                                isFinal: true
                            }
                        });
                    },
                    String(dialogueId)
                );
            } catch (flushError) {
                console.error('Error flushing remaining text via /converse:', flushError.message);
            }
            
        } catch (error) {
            console.error('Error in generateStreamingResponse:', error);
        }
        
    } catch (error) {
        console.error('Error in converse endpoint:', error);
        // If we haven't sent a response yet, send an error
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
});

// Route to get available ElevenLabs voices
router.get('/voices', async (req, res) => {
  try {
    const voices = await getElevenLabsVoices();
    res.json({ voices });
  } catch (error) {
    console.error('Error fetching voices:', error);
    res.status(500).json({ error: 'Failed to fetch voices: ' + error.message });
  }
});

// Text request storage for Safari compatibility
// const textRequests = new Map();

// Text request endpoint for Safari
// router.post('/text-request', (req, res) => {
//     try {
//         // Generate request ID
//         const requestId = crypto.randomBytes(16).toString('hex');
//         console.log(`Created text request with ID: ${requestId}`);
        
//         // Store the request data
//         textRequests.set(requestId, {
//             text: req.body.text || '',
//             personality: req.body.personality ? JSON.parse(req.body.personality) : null,
//             history: req.body.history ? JSON.parse(req.body.history) : [],
//             timestamp: Date.now()
//         });
        
//         // Set timeout to clean up old requests
//         setTimeout(() => {
//             if (textRequests.has(requestId)) {
//                 console.log(`Cleaning up stale text request: ${requestId}`);
//                 textRequests.delete(requestId);
//             }
//         }, 5 * 60 * 1000); // 5 minutes
        
//         // Return success
//         res.json({ success: true, requestId });
//     } catch (error) {
//         console.error('Error processing text request:', error);
//         res.status(500).json({ success: false, error: error.message });
//     }
// });

// Text response endpoint with SSE for Safari
// router.get('/text-response', (req, res) => {
//     const requestId = req.query.requestId;
    
//     if (!requestId || !textRequests.has(requestId)) {
//         return res.status(404).json({ error: 'Request not found' });
//     }
    
//     console.log(`Processing text response for request: ${requestId}`);
    
//     // Get request data
//     const requestData = textRequests.get(requestId);
    
//     // Set SSE headers
//     res.setHeader('Content-Type', 'text/event-stream');
//     res.setHeader('Cache-Control', 'no-cache');
//     res.setHeader('Connection', 'keep-alive');
    
//     // Generate unique session ID
//     const sessionId = crypto.randomBytes(8).toString('hex');
//     console.log(`Safari SSE session ID: ${sessionId}`);
    
//     // Send initial connection confirmation
//     res.write(`event: connected\n`);
//     res.write(`data: ${JSON.stringify({ sessionId })}\n\n`);
    
//     // Ping to keep connection alive
//     const keepAliveInterval = setInterval(() => {
//         res.write(`event: ping\n`);
//         res.write(`data: "keep-alive"\n\n`);
//     }, 15000);
    
//     // Handle client disconnect
//     req.on('close', () => {
//         console.log(`Safari client disconnected for session: ${sessionId}`);
//         clearInterval(keepAliveInterval);
//         // Clean up request data
//         textRequests.delete(requestId);
//     });
    
//     // Process the text request
//     (async () => {
//         try {
//             const userInput = requestData.text;
            
//             // Acknowledge receipt of message
//             res.write(`event: messageReceived\n`);
//             res.write(`data: ${JSON.stringify({ text: userInput })}\n\n`);
            
//             // Generate streaming response
//             let responseText = '';
//             let pendingText = '';
//             const textChunkThreshold = 25; // Characters
            
//             // Get personality or use default
//             const personality = requestData.personality || {
//                 name: "Assistant",
//                 model: "grok-beta",
//                 voices: {
//                     elevenLabs: {
//                         voice_id: "pNInz6obpgDQGcFmaJgB",
//                         model_id: "eleven_turbo_v2"
//                     }
//                 }
//             };
            
//             // Send generating event
//             res.write(`event: generatingResponse\n`);
//             res.write(`data: "Generating response..."\n\n`);
            
//             // Generate streaming response
//             await generateStreamingResponse(
//                 userInput,
//                 async (textChunk) => {
//                     // Accumulate response
//                     responseText += textChunk;
//                     pendingText += textChunk;
                    
//                     // Send text chunk
//                     res.write(`event: responseChunk\n`);
//                     res.write(`data: ${JSON.stringify({ text: textChunk })}\n\n`);
                    
//                     // If we've accumulated enough text for TTS
//                     if (pendingText.length >= textChunkThreshold) {
//                         // Process pending text
//                         const textToProcess = pendingText;
//                         pendingText = '';
                        
//                         try {
//                             await streamTextToSpeech(
//                                 textToProcess,
//                                 personality.voices.elevenLabs,
//                                 (audioChunk) => {
//                                     // Send audio chunk
//                                     res.write(`event: audioChunk\n`);
//                                     res.write(`data: ${JSON.stringify({ 
//                                         chunk: audioChunk.toString('base64'),
//                                         text: textToProcess
//                                     })}\n\n`);
//                                 }
//                             );
//                         } catch (error) {
//                             console.error('TTS streaming error:', error);
//                         }
//                     }
//                 },
//                 personality,
//                 requestData.history
//             );
            
//             // Process any remaining text
//             if (pendingText.length > 0) {
//                 try {
//                     await streamTextToSpeech(
//                         pendingText,
//                         personality.voices.elevenLabs,
//                         (audioChunk) => {
//                             res.write(`event: audioChunk\n`);
//                             res.write(`data: ${JSON.stringify({ 
//                                 chunk: audioChunk.toString('base64'),
//                                 text: pendingText
//                             })}\n\n`);
//                         }
//                     );
//                 } catch (error) {
//                     console.error('TTS streaming error for final chunk:', error);
//                 }
//             }
            
//             // Complete conversation
//             res.write(`event: done\n`);
//             res.write(`data: "Conversation complete"\n\n`);
            
//             // Cleanup
//             textRequests.delete(requestId);
//             clearInterval(keepAliveInterval);
//             res.end();
//         } catch (error) {
//             console.error('Error generating response:', error);
//             res.write(`event: error\n`);
//             res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
//             clearInterval(keepAliveInterval);
//             res.end();
//         }
//     })();
// });

// Chat endpoint for Safari compatibility
router.post('/chat', upload.single('audio'), async (req, res) => {
    console.log('Chat request received');
    
    try {
        let userInput = '';
        
        // Extract user input from either audio file or text
        if (req.file) {
            console.log('Audio file received, size:', req.file.size, 'bytes');
            userInput = await transcribeAudio(req.file.buffer);
            console.log('Transcribed text:', userInput);
        } else if (req.body.userInput) {
            userInput = req.body.userInput;
            console.log('Text input received:', userInput);
        } else {
            return res.status(400).json({ success: false, error: 'No input provided' });
        }
        
        // Generate unique dialogue ID if not provided
        const dialogueId = req.body.dialogueId || ('dialogue-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9));
        console.log('Using dialogueId:', dialogueId);
        
        // Parse conversation history - ensure it's an array
        let conversationHistory = [];
        if (req.body.conversationHistory) {
            try {
                const parsedHistory = JSON.parse(req.body.conversationHistory);
                
                // Debug the actual structure
                console.log('Raw conversation history structure:', 
                    JSON.stringify(parsedHistory, null, 2).substring(0, 300));
                
                // Ensure it's an array with the right format
                if (Array.isArray(parsedHistory)) {
                    conversationHistory = parsedHistory.map(msg => ({
                        role: msg.role || 'user',
                        content: msg.content || msg.text || ''
                    }));
                } else if (typeof parsedHistory === 'object') {
                    // If it's not an array but an object, try to convert it
                    conversationHistory = [{
                        role: parsedHistory.role || 'user',
                        content: parsedHistory.content || parsedHistory.text || ''
                    }];
                }
                
                console.log('Formatted conversation history:', 
                    JSON.stringify(conversationHistory, null, 2).substring(0, 300));
            } catch (error) {
                console.error('Error parsing conversation history:', error);
                // Continue with empty history rather than failing
            }
        }
        
        // Parse voice configuration from frontend
        let voiceSettings = {
            engine: 'chatterbox', // Default
            enabled: true,
            chatterbox: {
                selectedVoice: 'female_expressive',
                exaggeration: 0.6,
                cfg_weight: 0.7,
                voiceCloning: { enabled: false }
            },
            edge: {
                selectedVoice: 'en-US-AriaNeural',
                speed: 1.0,
                pitch: 0,
                volume: 0
            }
        };
        
        if (req.body.voiceConfig) {
            try {
                const parsedVoiceConfig = JSON.parse(req.body.voiceConfig);
                voiceSettings = { ...voiceSettings, ...parsedVoiceConfig };
                console.log('🎵 Parsed voice configuration:', voiceSettings.engine, 'engine selected');
            } catch (error) {
                console.error('Error parsing voice configuration:', error);
                // Continue with defaults
            }
        }
        
        // Add the current user input to conversation history
        if (userInput) {
            conversationHistory.push({
                role: 'user',
                content: userInput
            });
        }
        
        // Set up streaming context in shared state
        if (!ongoingDialogues.has(dialogueId)) {
            ongoingDialogues.set(dialogueId, {
                id: dialogueId,
                status: 'processing',
                clients: new Set(),
                data: [],
                startTime: Date.now()
            });
        } else {
            // If it exists, ensure clients is a Set
            const stream = ongoingDialogues.get(dialogueId);
            if (!stream.clients || typeof stream.clients.add !== 'function') {
                stream.clients = new Set();
            }
        }
        
        const ongoingStream = ongoingDialogues.get(dialogueId);
        
        // Make sure personality is defined
        const personality = req.body.personality || defaultPersonality;
        
        // Start background processing
        (async () => {
            try {
                // Add the user message to the data
                ongoingStream.data.push({
                    event: 'textChunk',
                    data: {
                        role: 'user',
                        text: userInput
                    }
                });
                
                // Broadcast to all clients
                socketManager.sendToClients(dialogueId, {
                    type: 'textChunk',
                    role: 'user',
                    text: userInput
                });
                
                // Generate streaming response
                console.log('Generating streaming response');
                
                let responseText = '';
                let pendingText = '';
                const textChunkThreshold = 20; // Characters
                
                // Parse personality settings
                let personalitySettings = {
                    name: "Assistant",  
                    model: "grok-4",
                    temperature: 0.7,
                    systemPrompt: "You are an efficient and knowledgeable assistant for a high-profile podcaster. Your primary role is to monitor breaking news, trending stories, and relevant developments across politics, technology, culture, and media. Summarize key information concisely, prioritize credibility, and always aim to keep the host one step ahead. IMPORTANT: Do not use emojis, asterisks, or other markdown formatting in your responses as they interfere with text-to-speech synthesis.",
                    // systemPrompt: "You are a helpful assistant for a construction company. You provide coordination between customers and the construction company and its subcontractors. Answer questions about scheduling concisely and accurately. IMPORTANT: Do not use emojis, asterisks, or other markdown formatting in your responses as they interfere with text-to-speech synthesis.",
                    voices: {
                        elevenLabs: {
                            voice_id: "pNInz6obpgDQGcFmaJgB",
                            model_id: "eleven_turbo_v2",
                            stability: 0.5,
                            similarity_boost: 0.75
                        }
                    }
                };
                
                if (req.body.personality) {
                    try {
                        const customPersonality = JSON.parse(req.body.personality);
                        personalitySettings = { ...personalitySettings, ...customPersonality };
                    } catch (error) {
                        console.error('Error parsing personality:', error);
                        // Continue with default personality
                    }
                }
                
                // NEW: Define the chunked text handler for real-time TTS
                const textAccumulator = {}; // Initialize text accumulator for chunking
                
                const handleTextChunk = async (textChunk) => {
                    responseText += textChunk;
                    
                    // Send text chunk to client for real-time display
                    socketManager.sendToClients(dialogueId, {
                        type: 'textChunk',
                        role: 'assistant',
                        text: textChunk
                    });
                    
                    ongoingStream.data.push({
                        event: 'textChunk',
                        data: {
                            role: 'assistant',
                            text: textChunk
                        }
                    });
                    
                    // NEW: Use chunked streaming TTS for immediate audio generation
                    try {
                        await streamChunkedTextToSpeech(
                            textChunk,
                            textAccumulator,
                            voiceSettings, // Pass the actual voice configuration
                            (audioChunk, chunkIndex, chunkText, isFinal = false) => {
                                console.log(`🎤 Streaming audio chunk ${chunkIndex} for text: "${chunkText.substring(0, 50)}..."`);
                                
                                // Send audio chunk to client immediately
                                socketManager.sendToClients(dialogueId, {
                                    type: 'audioChunk',
                                    audio: audioChunk,
                                    chunkIndex: chunkIndex,
                                    text: chunkText,
                                    isFinal: isFinal
                                });
                                
                                ongoingStream.data.push({
                                    event: 'audioChunk',
                                    data: {
                                        audio: audioChunk,
                                        chunkIndex: chunkIndex,
                                        text: chunkText,
                                        isFinal: isFinal
                                    }
                                });
                            },
                            String(dialogueId)
                        );
                    } catch (ttsError) {
                        console.error('Error in chunked TTS:', ttsError.message);
                    }
                };
                
                try {
                    // CRITICAL FIX: Call generateStreamingResponse with ALL parameters in the correct order
                    const streamResult = await generateStreamingResponse(
                        conversationHistory,  // Pass the actual conversation history array
                        String(dialogueId),   // Ensure dialogueId is a string
                        {
                            temperature: personalitySettings.temperature || 0.7,
                            model: personalitySettings.model || 'grok-2',
                            systemPrompt: personalitySettings.systemPrompt
                        },
                        handleTextChunk      // Pass the properly defined text chunk handler
                    );
                    
                    // NEW: Flush any remaining text in the accumulator
                    try {
                        await flushRemainingText(
                            textAccumulator,
                            voiceSettings, // Pass the actual voice configuration
                            (audioChunk, chunkIndex, chunkText, isFinal = true) => {
                                console.log(`🎤 Flushing final audio chunk ${chunkIndex} for text: "${chunkText.substring(0, 50)}..."`);
                                
                                // Send final audio chunk to client
                                socketManager.sendToClients(dialogueId, {
                                    type: 'audioChunk',
                                    audio: audioChunk,
                                    chunkIndex: chunkIndex,
                                    text: chunkText,
                                    isFinal: true
                                });
                                
                                ongoingStream.data.push({
                                    event: 'audioChunk',
                                    data: {
                                        audio: audioChunk,
                                        chunkIndex: chunkIndex,
                                        text: chunkText,
                                        isFinal: true
                                    }
                                });
                            },
                            String(dialogueId)
                        );
                    } catch (flushError) {
                        console.error('Error flushing remaining text:', flushError.message);
                    }
                    
                } catch (error) {
                    console.error('Error in generateStreamingResponse:', error);
                    
                    // Send a default response if the generator fails
                    const defaultResponse = "I'm sorry, I encountered an error while processing your request. Could you try again?";
                    
                    socketManager.sendToClients(dialogueId, {
                        type: 'textChunk',
                        role: 'assistant',
                        text: defaultResponse
                    });
                    
                    ongoingStream.data.push({
                        event: 'textChunk',
                        data: {
                            role: 'assistant',
                            text: defaultResponse
                        }
                    });
                    
                    // Generate audio for the default response using chunked approach
                    try {
                        const defaultTextAccumulator = {};
                        await streamChunkedTextToSpeech(
                            defaultResponse,
                            defaultTextAccumulator,
                            voiceSettings, // Use the user's voice configuration for error responses too
                            (audioChunk, chunkIndex, chunkText, isFinal = false) => {
                                socketManager.sendToClients(dialogueId, {
                                    type: 'audioChunk',
                                    audio: audioChunk,
                                    chunkIndex: chunkIndex,
                                    text: chunkText,
                                    isFinal: isFinal
                                });
                                
                                ongoingStream.data.push({
                                    event: 'audioChunk',
                                    data: {
                                        audio: audioChunk,
                                        chunkIndex: chunkIndex,
                                        text: chunkText,
                                        isFinal: isFinal
                                    }
                                });
                            },
                            String(dialogueId)
                        );
                        
                        // Flush any remaining text
                        await flushRemainingText(
                            defaultTextAccumulator,
                            voiceSettings, // Use the user's voice configuration
                            (audioChunk, chunkIndex, chunkText, isFinal = true) => {
                                socketManager.sendToClients(dialogueId, {
                                    type: 'audioChunk',
                                    audio: audioChunk,
                                    chunkIndex: chunkIndex,
                                    text: chunkText,
                                    isFinal: true
                                });
                                
                                ongoingStream.data.push({
                                    event: 'audioChunk',
                                    data: {
                                        audio: audioChunk,
                                        chunkIndex: chunkIndex,
                                        text: chunkText,
                                        isFinal: true
                                    }
                                });
                            },
                            String(dialogueId)
                        );
                    } catch (audioError) {
                        console.error('Error generating audio for default response:', audioError);
                    }
                }
                
                // CRITICAL FIX: Wait for all TTS processing to complete before sending 'done'
                // Add a small delay to ensure all async TTS chunks have been processed
                console.log('🎤 Waiting for TTS processing to complete before sending done event...');
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
                
                // Check if stream still has clients before sending completion
                if (socketManager.hasClients(dialogueId)) {
                    console.log('✅ Sending conversation completion event');
                    
                    // Mark conversation as complete
                    ongoingStream.status = 'completed';
                    socketManager.sendToClients(dialogueId, {
                        type: 'done',
                        data: "Conversation complete"
                    });
                    
                    ongoingStream.data.push({
                        event: 'done',
                        data: "Conversation complete"
                    });
                } else {
                    console.log('⚠️ No clients remaining, skipping completion event');
                }
                
                console.log('Streaming response completed');
                
            } catch (error) {
                console.error('Error in streaming process:', error);
                ongoingStream.status = 'error';
                
                socketManager.sendToClients(dialogueId, {
                    type: 'error',
                    data: {
                        message: error.message
                    }
                });
                
                ongoingStream.data.push({
                    event: 'error',
                    data: {
                        message: error.message
                    }
                });
            }
        })();
        
        // Respond to the client with success and the dialogue ID
        res.json({
            success: true,
            dialogueId
        });
        
    } catch (error) {
        console.error('Error in chat endpoint:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Helper function to send events to all connected clients
function sendEventToAll(dialogueId, eventType, data) {
    // Ensure dialogueId is a string
    dialogueId = String(dialogueId);
    
    // Get the socketManager
    const socketManager = require('../socket/socketManager');
    
    // Send with proper formatting
    socketManager.sendToClients(dialogueId, {
        type: eventType,
        ...data
    });
}

// Create an endpoint for SSE (Server-Sent Events)
router.get('/open-stream', (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering if using Nginx
  
  // Get the dialogue ID from the request query
  const dialogueId = req.query.id;
  console.log(`Client connecting to stream with dialogueId: ${dialogueId}`);
  
  if (!dialogueId) {
    console.error("No dialogue ID provided");
    res.status(400).end();
    return;
  }
  
  // CRITICAL FIX: Check if ongoingDialogues is defined
  if (typeof ongoingDialogues === 'undefined') {
    console.error("ongoingDialogues is undefined! Check imports and initialization.");
    res.status(500).write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: "Server configuration error" })}\n\n`);
    res.end();
    return;
  }
  
  try {
    // Fix: Ensure clients is initialized as a Set, not an array
    if (!ongoingDialogues.has(dialogueId)) {
      ongoingDialogues.set(dialogueId, {
        clients: new Set(),
        data: []
      });
    } else {
      // Fix: If it exists but clients isn't a Set, initialize it
      const stream = ongoingDialogues.get(dialogueId);
      if (!stream.clients || typeof stream.clients.add !== 'function') {
        stream.clients = new Set();
      }
    }
    
    // Add this client to the set
    const stream = ongoingDialogues.get(dialogueId);
    stream.clients.add(res);
    
    // Send an initial connection event
    const sendEvent = (event, data) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    // Send confirmation that connection is established
    sendEvent('connected', { message: 'Connection established' });
    
    // Send any existing data from buffer
    if (stream.data && stream.data.length > 0) {
      console.log(`Sending ${stream.data.length} buffered events to client for dialogueId: ${dialogueId}`);
      stream.data.forEach(item => {
        sendEvent(item.event, item.data);
      });
    }
    
    // Set up a keep-alive interval
    const keepAliveInterval = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(keepAliveInterval);
        return;
      }
      res.write(': ping\n\n');
    }, 30000);
    
    // Handle client disconnect
    req.on('close', () => {
      console.log(`Client disconnected from dialogueId: ${dialogueId}`);
      if (ongoingDialogues.has(dialogueId)) {
        const stream = ongoingDialogues.get(dialogueId);
        stream.clients.delete(res);
        
        // Clean up if no more clients
        if (stream.clients.size === 0) {
          console.log(`No more clients for dialogueId: ${dialogueId}. Cleaning up.`);
          ongoingDialogues.delete(dialogueId);
        }
      }
      
      clearInterval(keepAliveInterval);
    });
  } catch (error) {
    console.error("Error in open-stream handler:", error);
    res.status(500).write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: "Server error: " + error.message })}\n\n`);
    res.end();
  }
});

// Fix the TTS fallback endpoint with correct URL format and configuration
router.post('/tts-fallback', express.json(), express.urlencoded({ extended: true }), async (req, res) => {
    try {
        // Get text from either JSON or form data
        const text = req.body.text;
        
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }
        
        console.log('Processing fallback TTS request:', text.substring(0, 50) + '...');
        
        // Get API config
        const elevenLabsConfig = require('../helpers/apiConfig').tts?.elevenLabs || {};
        const apiKey = elevenLabsConfig.apiKey || process.env.ELEVENLABS_API_KEY;
        
        // Use the specified voice ID - UPDATED
        // const voiceId = 'XDBzexbseIAKtAVaAwm3';
        const voiceId = 'pwMBn0SsmN1220Aorv15';
        console.log(`Using voice ID: ${voiceId}`);
        
        // Fix the URL format to match the working example
        const apiUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
        console.log(`Using API URL: ${apiUrl}`);
        
        const response = await axios.post(
            apiUrl,
            {
                text: text,
                model_id: 'eleven_monolingual_v1', 
                voice_settings: {
                    stability: 0.75,
                    similarity_boost: 0.75
                },
                output_format: 'mp3_44100_128', // Safari-compatible format
                apply_text_normalization: 'auto'
            },
            {
                headers: {
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'audio/mp3'
                },
                responseType: 'arraybuffer'
            }
        );
        
        // Send the audio file to the client
        res.set('Content-Type', 'audio/mp3');
        res.send(Buffer.from(response.data));
        
    } catch (error) {
        console.error('Error in fallback TTS:', error.message);
        
        // Better error response with details
        if (error.response) {
            console.error('ElevenLabs API error details:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data ? error.response.data.toString() : null
            });
        }
        
        res.status(500).json({ 
            error: 'Failed to generate speech',
            message: error.message
        });
    }
});

// Add a debug route
router.get('/active-dialogues', (req, res) => {
    const dialogues = Array.from(ongoingDialogues.keys());
    const details = dialogues.map(id => {
        const dialogue = ongoingDialogues.get(id);
        return {
            id,
            clientCount: dialogue.clients ? dialogue.clients.size : 0,
            status: dialogue.status || 'unknown',
            startTime: dialogue.startTime || Date.now()
        };
    });
    
    res.json({
        count: dialogues.length,
        dialogues: details
    });
});

module.exports = router;
module.exports.ongoingDialogues = ongoingDialogues;