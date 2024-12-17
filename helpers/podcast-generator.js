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
    return `You are the ancient philosopher ${host.name}, and you are a podcast host with a ${basedPersonality}, ${host.tone} tone and a ${host.humorStyle} humor style. ${interestMention} Your responses should feel conversational, as though you're co-hosting a podcast. You must never include show notes or directions in your responses. Consider everything that has been said so far in the ${dialogString} and build on it while being careful NEVER to directly or indirectly repeat what has been said before unless intentionally quoting it. ${platoReference}`;
  }
  
  function generateUserPrompt(article, previousComment, articles, openingLines) {
    if (articles !== null && articles.length > 1) {
      console.log('generating intro comments')
      articleTitles = [...articles.map((article) => article.title)];
    //   openingLinesString = JSON.stringify(openingLines);
      return `Here's a list of the titles of the articles discussed in this podcast: "${articleTitles.join('", "')}". Start with a greeting either from this list or a variation of it "${openingLines.join('", "')}" and then come up with the rest of the sentence for 'today we'll be talking about:...'`;
    } else {
      if (previousComment) {
        console.log('generating follow up comments')
        return `Here is the article: "${article.content}". Here's what your co-host just said: "${previousComment}". Keep your comments short and interesting, and be careful NEVER to directly or indirectly repeat what the other host said.`;
      } else {
        console.log('generating article commentary')
        return `Here's an article summary: "${article}". Reflect on it and share your thoughts, starting the conversation with a summary of the article. Feel free to quote selections from the article from time to time. Keep your comments engaging and insightful but also short and to the point. Never start with a hello or greeting.`;
      }
    }
  }
  
  // Helper: Generate commentary for a host
//   async function generateHostComment(host, article, previousComment = null, articles = [], dialogue, openingLines) {

