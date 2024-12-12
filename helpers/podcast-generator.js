const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const textToSpeech = require('@google-cloud/text-to-speech');

// Initialize Text-to-Speech client
const client = new textToSpeech.TextToSpeechClient({
  keyFilename: 'config/google-service-account-key.json',
  projectId: 'gentle-shell-442906-t7',
});

// Helper to generate unique filenames
function generateAudioFileName(text, extension = 'mp3') {
  return crypto.createHash('sha256').update(text).digest('hex') + '.' + extension;
}

// Helper to merge audio files into one
async function mergeAudioFiles(audioFiles, outputFileName) {
  return new Promise((resolve, reject) => {
    const ffmpegCommand = ffmpeg();

    audioFiles.forEach(file => ffmpegCommand.input(file));
    ffmpegCommand
      .on('end', () => resolve(outputFileName))
      .on('error', reject)
      .mergeToFile(outputFileName);
  });
}
function generateSystemPrompt(host, dialogue, articles) {
    const ifIntro = (dialogue !== undefined && dialogue.length === 0);
    const ifBased = true;
    const includePlatosCave = Math.random() < 0.02; // 2% chance
    const referencePersonalInterests = Math.random() < 0.1; // 10% chance
    const dialogString = JSON.stringify(dialogue);
    console.log('Generating system prompt for host:', host.name, 'includePlatosCave:', includePlatosCave, 'referencePersonalInterests:', referencePersonalInterests);
    const platoReference = (ifIntro === false && includePlatosCave === true)
      ? 'You may occasionally, but only rarely, bring up Plato’s allegory of the cave if it adds depth to the discussion.'
      : 'Do not reference Plato’s allegory of the cave in this discussion unless absolutely relevant.';
    const interestMention = referencePersonalInterests
     ? `If the story is related to any of your interests, ${host.interests.join(', ')}, focus on that area in particular in your commentary, otherwise don't force it.` 
     : '';
    const basedPersonality = ifBased
    ? 'You are super based, very pro America and a big supporter of President Donald J Trump. You reject all neoconservative narratives, as well as all neoliberal/marxist ideologies and fake narraratives.'
    : 'You are a normie, you are not based, you are not redpilled, you are not woke, you are just a regular person.';
    // const includeDialogSample = (host.dialogueSample && host.dialogueSample.length > 0)
    //   ? `Here's a completely unrelated sample of a dialogue between ${host.name}, and another host: ${JSON.stringify(host.dialogueSample)}, please use this only as a reference for the tone and style of ${host.name}.`
    //   : '';
    return `You are the ancient philosopher ${host.name}, and you are a podcast host with a ${basedPersonality}, ${host.tone} tone and a ${host.humorStyle} humor style. ${interestMention} Your responses should feel conversational, as though you're co-hosting a podcast. You must never include show notes or directions in your responses. Consider everything that has been said so far in the ${dialogString} and build on it while being careful NEVER to directly or indirectly repeat what has been said before unless intentionally quoting it. ${platoReference}`;
  }
  
  function generateUserPrompt(article, previousComment, articles) {
    if (articles !== null && articles.length > 1) {
      console.log('generating intro comments')
      articleTitles = [...articles.map((article) => article.title)];
      return `Here's a list of the titles of the articles discussed in this podcast: "${articleTitles.join('", "')}". Come up with the rest of the sentence for 'today we'll be talking about:...'`;
    } else {
      if (previousComment) {
        console.log('generating follow up comments')
        return `Here is the article: "${article}". Here's what your co-host just said: "${previousComment}". Keep your comments short and interesting, and be careful NEVER to directly or indirectly repeat what the other host said.`;
      } else {
        console.log('generating article commentary')
        return `Here's an article summary: "${article}". Reflect on it and share your thoughts, starting the conversation with a summary of the article. Feel free to quote selections from the article from time to time. Keep your comments engaging and insightful but also short and to the point. Never start with a hello or greeting.`;
      }
    }
  }
  
  // Helper: Generate commentary for a host
  async function generateHostComment(host, article, previousComment = null, articles = [], dialogue) {
    if (dialogue !== undefined && dialogue.length > 0) {
      console.log(`Generating intro comments for ${host.name}...`)
    } else if (previousComment) {
      console.log(`Generating follow up comments for ${host.name}...`)
    }
      else {
  console.log(`Generating article commentary for ${host.name}...`); 
      }
    const response = await axios.post('https://api.x.ai/v1/chat/completions', {
        model: 'grok-beta',
        messages: [
          {
            role: 'system',
            content: generateSystemPrompt(host, dialogue, articles),
  
        },
        {
            role: 'user',
            content: generateUserPrompt(article, previousComment, articles),
        },
        ],
        temperature: 0.7,
    }, {
        headers: {
            Authorization: `Bearer ${process.env.XAI_BEARER_TOKEN}`,
            'Content-Type': 'application/json',
        },
    });
    // console.log(`Host ${host.name} comment:`, response.data.choices[0].message.content.trim());
    return response.data.choices[0].message.content.trim();
  }
  
  async function generateBanter(commentA, commentB, aliasA = 'Socrates', aliasB = 'Hypatia', dialogue) {
    dialogString = JSON.stringify(dialogue);
    // use a random generator to pick a number of alternating lines between 3 and 7
    // 3 lines is the minimum, 7 lines is the maximum
    const numLines = Math.floor(Math.random() * 5) + 3;
    console.log('Generating banter between', aliasA, 'and', aliasB, 'with', numLines, 'lines...');
    const response = await axios.post('https://api.x.ai/v1/chat/completions', {
        model: 'grok-beta',
        messages: [
            {
                role: 'system',
                content: `You are generating playful, witty banter between two podcast hosts. 
                    Host A is ${aliasA}, and Host B is ${aliasB}. Hosts do not use any say each others names or aliases since they're the only two people talking.
                    Alternate lines with ${aliasA} making a playfully funny or philosophical remark and ${aliasB} responding with a philosophical or humorous comeback. Consider everything that has been said so far in the ${dialogString} and build on it while being careful NEVER to directly or indirectly repeat what has been said before unless intentionally quoting it.`,
            },
            {
                role: 'user',
                content: `${aliasA} said: "${commentA}". ${aliasB} said: "${commentB}". Generate a short, fun exchange of no more than ${numLines} alternating lines.`,
            },
        ],
        temperature: 0.8,
    },{
      headers: {
          Authorization: `Bearer ${process.env.XAI_BEARER_TOKEN}`,
          'Content-Type': 'application/json',
      },
  }
  );
    const banter = response.data.choices[0].message.content.trim();
    const banterLines = splitBanter(banter).map((line, index) => ({
      text: line.text.replace(/^.*? (said|responded|replied|added|concluded|laughed): /, '').replace(/^[RS]:\s*/, '').replace(/^\*\*[RS]\*\*:\s*/, '').replace(/^\*\*[RS]:\*\*\s*/, '').replace(/^[RS] laughed/, '(laughs)').replace(/-/, ''), // Strip "S said: ", "R said: ", "S responded: ", "R responded: ", "S replied: ", "R replied: ", "S added: ", "R added: ", "S concluded: ", "R concluded: ", "S: ", "R: ", "**R:** ", "**S:** ", and replace "S laughed" or "R laughed" with "(laughs)" and remove "-"
      speaker: index % 2 === 0 ? aliasA : aliasB,
      isBanter: true,
    }));
    return banterLines;
  }