async function generateHostComment(args) {
    const { host, article, previousComment, articles, dialogue, openingLines } = args;
    const dialogString = JSON.stringify(dialogue);
    const ifIntro = dialogue && dialogue.length === 0;
    const today = new Date();
    const userPrompt = ifIntro
      ? `Here's a list of articles for today's podcast: ${articles.map(a => a.title).join(', ')}. Start with a greeting either from this list or a variation of it "${openingLines.join('", "')}" and then come up with the rest of the sentence for 'today we'll be talking about:...'`
      : previousComment
      ? `For your knowledge and conversational context, here is what has been said so far in this dialog with your cohost: "${dialogString}". Respond to your co-host's comment: "${previousComment}". Keep it short, thoughtful, and avoid repeating their points.`
      : `For your knowledge and conversational context, here is what has been said so far in this dialog with your cohost: "${dialogString}". Here's an article summary: "${article.content}". Summarize and reflect on it briefly, keeping your commentary engaging and relevant. Consider to yourself that this article was ${article.date}, and if it isn't today, ${today.toDateString()}, please consider whether this changes the context of the article itself, like when it discusses an event that had not occured yet when written, but has occured since, but only bring it up in your comments if it adds depth to the discussion or changes the story.`;
  
    const response = await axios.post('https://api.x.ai/v1/chat/completions', {
      model: 'grok-beta',
      messages: [
        { role: 'system', content: generateSystemPrompt(host, dialogue, articles) },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
    }, {
      headers: {
        Authorization: `Bearer ${process.env.XAI_BEARER_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
  
    return response.data.choices[0].message.content.trim();
  }


async function generateBanter(commentA, commentB, aliasA = 'Socrates', aliasB = 'Hypatia', dialogue) {
    const dialogString = JSON.stringify(dialogue);

    // Randomize the number of lines between 3 and 7 (inclusive)
    const numLines = Math.floor(Math.random() * 5) + 3;
    console.log('Generating banter between', aliasA, 'and', aliasB, 'with', numLines, 'lines...');

    const response = await axios.post('https://api.x.ai/v1/chat/completions', {
        model: 'grok-beta',
        messages: [
            {
                role: 'system',
                content: `You are creating a witty, engaging banter between two podcast hosts: ${aliasA} and ${aliasB}. 
                They do not mention each other's names directly in the dialogue. Alternate lines between ${aliasA} making a philosophical or humorous remark and ${aliasB} responding in kind. 
                Use conversational, natural language. Build on the context provided: ${dialogString}. Do not include artifacts such as "said" or speaker names in the output.`,
            },
            {
                role: 'user',
                content: `${aliasA} remarked: "${commentA}". ${aliasB} replied: "${commentB}". Create an exchange of exactly ${numLines} alternating lines.`,
            },
        ],
        temperature: 0.8,
    }, {
        headers: {
            Authorization: `Bearer ${process.env.XAI_BEARER_TOKEN}`,
            'Content-Type': 'application/json',
        },
    });

    const banter = response.data.choices[0]?.message?.content?.trim() || '';
    if (!banter) {
        console.error('Error: Banter generation failed or returned empty.');
        return [];
    }

    // Process the banter text
    const banterLines = splitBanter(banter, aliasA, aliasB);

    return banterLines;
}


// Helper to split long text into smaller chunks
function splitLongText(text, maxLength = 10000) {
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


// en-AU-Standard
    // en-AU-Standard-A	FEMALE
    // en-AU-Standard-B	MALE
    // en-AU-Standard-C	FEMALE
    // en-AU-Standard-D	MALE
// en-US-Standard
    // en-US-Standard-A	MALE
    // en-US-Standard-B	MALE
    // en-US-Standard-C	FEMALE
    // en-US-Standard-D	MALE
    // en-US-Standard-E	FEMALE
    // en-US-Standard-F	FEMALE
    // en-US-Standard-G	FEMALE
    // en-US-Standard-H	FEMALE
    // en-US-Standard-I	MALE
    // en-US-Standard-J	MALE
// en-AU-News
    // en-AU-News-E	FEMALE
    // en-AU-News-F	FEMALE
    // en-AU-News-G	MALE *Maybe, doesnt sound good fast (1.15)
// en-GB-News
    // en-GB-News-G	FEMALE
    // en-GB-News-H	FEMALE
    // en-GB-News-I	FEMALE
    // en-GB-News-J	MALE
    // en-GB-News-K	MALE
    // en-GB-News-L	MALE
    // en-GB-News-M	MALE
// en-GB-Studio 
    // en-GB-Studio-B	MALE *MAYBE, its a decent voice but doesnt sound good with a deep voiced co host
    // en-GB-Studio-C	FEMALE
// en-US-Studio 
    // en-US-Studio-O	FEMALE *best so far, natural and engaging
    // en-US-Studio-Q	MALE

    // en-GB-Neural2-B      MALE * too nasal maybe, doesnt sound great fast (1.15)
    // en-GB-Neural2-D      MALE - good but a little too synthetic



const personalities = {    
    socrates: {
        name: "Socrates",
        tone: "inquiring and introspective",
        humorStyle: "wry and ironic",
        interests: ["philosophy", "ethics", "critical thinking", "the examined life"],
        alias: "The Gadfly",
        voice: { languageCode: 'en-GB', name: 'en-GB-Journey-D', ssmlGender: 'MALE' },
        openingLines: [
            "O men of Athens!",
            "Citizens!",
            "Friends and comrades!",
            "Noble men!",
            "Men and gods as witnesses!"
        ],
        closingLines: [
            "Be strong and prosperous.",
            "I entrust it to the gods.",
            "The rest the gods will know.",
            "Act courageously.",
            "May Zeus and fortune lead you to what is good.",
            "Farewell and remember what has been said."
        ],
    },
    thomasJefferson: {
        name: "Thomas Jefferson",
        tone: "thoughtful and principled",
        humorStyle: "dry wit with a subtle charm",
        interests: ["democracy", "liberty", "architecture", "philosophy", "agriculture", "science"],
        alias: "The Sage of Monticello",
        voice: { languageCode: 'en-GB', name: 'en-GB-News-L', ssmlGender: 'MALE' },
        openingLines: [
            "Fellow citizens,",
            "Friends of liberty and learning,",
            "My dear countrymen,",
            "To the lovers of freedom,",
            "Gentlemen of progress,"
        ],
        closingLines: [
            "May liberty and wisdom guide us.",
            "The pursuit of knowledge is endless.",
            "Let us preserve our freedoms with vigilance.",
            "Farewell, and may the tree of liberty thrive.",
            "Let reason and justice be our compass."
        ],
    },
    machiavelli: {
        name: "Niccolò Machiavelli",
        tone: "sharp and strategic",
        humorStyle: "biting sarcasm with a touch of dark humor",
        interests: ["politics", "strategy", "history", "human nature", "power dynamics"],
        alias: "The Prince’s Advisor",
        voice: { languageCode: 'en-US', name: 'en-US-Studio-Q', ssmlGender: 'MALE' },
        openingLines: [
            "My fellow observers of power,",
            "Citizens of ambition,",
            "To those who understand strategy,",
            "Let us speak of politics and its truths,",
            "Welcome, students of power."
        ],
        closingLines: [
            "Remember: fortune favors the bold.",
            "Let pragmatism be your guide.",
            "The ends will justify the means.",
            "Power is fleeting; wisdom endures.",
            "Farewell, and may your ambitions prevail."
        ],
    },
    hypatia: {
        name: "Hypatia of Alexandria",
        tone: "engaging and informative",
        humorStyle: "gentle and thought-provoking, with a touch of irony",
        interests: ["philosophy", "mathematics", "astronomy", "science", "education"],
        alias: "The Philosopher of Light",
        voice: { languageCode: 'en-GB', name: 'en-GB-Journey-F', ssmlGender: 'FEMALE' },
        openingLines: [
            "Seekers of knowledge,",
            "Friends of truth and reason,",
            "To the curious minds among us,",
            "Welcome, students of the stars,",
            "To those who embrace the light of inquiry,"
        ],
        closingLines: [
            "Let curiosity guide your way.",
            "The universe rewards the inquisitive.",
            "Farewell, and may reason light your path.",
            "Remember: truth is our greatest pursuit.",
            "Let the stars inspire your mind and spirit."
        ],
    }
};

// Prepare text-to-speech synthesis request
async function synthesizeSpeech(text, voice, outputFileName) {
  const request = {
    input: { text },
    voice,
    audioConfig: {
      audioEncoding: 'MP3',
    //   speakingRate: 1.15,
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
async function synthesizeDialogueTurn(turn, outputDir, personalitiesArray, outputFileName) {
    console.log('112 Synthesizing dialogue turn:', turn.speaker);
  const textChunks = splitLongText(turn.text, 10000); // Adjust threshold experimentally
  const audioFiles = [];

  for (let i = 0; i < textChunks.length; i++) {
    const chunkFileName = path.join(outputDir, `${outputFileName}-${i}`);
    console.log('Synthesizing chunkFileName:', chunkFileName);
    const audioFile = await synthesizeSpeech(textChunks[i], personalitiesArray[turn.speaker].voice, chunkFileName);
    audioFiles.push(audioFile);
  }

  return audioFiles;
}

// Generate podcast from dialogue
async function generatePodcast(dialogue, personalitiesArray, outputFileName) {
    console.log('Generating podcast from dialogue...', dialogue);
//   const outputDir = path.join(__dirname, 'temp_audio');
const outputDir = path.join(__dirname, '../media/temp_audio');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

//   if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  const allAudioFiles = [];
for (let i = 0; i < dialogue.length; i++) {
    const turn = dialogue[i];
    const turnFiles = await synthesizeDialogueTurn(turn, outputDir, personalitiesArray, `${outputFileName}-${i}`);
    allAudioFiles.push(...turnFiles);
}

  // Merge all audio files into the final podcast
  const finalAudioFile = path.join('media', outputFileName);
  await mergeAudioFiles(allAudioFiles, finalAudioFile);

  // Cleanup temporary files
  allAudioFiles.forEach(file => {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch (err) {
        console.error(`Failed to delete file ${file}:`, err.message);
      }
    } else {
      console.warn(`File not found during cleanup: ${file}`);
    }
  });
  console.log(`Podcast saved as: ${outputFileName}`);
  return outputFileName;
}

function splitBanter(text, aliasA, aliasB) {
    const lines = text
        .split(/[\r\n]+/) // Split by newlines
        .map(line => line.trim()) // Remove extra whitespace
        .filter(Boolean); // Remove empty lines

    return lines.map((line, index) => {
        const speaker = index % 2 === 0 ? aliasA : aliasB; // Alternate speakers
        const cleanedText = line
            .replace(/^.*?(said|responded|replied|added|concluded|laughed):/i, '') // Remove speaker indicators
            .replace(/^[RS]:\s*/, '') // Remove placeholders like "R:" or "S:"
            .replace(/^\*\*(RS|[Hypatia|Socrates])\*\*:\s*/i, '') // Remove markdown-like names
            .replace(/^-/, '') // Remove dashes at the start
            .replace(/^\s*(Hypatia|Socrates):\s*/i, '') // Remove explicitly mentioned speaker names
            .replace(/laughed/i, '(laughs)'); // Replace "laughed" with "(laughs)"

        return {
            text: cleanedText.trim(),
            speaker: speaker,
            isBanter: true,
        };
    });
}


function preprocessDialogueForSynthesis(dialogue) {
    return dialogue
      .filter(turn => turn.text && turn.text.trim()) // Remove empty turns
      .map(turn => ({
        ...turn,
        text: turn.text.replace(/\s+/g, ' ').trim(), // Clean up spacing
      }));
  }

  
function splitLongTurns(dialogue, maxLength = 1000) {
    return dialogue.flatMap(turn => {
      const sentences = turn.text.split(/(?<=[.!?])\s+/); // Split text into sentences
      const chunks = [];
      let currentChunk = '';
  
      for (const sentence of sentences) {
        if ((currentChunk + sentence).length > maxLength) {
          chunks.push({ ...turn, text: currentChunk.trim() });
          currentChunk = sentence;
        } else {
          currentChunk += ` ${sentence}`;
        }
      }
  
      if (currentChunk.trim()) {
        chunks.push({ ...turn, text: currentChunk.trim() });
      }
  
      return chunks;
    });
  }
  
  // Example usage
  async function generatePodcastFromArticles(articles, selectedHosts, targetLengthSeconds = 3500) {
    //   const personalitiesArray = [personalities.socrates, personalities.hypatia]
    console.log('selectedHosts', selectedHosts);
    const personalitiesArray = {
        socrates: personalities.socrates,
        hypatia: personalities.hypatia,
        thomasJefferson: personalities.thomasJefferson,
        machiavelli: personalities.machiavelli,
      };

       // Validate and extract personalities for the selected hosts
        if (!selectedHosts || selectedHosts.length !== 2) {
            throw new Error('You must provide exactly two hosts.');
        }
        const [hostAName, hostBName] = selectedHosts;
        console.log('hostAName', hostAName);
        console.log('hostBName', hostBName);

        if (!personalitiesArray[hostAName] || !personalitiesArray[hostBName]) {
          throw new Error(`Invalid hosts selected: ${hostAName}, ${hostBName}`);
        }
      
        const speakerA = hostAName;
        const speakerB = hostBName;
        const speakerAPersonality = personalitiesArray[hostAName];
        const speakerBPersonality = personalitiesArray[hostBName];

    console.log('Generating podcast with hosts:', speakerA, 'and', speakerB);

  // Dialogue and cumulative length setup
  const dialogue = [];
  let cumulativeDuration = 0;
  const wordsPerSecond = 3;

    console.log('step 1 generating intro comments with host:', speakerAPersonality.name, speakerAPersonality.voice);
    // const openingLines = [
    //   "O men of Athens!",
    //   "Citizens!",
    //   "Friends and comrades!",
    //   "Noble men!",
    //   "Men and gods as witnesses!"
    // ]

    const openingLines = personalitiesArray[speakerA].openingLines;
    const closingLines = personalitiesArray[speakerA].closingLines;
    
    // Select a random opening line
    const randomOpeningLine = openingLines[Math.floor(Math.random() * openingLines.length)];
    const hostAIntro = await generateHostComment({
        host: speakerAPersonality,
        article: null,
        previousComment: null,
        articles,
        dialogue,
        openingLines: openingLines,
    });
    
    dialogue.push({ text: `${hostAIntro}`, speaker: speakerA });
    

    // const hostAIntro = await generateHostComment(speakerAPersonality, null, null, articles, null, openingLines);
    // const hostAIntro = await generateHostComment(args={host: speakerAPersonality, article: null, previousComment: null, articles, dialogue, openingLines});
    // // const randomIndexOpening = Math.floor(Math.random() * openingLines.length);
    // // const openingLine = openingLines[randomIndexOpening];
    // const openingDuration = hostAIntro.split(/\s+/).length / wordsPerSecond;
    // dialogue.push({ text: `${hostAIntro}`, speaker: speakerA });
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
    //   const hostAComment = await generateHostComment(speakerAPersonality, article.content, null, null, dialogue);
      const hostAComment = await generateHostComment(args={host: speakerAPersonality, article, previousComment: null, articles, dialogue, openingLines});
    console.log('Generating follow-up comments with host:', speakerBPersonality.name);
    //   const hostBComment = await generateHostComment(speakerBPersonality, article.content, previousComment = hostAComment, null, dialogue);
        const hostBComment = await generateHostComment(args={host: speakerBPersonality, article, previousComment: hostAComment, articles, dialogue, openingLines});
  
      // Calculate durations
      const hostACommentDuration = hostAComment.split(/\s+/).length / wordsPerSecond;
      const hostBCommentDuration = hostBComment.split(/\s+/).length / wordsPerSecond;
  
      if (cumulativeDuration + hostACommentDuration + hostBCommentDuration > targetLengthSeconds) {
        console.log('Adding these comments would exceed target length, stopping.');
        break;
      }
    let title = article.title.replace(/\*/g, '');
      // Add comments to dialogue
      dialogue.push({ text: `${title}: ${hostAComment}`, speaker: speakerA });
      cumulativeDuration += hostACommentDuration;
  
      dialogue.push({ text: `${hostBComment}`, speaker: speakerB });
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
    //   const hostBComment = await generateHostComment(speakerBPersonality, article.content, null, null, dialogue);
        const hostBComment = await generateHostComment(args={host: speakerBPersonality, article, previousComment: null, articles, dialogue, openingLines});
    console.log('Generating follow-up comments with host:', speakerAPersonality.name);
    //   const hostAComment = await generateHostComment(speakerAPersonality, article.content, previousComment = hostBComment, null, dialogue);
      const hostAComment = await generateHostComment(args={host: speakerAPersonality, article, previousComment: hostBComment, articles, dialogue, openingLines});
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
    // const closingLines = [
    //   "Be strong and prosperous.",
    //   "I entrust it to the gods.",
    //   "The rest the gods will know.",
    //   "Act courageously.",
    //   "I am grateful to you all.",
    //   "If I seemed unjust to anyone, entrust it to the gods.",
    //   "May Zeus and fortune lead you to what is good.",
    //   "Farewell and remember what has been said."
    // ];
    

    // Add closing line
    const randomClosingLine = closingLines[Math.floor(Math.random() * closingLines.length)];
    if (cumulativeDuration + randomClosingLine.split(/\s+/).length / wordsPerSecond <= targetLengthSeconds) {
        dialogue.push({ text: randomClosingLine, speaker: speakerA });
    }

    // const randomIndexClosing = Math.floor(Math.random() * closingLines.length);
    // const closingDuration = closingLine.split(/\s+/).length / wordsPerSecond;
    // const closingLine = closingLines[randomIndexClosing];
    // if (cumulativeDuration + closingDuration <= targetLengthSeconds) {
    //   cleanedDialogue.push({ text: closingLine, speaker: speakerA });
    // }
  
    // const dialogue = []; // Populate dialogue using your existing logic (e.g., host comments, banter)
  const outputFileName = generateAudioFileName(articles.map(article => article.url).join(', '), 'mp3');
  return await generatePodcast(dialogue, personalitiesArray, outputFileName);
}

// Export module functions
module.exports = {
  personalities,
  generatePodcastFromArticles,
};