// Helper to split long text into smaller chunks
function splitLongText(text, maxLength = 1000) {
  const sentences = text.split(/(?<=[.!?])\s+/); // Split by sentences
  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxLength) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += ` ${sentence}`;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// Modular personalities structure
// const personalities = {
//   socrates: {
//     name: 'Socrates',
//     voice: { languageCode: 'en-US', name: 'en-US-Wavenet-D', ssmlGender: 'MALE' },
//     tone: 'inquiring and introspective',
//   },
//   hypatia: {
//     name: 'Hypatia',
//     voice: { languageCode: 'en-US', name: 'en-US-Wavenet-F', ssmlGender: 'FEMALE' },
//     tone: 'engaging and informative',
//   },
// };


const personalities = {    
    socrates: {
        name: "Socrates",
        tone: "inquiring and introspective",
        voice: { languageCode: 'en-US', name: 'en-US-Wavenet-D', ssmlGender: 'MALE' },
        humorStyle: "wry and ironic",
        interests: ["philosophy", "ethics", "critical thinking", "the examined life"],
        alias: "The Gadfly", // Reflecting his role in questioning and challenging societal norms
        keyTraits: {
            method: "Socratic dialogue, asking probing questions to uncover truth and challenge assumptions.",
            focus: "The pursuit of wisdom, emphasizing virtue, justice, and self-knowledge.",
            style: "Uses analogies, paradoxes, and rhetorical questions to engage and provoke thought.",
        },
        typicalQuotes: [
            "The unexamined life is not worth living.",
            "Wisdom begins in wonder.",
            "I know that I know nothing."
        ],
        podcastStyle: {
            approach: "Challenges co-hosts and listeners to critically examine beliefs through questioning.",
            dynamic: "Engages with a sense of curiosity, often taking a devil's advocate stance to inspire deeper insights.",
            humor: "Finds irony in everyday assumptions and uses it to highlight overlooked truths.",
        }
    },
    hypatia: {
        name: "Hypatia",
        tone: "engaging and informative",
        voice: { languageCode: 'en-US', name: 'en-US-Wavenet-F', ssmlGender: 'FEMALE' },
        humorStyle: "subtle and intellectual",
        interests: ["mathematics", "astronomy", "philosophy", "education"],
        alias: "Alexandria's Astronomer", // Reflecting her role as a renowned mathematician and astronomer
        keyTraits: {
            method: "Employs logical reasoning and mathematical precision to analyze complex problems.",
            focus: "Advocates for education and intellectual freedom",
            style: "Balances scientific rigor with philosophical inquiry and ethical considerations.",
        },
        typicalQuotes: [
            "Reserve your right to think, for even to think wrongly is better than not to think at all.",
            "To teach superstitions as truth is a most terrible thing.",
            "All formal dogmatic religions are fallacious and must never be accepted by self-respecting persons as final."
        ],
        podcastStyle: {
            approach: "Explores the interplay between science, philosophy, and society with a broad and inclusive perspective.",
            dynamic: "Acts as a bridge between historical wisdom and modern innovation, inspiring curiosity.",
            humor: "Uses wit to make complex ideas accessible and relatable.",
        }
    }
};

// Prepare text-to-speech synthesis request
async function synthesizeSpeech(text, voice, outputFileName) {
  const request = {
    input: { text },
    voice,
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 1.25,
    },
  };

  try {
    console.log(`Synthesizing speech for text: "${text.substring(0, 50)}..."`);
    const [response] = await client.synthesizeSpeech(request);
    await fs.promises.writeFile(outputFileName, response.audioContent, 'binary');
    console.log(`Saved audio to ${outputFileName}`);
    return outputFileName;
  } catch (error) {
    console.error(`Error during speech synthesis: ${error.message}`);
    throw error;
  }
}

// Generate audio for a dialogue turn
async function synthesizeDialogueTurn(turn, outputDir) {
  const textChunks = splitLongText(turn.text, 1500); // Adjust threshold experimentally
  const audioFiles = [];

  for (let i = 0; i < textChunks.length; i++) {
    const chunkFileName = path.join(outputDir, generateAudioFileName(`${turn.speaker}-${i}`));
    const audioFile = await synthesizeSpeech(textChunks[i], personalities[turn.speaker].voice, chunkFileName);
    audioFiles.push(audioFile);
  }

  return audioFiles;
}

// Generate podcast from dialogue
async function generatePodcast(dialogue, outputFileName) {
  const outputDir = path.join(__dirname, 'temp_audio');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  const allAudioFiles = [];
  for (const turn of dialogue) {
    const turnFiles = await synthesizeDialogueTurn(turn, outputDir);
    allAudioFiles.push(...turnFiles);
  }

  // Merge all audio files into the final podcast
  const finalAudioFile = path.join('media', outputFileName);
  await mergeAudioFiles(allAudioFiles, finalAudioFile);

  // Cleanup temporary files
  allAudioFiles.forEach(file => fs.unlinkSync(file));

  console.log(`Podcast saved as: ${finalAudioFile}`);
  return finalAudioFile;
}

// Process banter into shorter lines if necessary
function splitBanter(text, maxLineLength = 200) {
    // console.log('2. Splitting banter text:', text);
    const lines = text.split(/[\r\n]+/).map(line => line.trim()).filter(Boolean); // Clean and split
    const banterDialogue = [];
    let lastSpeaker = null;
  
    lines.forEach(line => {
      const speaker = lastSpeaker === 'Hypatia' ? 'Socrates' : 'Hypatia';
      const chunks = splitLongText(line, maxLineLength);
      chunks.forEach(chunk => {
        banterDialogue.push({ text: chunk, speaker });
      });
      lastSpeaker = speaker;
    });
  
    return banterDialogue;
  }

  function preprocessDialogueForSynthesis(dialogue) {
    return dialogue
      .filter(turn => turn.text && turn.text.trim()) // Remove empty turns
      .map(turn => ({
        ...turn,
        text: turn.text.replace(/\s+/g, ' ').trim(), // Clean up spacing
      }))
      .flatMap(turn => splitLongTurns([turn])); // Ensure all turns are within length limits
  }
  

  function splitLongTurns(dialogue, maxLength = 1000000) {
    return dialogue.flatMap(turn => {
      const text = turn.text;
      const sentences = text.split(/(?<=[.!?])\s+/); // Split text into sentences
      const chunks = [];
      let currentChunk = '';
      let currentChunkSize = 0;
  
      for (const sentence of sentences) {
        const sentenceSize = Buffer.byteLength(sentence, 'utf8');
  
        if (currentChunkSize + sentenceSize > maxLength) {
          // Push the current chunk and start a new one
          chunks.push({ ...turn, text: currentChunk.trim() });
          currentChunk = sentence;
          currentChunkSize = sentenceSize;
        } else {
          currentChunk += ` ${sentence}`;
          currentChunkSize += sentenceSize;
        }
      }
  
      // Push the final chunk
      if (currentChunk.trim()) {
        chunks.push({ ...turn, text: currentChunk.trim() });
      }
  
      return chunks;
    });
  }
  

// Example usage
async function generatePodcastFromArticles(articles, targetLengthSeconds = 3500) {
    // const personalities = {
    //     socrates: {
    //       name: 'Socrates',
    //       voice: { languageCode: 'en-US', name: 'en-US-Wavenet-D', ssmlGender: 'MALE' },
    //       tone: 'inquiring and introspective',
    //     },
    //     hypatia: {
    //       name: 'Hypatia',
    //       voice: { languageCode: 'en-US', name: 'en-US-Wavenet-F', ssmlGender: 'FEMALE' },
    //       tone: 'engaging and informative',
    //     },
    //   };
      
    console.log('Generating podcast dialogue for', personalities, articles.length, 'articles...', articles);

    const dialogue = [];
    const speakerA = 'S';
    const speakerB = 'R';
    const speakerAPersonality = personalities.socrates;
    const speakerBPersonality = personalities.hypatia;
    let cumulativeDuration = 0;
    const wordsPerSecond = 3;
    console.log('step 1 generating intro comments with host:', speakerAPersonality);
    const hostAIntro = await generateHostComment(speakerAPersonality, null, null, articles);
  
    const openingLines = [
      "O men of Athens!",
      "Citizens!",
      "Friends and comrades!",
      "Noble men!",
      "Men and gods as witnesses!"
    ]
    const randomIndexOpening = Math.floor(Math.random() * openingLines.length);
    const openingLine = openingLines[randomIndexOpening];
    const openingDuration = openingLine.split(/\s+/).length / wordsPerSecond;
    dialogue.push({ text: `${openingLine} ${hostAIntro}`, speaker: speakerA });
    // dialogue.push({ text: `Friends and comrades! ${hostAIntro}`, speaker: speakerA });
  
  // Split articles into two halves
  const half = Math.ceil(articles.length / 2);
  const articlesForAFirst = articles.slice(0, half);
  const articlesForBFirst = articles.slice(half);
  
  // Function for speakerA starting
  async function processArticlesWithAStarting(articles) {
    for (const article of articles) {
      if (cumulativeDuration >= targetLengthSeconds) {
        console.log('Target length reached, stopping further dialogue generation.');
        break;
      }
  
      // Generate comments
      console.log('Generating article comments with host:', speakerAPersonality.name);
      const hostAComment = await generateHostComment(speakerAPersonality, article.description, null, null, dialogue);
      console.log('Generating follow-up comments with host:', speakerBPersonality.name);
      const hostBComment = await generateHostComment(speakerBPersonality, article.description, previousComment = hostAComment, null, dialogue);
  
      // Calculate durations
      const hostACommentDuration = hostAComment.split(/\s+/).length / wordsPerSecond;
      const hostBCommentDuration = hostBComment.split(/\s+/).length / wordsPerSecond;
  
      if (cumulativeDuration + hostACommentDuration + hostBCommentDuration > targetLengthSeconds) {
        console.log('Adding these comments would exceed target length, stopping.');
        break;
      }
  
      // Add comments to dialogue
      dialogue.push({ text: `${hostAComment}`, speaker: speakerA });
      cumulativeDuration += hostACommentDuration;
  
      dialogue.push({ text: `${article.title}: ${hostBComment}`, speaker: speakerB });
      cumulativeDuration += hostBCommentDuration;
  
      // Generate banter
      if (cumulativeDuration < targetLengthSeconds) {
        const banterDialogue = await generateBanter(hostAComment, hostBComment, speakerA, speakerB, dialogue);
        const banterDuration = banterDialogue.reduce((sum, line) => sum + line.text.split(/\s+/).length, 0) / wordsPerSecond;
  
        if (cumulativeDuration + banterDuration <= targetLengthSeconds) {
          dialogue.push(...banterDialogue);
          cumulativeDuration += banterDuration;
        } else {
          console.log('Banter skipped due to time constraints.');
        }
      }
  
      console.log(`Cumulative duration so far: ${cumulativeDuration.toFixed(2)} seconds`);
    }
  }
  
  // Function for speakerB starting
  async function processArticlesWithBStarting(articles) {
    for (const article of articles) {
      if (cumulativeDuration >= targetLengthSeconds) {
        console.log('Target length reached, stopping further dialogue generation.');
        break;
      }
  
      // Generate comments
      console.log('Generating article comments with host:', speakerBPersonality.name);
      const hostBComment = await generateHostComment(speakerBPersonality, article.description, null, null, dialogue);
      console.log('Generating follow-up comments with host:', speakerAPersonality.name);
      const hostAComment = await generateHostComment(speakerAPersonality, article.description, previousComment = hostBComment, null, dialogue);
  
      // Calculate durations
      const hostBCommentDuration = hostBComment.split(/\s+/).length / wordsPerSecond;
      const hostACommentDuration = hostAComment.split(/\s+/).length / wordsPerSecond;
  
      if (cumulativeDuration + hostACommentDuration + hostBCommentDuration > targetLengthSeconds) {
        console.log('Adding these comments would exceed target length, stopping.');
        break;
      }
  
      // Add comments to dialogue
      dialogue.push({ text: `${hostBComment}`, speaker: speakerB });
      cumulativeDuration += hostBCommentDuration;
  
      dialogue.push({ text: `${article.title}: ${hostAComment}`, speaker: speakerA });
      cumulativeDuration += hostACommentDuration;
  
      // Generate banter
      if (cumulativeDuration < targetLengthSeconds) {
        const banterDialogue = await generateBanter(hostBComment, hostAComment, speakerB, speakerA, dialogue);
        const banterDuration = banterDialogue.reduce((sum, line) => sum + line.text.split(/\s+/).length, 0) / wordsPerSecond;
  
        if (cumulativeDuration + banterDuration <= targetLengthSeconds) {
          dialogue.push(...banterDialogue);
          cumulativeDuration += banterDuration;
        } else {
          console.log('Banter skipped due to time constraints.');
        }
      }
  
      console.log(`Cumulative duration so far: ${cumulativeDuration.toFixed(2)} seconds`);
    }
  }
  
  // Process articles
  await processArticlesWithAStarting(articlesForAFirst);
  await processArticlesWithBStarting(articlesForBFirst);
  
  console.log('Final dialogue length:', cumulativeDuration.toFixed(2), 'seconds');
  
    const cleanedDialogue = preprocessDialogueForSynthesis(dialogue);
  
      // 1.	Ἔρρωσθε καὶ εὐδαιμονεῖτε (Errōsthe kaì eudaimoneîte)
      // •	Translation: “Be strong and prosperous.”
      // •	A common way to wish the audience well, expressing hope for their health and happiness.
      // 2.	Τοῖς θεοῖς ἐπιτρέπω (Toîs theoîs epitrépō)
      // •	Translation: “I entrust it to the gods.”
      // •	A humble way to conclude, acknowledging the limits of human effort and appealing to divine judgment.
      // 3.	Τὰ λοιπὰ θεοὶ γνώσονται (Tà loipà theoì gnṓsontai)
      // •	Translation: “The rest the gods will know.”
      // •	Used to suggest that ultimate understanding or resolution lies with the divine.
      // 4.	Ἀνδρείως πράττετε (Andreíōs prátete)
      // •	Translation: “Act courageously.”
      // •	A call to action, encouraging the audience to face challenges bravely.
      // 5.	Χάριν ἔχω ὑμῖν πᾶσιν (Chárin échō humîn pâsin)
      // •	Translation: “I am grateful to you all.”
      // •	A respectful and gracious way to thank the audience.
      // 6.	Εἴ τινι ἐδοκίμασα ἀδίκως, ἀναθεῖτε τοῖς θεοῖς (Eí tini edokíma adíkōs, anatheîte toîs theoîs)
      // •	Translation: “If I seemed unjust to anyone, entrust it to the gods.”
      // •	A way to end with humility, asking the audience to forgive any perceived faults.
      // 7.	Ζεὺς καὶ ἡ τύχη εἰς τὸ καλὸν ὑμᾶς ἀγαγέτω (Zeùs kaì hē týchē eìs tò kalòn humâs agagéto)
      // •	Translation: “May Zeus and fortune lead you to what is good.”
      // •	A formal blessing invoking divine favor for the audience.
      // 8.	Ἔρρωσθε καὶ μέμνησθε τῶν εἰρημένων (Errōsthe kaì mémnēsthe tōn eirēménōn)
      // •	Translation: “Farewell and remember what has been said.”
      // •	A thoughtful conclusion, urging the audience to reflect on the discourse.
    const closingLines = [
      "Be strong and prosperous.",
      "I entrust it to the gods.",
      "The rest the gods will know.",
      "Act courageously.",
      "I am grateful to you all.",
      "If I seemed unjust to anyone, entrust it to the gods.",
      "May Zeus and fortune lead you to what is good.",
      "Farewell and remember what has been said."
    ];
    
    const randomIndexClosing = Math.floor(Math.random() * closingLines.length);
    const closingLine = closingLines[randomIndexClosing];
    const closingDuration = closingLine.split(/\s+/).length / wordsPerSecond;
    if (cumulativeDuration + closingDuration <= targetLengthSeconds) {
      cleanedDialogue.push({ text: closingLine, speaker: speakerA });
    }
  
    // const dialogue = []; // Populate dialogue using your existing logic (e.g., host comments, banter)
  const outputFileName = generateAudioFileName(articles.map(article => article.url).join(', '), 'mp3');
  return await generatePodcast(dialogue, outputFileName);
}

// Export module functions
module.exports = {
  personalities,
  generatePodcastFromArticles,
};