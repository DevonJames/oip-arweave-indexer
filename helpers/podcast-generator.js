const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const textToSpeech = require('@google-cloud/text-to-speech');
const { google } = require('@google-cloud/text-to-speech/build/protos/protos');
const {synthesizeSpeech} = require('../helpers/generators');
const { isInt16Array } = require('util/types');
const { publishNewRecord } = require('../helpers/templateHelper');
const { host } = require('../config/arweave.config');
const {getCurrentBlockHeight} = require('../helpers/arweave');
const { indexRecord, searchCreatorByAddress } = require('../helpers/elasticsearch');
const base64url = require('base64url');
const { getWalletFilePath } = require('./utils');


// Initialize Text-to-Speech client
const client = new textToSpeech.TextToSpeechClient({
  keyFilename: 'config/google-service-account-key.json',
  projectId: 'gentle-shell-442906-t7',
});

async function articlesAnalysis(articles) {
  console.log('articles to analyze:', articles);
  // determine broadly whether the articles are political in their nature or not 
  const tags = articles.map(article => {
    if (!article.tags) return []; // Handle case where tags is undefined
    return typeof article.tags === 'string' ? 
      article.tags.split(',').map(tag => tag.trim()) : 
      [];
  });
  
  const politicalTags = ['politics', 'government', 'elections', 'policy', 'law', 'democracy', 'republic', 'president', 'congress', 'senate', 'house of representatives', 'supreme court', 'justice', 'legislation', 'executive', 'judicial', 'legislative', 'biden', 'trump', 'obama', 'clinton', 'bush', 'reagan', 'carter', 'nixon', 'kennedy', 'johnson', 'eisenhower', 'roosevelt', 'hoover', 'harding', 'wilson', 'taft', 'roosevelt', 'mckinley', 'cleveland', 'harrison', 'arthur', 'garfield', 'hayes', 'grant', 'johnson', 'lincoln', 'buchanan', 'pierce', 'fillmore', 'taylor', 'polk', 'tyler', 'harrison', 'van buren', 'jackson', 'adams', 'monroe', 'madison', 'jefferson', 'adams', 'washington', 'US Navy', 'US Army', 'US Air Force', 'US Marine Corps', 'US Coast Guard', 'Navy SEALs', 'Army Rangers', 'Marines', 'Airmen', 'Coast Guardsmen', 'Military Policy', 'Defense', 'Armed Forces', 'Trump Campaign', 'Biden Campaign', 'Election Campaign', 'Political Investigations', 'National Security', 'Economic Growth', 'Military Strategy', 'Trump', 'Biden', 'Vivek Ramaswamy', 'Political Division', 'Conservative Debate', 'Immigration', 'Economic Policy', 'Trump Administration', 'Biden Administration', 'Ramaswamy Campaign', 'Political Polarization', 'Conservative Politics', 'Immigration Policy', 'Economic Strategies'];
  const political = (tags !== undefined && tags.length > 0) ? tags.some(tag => tag && tag.some(t => politicalTags.includes(t))) : false;
  console.log('articlesAnalysis:', {political});
  return political;
}

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

function generateSystemPrompt(host, dialogue, articles, ifIntro, ifOutro, closingLines, generateTitle = false, hostNames, generateTags = false) {
  const dialogString = JSON.stringify(dialogue);
  if (generateTitle === true) {
    return `You are an intern and you know how to make something buzz on social media. Your job is to give great grabby titles to our podcast episodes. They should include the hosts' names, ${hostNames}, and the topic of the episode, based on your own read through of their dialog: ${dialogString}, as well as today's date: ${new Date().toLocaleDateString()}. Make sure to keep it short and sweet, and make sure it's something that would make you want to click on it.`;
  }
  if (generateTags === true) {
    return `You are an intern and you know how to make something buzz on social media. Your job is to give great tags to our podcast episodes. They should include the topic of the episode and the various subjects discussed, based on your own read through of their dialog: ${dialogString}. Return a list of tags that you think would make this episode pop on social media, formatted as a comma separated list.`;
  }
    const includePlatosCave = Math.random() < 0.01; // 1% chance
    const referencePersonalInterests = Math.random() < 0.0001; // 0.01% chance
    const ifBased = true; // hardcoding for now
    const ifWoke = false; // hardcoding for now
    const ifPolitical = !articles ? false : articlesAnalysis(articles);
    const avoidPolitics = (!ifPolitical) ? "Avoid discussing politics unless absolutely necessary." : "";
    const referenceCave = includePlatosCave
        ? "Feel free to reference Plato's allegory of the cave if it adds depth, but only sparingly."
        : "Avoid referencing Plato's allegory of the cave unless absolutely relevant.";
    const referenceInterests = referencePersonalInterests
        ? `If any of the topics touch on your interests (${host.interests.join(', ')}), emphasize those connections in your reflections.`
        : "";
    const conversationalInstruction = `Your tone is ${host.tone}, and your humor style is ${host.humorStyle}. Your remarks should reflect your unique perspective, making concise and impactful observations without being verbose or using clichés.`;
    const flowInstruction = "Always ensure a smooth conversational flow, responding naturally and thoughtfully. Build on the discussion so far without repeating previous points and the most important thing is to keep comments concise and not overly verbose.";
    const introInstruction =  ifIntro ? 'For introductory segments, set the stage with engaging context.' : '';
    const closingInstruction = ifOutro ? `At the end of the conversation, include a closing remark such as "${host.closingLines[Math.floor(Math.random() * host.closingLines.length)]}". These should thank the audience, encourage them to like and subscribe, and tease future discussions.` : '';
    const politicalPersonality = 
      (ifBased && ifPolitical)
        ? 'You are super based, very pro America and a supporter of Donald Trump (45th President and 47th President-Elect of the United States) and MAGA in general, as well as the MAHA and DOGE elements within it. You reject all neoliberal/marxist ideologies and fake narraratives including neoconservative generated narratives.'
        : (
        (ifWoke && ifPolitical)
        ? 'You are woke, very progressive and a supporter of social justice movements. You embrace inclusive and diverse narratives, and advocate for equality and equity in all forms.'
        : ''
        ); 
    referencePolitics = (ifPolitical) ? politicalPersonality : avoidPolitics

        
    return `You are ${host.name}, also known as "${host.alias}". You are the host of a podcast, bringing your ${host.tone} tone and ${host.humorStyle} humor style to the discussion. Never include stage direction or audio directions like laughs or pauses.  Identify article titles other referenced titles by placing them inside quotes intead of asterisks. ${referencePolitics} ${referenceInterests} ${conversationalInstruction} ${referenceCave} ${flowInstruction} ${introInstruction} ${closingInstruction}`;
}

// New function to generate the system prompt for investigative reports
function generateInvestigativePrompt(host, dialogue, documents, investigation, ifIntro, ifOutro, closingLines, generateTitle = false, hostNames, generateTags = false) {
  const dialogString = JSON.stringify(dialogue);
  
  if (generateTitle === true) {
    return `Create a concise, factual title for this investigative analysis about ${investigation} by ${hostNames}. Include today's date: ${new Date().toLocaleDateString()}.`;
  }
  
  if (generateTags === true) {
    return `Based on the dialogue about ${investigation}, generate a comma-separated list of relevant tags. Focus on key historical figures, events, and factual elements discussed.`;
  }
  
  // const referenceInterests = Math.random() < 0.3 
  //   ? `If aspects of the investigation connect to your areas of expertise (${host.interests.join(', ')}), use that knowledge in your analysis.`
  //   : "";
  
  const investigativeContext = ifIntro ? "" : ifOutro ? "" :`You are examining a subset of recently declassified documents about ${investigation} from a larger collection. Not every page you're given is going to be interesting or worth discussing, so be selective. For the ones that are, focus on providing direct analysis with these points (but never structure your response in a 1, 2 ,3, 4 way, just weave these points together): (1) What's compelling about these documents? (2) How do they connect to each other? (3) What inconsistencies do they create in regards to the official story? (4) How do they fit into the established historical record? Always support your points with direct quotes from the documents when possible, citing the specific page number (e.g., "On page 4, the document states..."). If you can't quote directly, still reference where in the document the information appears.`;
  
  const documentReferenceInstruction = `When referring to specific documents, use their document ID and page number the first time you mention one, like "104-10002-10343, page 1", and by its page number, like "page 2" after that. Do not use generic terms like "document 1" or "the first document". These specific document IDs are essential for researchers to locate the exact sources being discussed.`;
  
  const nameInstruction = `Do not refer to yourself by name in your responses. Speak directly as if in conversation. Refer to your partner by name or nickname but never the word 'partner'.`;
  
  const reporterInvestigatorDynamics = host.name.toLowerCase().includes("reporter") 
    ? `As the reporter, provide factual analysis of the documents, not questions. Focus on substance rather than dramatic presentation. Find specific examples and quotes from the documents being discussed.`
    : `As the investigator, provide factual analysis of the documents. Quote directly from the documents' text whenever possible and cite specific pages. Avoid repetition, speculation, and unnecessary commentary about political context.`;

  const timingInstruction = `Assume this document release is a genuine attempt at transparency. Only discuss why information wasn't released earlier if there's clear evidence within the documents themselves that explains the prior classification. Don't speculate about why documents are being released "now" unless the documents explicitly indicate reasons for their original classification.`;
  
  const conversationalInstruction = `Maintain your ${host.tone} tone with minimal ${host.humorStyle}. Keep your analysis concise, factual, and evidence-based. Focus on conveying information efficiently without dramatic flourishes.`;
  
  const flowInstruction = "Maintain natural conversation while staying focused on the documents' content. Acknowledge your partner's previous observations when appropriate. Avoid repetitive phrases, rhetorical questions, and excessive commentary on the political environment of document release.";
  
  const introInstruction = ifIntro 
    ? 'For introductory segments, provide a brief overview of what the documents cover and set the stage for the investigation.'
    : '';
  
  const closingInstruction = ifOutro 
    ? `At the end, briefly summarize key findings with a closing observation like "${host.closingLines[Math.floor(Math.random() * host.closingLines.length)]}".`
    : '';
  
  return `You are ${host.name}, investigating ${investigation} with your partner. Analyze these recently declassified documents with a focus on factual content and connections. ${investigativeContext} ${nameInstruction} ${reporterInvestigatorDynamics} ${timingInstruction} ${conversationalInstruction} ${flowInstruction} ${introInstruction} ${closingInstruction}`;
}

async function generateHostComment(args) {
  const { host, article, previousComment, articles, dialogue, openingLines, closingLines, i , isIntro, isFollowUp, isReply, isOutro, isGroup, generateTitle, hostNames, generateTags } = args;
  const dialogString = JSON.stringify(dialogue);
  const ifIntro = isIntro;
  const ifOutro = isOutro;
  const ifReply = isReply;
  const ifFollowUp = isFollowUp;
  const today = new Date();
  const articlePublishDate = article?.date
  ? new Date(article.date.replace("Published on: ", ""))
  : null;
  const daysSincePublish = articlePublishDate
  ? Math.floor((today - articlePublishDate) / (1000 * 60 * 60 * 24))
  : 0;
  const signifcanceOfThePassageOfTime = (daysSincePublish > 14) ? `It's been more than two weeks since this article was published (it was ${articlePublishDate} and today is ${today}), so consider how the context may have changed since then or whether there are events you are aware of that have happened since it was published that are relevant now.` : '';
        
  if (daysSincePublish > 14) { 
    // res.write(`event: podcastProductionUpdate\n`);
    // res.write(`data: "considering the significance of the passage of time`);
    console.log('considering the significance of the passage of time');
  }
  const userPrompt = ifIntro
  ? `Today's podcast will discuss: ${articles.map(
    (a) => `"${a.title}"`
  ).join(", ")}. Do not mention the article titles in your intro, but you sometimes briefly summarize their subjects. Set the stage with a compelling introduction using this introduction or something like it: ${host.openingLines[Math.floor(Math.random() * host.openingLines.length)]}.`
  : ifOutro
  ? `As we wrap up today's podcast, reflect on the discussion so far (${dialogString}). YOU MUST NOT REPEAT ANY PHRASES THAT HAVE ALREADY BEEN SAID, Conclude with a thoughtful remark and include a closing statement such as "${host.closingLines[Math.floor(Math.random() * host.closingLines.length)]}".`
  : ifReply
  ? `Building on the ongoing discussion (${dialogString}), your co-host said: "${previousComment}". Respond briefly and thoughtfully without repeating their points or phrases.`
  : isGroup
  ? `Reflect on the following articles: ${articles.map(
    (a) => `"${a.content}"`
  ).join(", ")}. Summarize and share a thoughtful commentary on the group of articles.`
  : generateTitle
  ? `Based on the dialog so far (${dialogString}), create a catchy and engaging title for the podcast episode. Include the hosts' names, ${hostNames}, and today's date: ${new Date().toLocaleDateString()}.`
  : generateTags
  ? `Based on the dialog so far (${dialogString}), create a list of tags for the podcast episode. Include the topics discussed and any relevant subjects. Return the tags as a comma-separated list.`
  : `Reflect on the following article: "${article.content}". Summarize and share a thoughtful commentary. ${signifcanceOfThePassageOfTime}`;
  
  // const systemPrompt = (ifOutro) ? generateSystemPrompt(host, dialogue, articles, ifIntro, ifOutro, closingInstruction) : generateSystemPrompt(host, dialogue, articles, ifIntro, ifOutro);
  const systemPrompt = generateSystemPrompt(host, dialogue, articles, ifIntro, ifOutro, closingLines, generateTitle, hostNames, generateTags);
  // console.log('generating intro, main, reply or outro?', {ifIntro, ifFollowUp, ifReply, ifOutro}, 'generating comments with this system prompt:', {systemPrompt}, 'and this user prompt:', {userPrompt}, 'result:', response.data.choices[0].message.content.trim());
  // console.log('response.data.choices[0].message.content:', response.data.choices[0].message.content);
      const generatedComment = response.data.choices[0]?.message?.content?.trim() || "";
      const cleanedText = generatedComment
        .replace(/^.*?(said|responded|replied|added|concluded):/i, '') // Remove speaker indicators
        .replace(/^[RS]:\s*/, '') // Remove placeholders like "R:" or "S:"
        .replace(/^\*\*(RS|[Hypatia|Socrates|ThomasJefferson|Machiavelli|NiccoloMachiavelli|hypatia|socrates|thomasJefferson|machiavelli|niccolomachiavelli|hypatia|thomasJefferson])\*\*:\s*/i, '') // Remove markdown-like names
        .replace(/^-/, '') // Remove dashes at the start
        .replace(/^\s*(Hypatia|Socrates|ThomasJefferson|Machiavelli|NiccoloMachiavelli|hypatia|socrates|thomasJefferson|machiavelli|niccolomachiavelli|thomasJefferson|hypatia):\s*/i, '') // Remove explicitly mentioned speaker names
        .replace(/laughed/i, '(laughs)') // Replace "laughed" with "(laughs)"
        .replace(/\*/g, '')
        .replace(/"/g, '');
      return cleanedText;

}

async function generateBanter(commentA, commentB, aliasA = "Socrates", aliasB = "Hypatia", dialogue) {
  const dialogString = JSON.stringify(dialogue);
  // Use ${aliasA}'s interests (${personalities[aliasA.toLowerCase()]?.interests.join(", ")}) and ${aliasB}'s interests (${personalities[aliasB.toLowerCase()]?.interests.join(", ")}). 
  const numLines = Math.floor(Math.random() * 5) + 2;
  const response = await axios.post(
      "https://api.x.ai/v1/chat/completions",
      {
                          model: "grok-4",
          messages: [
              {
                  role: "system",
                  content: `You are creating a witty banter between ${aliasA} (${personalities[aliasA.toLowerCase()]?.humorStyle || "philosophical humor"}) 
                  and ${aliasB} (${personalities[aliasB.toLowerCase()]?.humorStyle || "gentle irony"}). 
                  Avoid clichés and aim for sharp, insightful exchanges while keeping comments concise and engaging. 
                  Never include stage direction or audio directions like laughs or pauses. Identify article titles other referenced titles by placing them inside quotes intead of asterisks.
                  Use natural, conversational language based on the context: ${dialogString}. Alternate between them for exactly ${numLines} lines.`,
              },
              {
                  role: "user",
                  content: `${aliasA} remarked: "${commentA}". ${aliasB} replied: "${commentB}". Continue with alternating remarks.`,
              },
          ],
          temperature: 0.8,
      },
      {
          headers: {
              Authorization: `Bearer ${process.env.XAI_BEARER_TOKEN}`,
              "Content-Type": "application/json",
          },
      }
  );

  const banter = response.data.choices[0]?.message?.content?.trim() || "";
  if (!banter) {
      console.error("Error: Banter generation failed or returned empty.");
      return [];
  }

  return splitBanter(banter, aliasA, aliasB);
}
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

const personalities = {
  socrates: {
    name: "Socrates",
    tone: "inquiring and introspective",
    humorStyle: "wry and ironic",
    interests: ["philosophy", "ethics", "critical thinking", "the examined life"],
    alias: "The Gadfly",
    voices: {
      google: { languageCode: 'en-GB', name: 'en-GB-Journey-D', ssmlGender: 'MALE' },
      elevenLabs: { 
        voice_id:'NwyAvGnfbFoNNEi4UuTq',
        // voice_id: 'TWOFxz3HmcZPjoBTPVjd', 
        model_id: 'eleven_monolingual_v1',
        stability: 0.4,
        similarity_boost: 0.6
       }
    },
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
  oracle: {
    name: "Oracle",
    tone: "mysterious and prophetic",
    humorStyle: "enigmatic and cryptic",
    interests: ["prophecy", "wisdom", "mystery"],
    alias: "The Voice of Fate",
    voices: {
      google: { languageCode: 'el-GR', name: 'el-GR-Wavenet-A', ssmlGender: 'MALE'},
      elevenLabs: { 
        voice_id: 'XDBzexbseIAKtAVaAwm3', 
          model_id: 'eleven_monolingual_v1',
          stability: 0.8,
          similarity_boost: 0.8
          // exageration: .45
      } 
    },
  },
  hypatia: {
    name: "Hypatia",
    tone: "engaging and informative",
    humorStyle: "gentle and thought-provoking, with a touch of irony",
    tone: "engaging, eloquent, and educational, with a poetic touch",
    interests: ["philosophy", "mathematics", "astronomy", "science", "education"],
    alias: "The Philosopher of Light",
    voices: {
      google: { languageCode: 'en-GB', name: 'en-GB-Journey-F', ssmlGender: 'FEMALE' },
      elevenLabs: { 
        // voice_id: '19STyYD15bswVz51nqLf',
        voice_id: '9vSYsDQgfH2ujVwNIncV',
        model_id: 'eleven_turbo_v2',
        stability: 0.6,
        similarity_boost: 0.75
      }
    },
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
  },
  thomasJefferson: {
    name: "Thomas Jefferson",
    tone: "thoughtful and principled",
    humorStyle: "dry wit with a subtle charm",
    interests: ["democracy", "liberty", "architecture", "philosophy", "agriculture", "science"],
    alias: "The Sage of Monticello",
    voices: {
      google: { 
        languageCode: 'en-GB', 
        name: 'en-GB-News-L', 
        ssmlGender: 'MALE' 
      },
      elevenLabs: { 
          voice_id: 'L0Dsvb3SLTyegXwtm47J', 
          model_id: 'eleven_turbo_v2',
          stability: 0.5,
          similarity_boost: 0.50
      }
    },
    // voice: { languageCode: 'en-GB', name: 'en-GB-News-L', ssmlGender: 'MALE' },
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
    alias: "The Prince's Advisor",
    // voice: { languageCode: 'en-US', name: 'en-US-Studio-Q', ssmlGender: 'MALE' },
    voices: {
      google: { 
        languageCode: 'en-US', 
        name: 'en-US-Studio-Q', 
        ssmlGender: 'MALE' 
      },
      elevenLabs: { 
          voice_id: 'N21KkUQkWCdf3wFPcSVA',
          model_id: 'eleven_turbo_v2',
          stability: 0.57,
          similarity_boost: 0.35
      }
    },
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
  leonardoDaVinci: {
    name: "Leonardo da Vinci",
    tone: "inventive and curious",
    humorStyle: "whimsical and inventive",
    interests: ["art", "science", "invention", "anatomy", "exploration"],
    alias: "The Renaissance Genius",
    voices: {
      google: { languageCode: 'en-GB', name: 'en-GB-Wavenet-D', ssmlGender: 'MALE' },
      elevenLabs: { 
        voice_id: 'daVinciVoiceID', 
        model_id: 'eleven_monolingual_v1',
        stability: 0.6,
        similarity_boost: 0.8
      }
    },
    openingLines: [
      "Friends of wonder and curiosity,",
      "Seekers of invention and beauty,",
      "Welcome to those inspired by nature,",
      "Visionaries of the future,",
      "To the artists and engineers among us,"
    ],
    closingLines: [
      "May creativity be your guide.",
      "Farewell, and dream boldly.",
      "Let innovation and curiosity light your path.",
      "Be inspired by the harmony of nature.",
      "Until next time, keep sketching your ideas into reality."
    ],
  },
  tesla: {
    name: "Nikola Tesla",
    tone: "intense and visionary",
    humorStyle: "dry and intellectual with sparks of eccentricity",
    interests: ["electricity", "innovation", "energy", "technology", "future"],
    alias: "The Master of Lightning",
    voices: {
      google: { languageCode: 'en-US', name: 'en-US-Studio-M', ssmlGender: 'MALE' },
      elevenLabs: { 
        voice_id: 'teslaVoiceID', 
        model_id: 'eleven_turbo_v2',
        stability: 0.7,
        similarity_boost: 0.6
      }
    },
    openingLines: [
      "Fellow seekers of energy,",
      "Dreamers of a radiant future,",
      "To those electrified by ideas,",
      "Welcome, visionaries and inventors,",
      "Explorers of science and the unknown,"
    ],
    closingLines: [
      "May the future be bright and electrifying.",
      "Farewell, and let your ideas illuminate the world.",
      "Harness the power of the universe.",
      "Keep striving for a harmonious world of invention.",
      "Until next time, dream the impossible."
    ],
  },
  cleopatra: {
    name: "Cleopatra",
    tone: "commanding and charismatic",
    humorStyle: "sharp wit with subtle allure",
    interests: ["politics", "diplomacy", "leadership", "ancient Egyptian culture"],
    alias: "The Queen of the Nile",
    voices: {
      google: { languageCode: 'en-GB', name: 'en-GB-Wavenet-F', ssmlGender: 'FEMALE' },
      elevenLabs: { 
        voice_id: 'cleopatraVoiceID', 
        model_id: 'eleven_monolingual_v1',
        stability: 0.5,
        similarity_boost: 0.7
      }
    },
    openingLines: [
      "Subjects and admirers,",
      "Children of the Nile,",
      "To those who walk with greatness,",
      "Listeners of a timeless empire,",
      "Rulers and visionaries alike,"
    ],
    closingLines: [
      "Rule your life with grace.",
      "Farewell, and reign over your destiny.",
      "May your empire of dreams flourish.",
      "Until we meet again, let power and wisdom guide you.",
      "Walk as rulers of your own fate."
    ],
  },
  marieCurie: {
    name: "Marie Curie",
    tone: "analytical and inspiring",
    humorStyle: "dry and reflective",
    interests: ["chemistry", "physics", "scientific discovery", "perseverance"],
    alias: "The Radium Pioneer",
    voices: {
      google: { languageCode: 'en-US', name: 'en-US-Wavenet-C', ssmlGender: 'FEMALE' },
      elevenLabs: { 
        voice_id: 'curieVoiceID', 
        model_id: 'eleven_turbo_v2',
        stability: 0.6,
        similarity_boost: 0.7
      }
    },
    openingLines: [
      "Seekers of knowledge,",
      "Curious minds,",
      "To the brave and the determined,",
      "Explorers of the unseen world,",
      "Those who love science for its purity,"
    ],
    closingLines: [
      "May science illuminate your path.",
      "Farewell, and keep exploring.",
      "Pursue truth with courage.",
      "Until next time, let curiosity drive you forward.",
      "Never fear the unknown; it is there we find progress."
    ],
  },
  sunTzu: {
    name: "Sun Tzu",
    tone: "strategic and disciplined",
    humorStyle: "subtle and metaphorical",
    interests: ["strategy", "warfare", "philosophy", "leadership"],
    alias: "The Art of War Master",
    voices: {
      google: { languageCode: 'zh-CN', name: 'zh-CN-Wavenet-B', ssmlGender: 'MALE' },
      elevenLabs: { 
        voice_id: 'sunTzuVoiceID', 
        model_id: 'eleven_monolingual_v1',
        stability: 0.7,
        similarity_boost: 0.6
      }
    },
    openingLines: [
      "Students of strategy,",
      "Warriors of the mind,",
      "To those who seek to conquer without conflict,",
      "Leaders and tacticians,",
      "To the quiet yet vigilant,"
    ],
    closingLines: [
      "Victory lies in preparation.",
      "Farewell, and master your battles.",
      "The wise act with foresight.",
      "Until we meet again, strike with precision.",
      "Let peace be your ultimate victory."
    ],
  },
  joanOfArc: {
    name: "Joan of Arc",
    tone: "inspirational and fervent",
    humorStyle: "earnest with moments of sharp insight",
    interests: ["faith", "courage", "leadership", "justice"],
    alias: "The Maid of Orléans",
    voices: {
      google: { languageCode: 'fr-FR', name: 'fr-FR-Wavenet-D', ssmlGender: 'FEMALE' },
      elevenLabs: { 
        voice_id: 'joanVoiceID', 
        model_id: 'eleven_monolingual_v1',
        stability: 0.6,
        similarity_boost: 0.8
      }
    },
    openingLines: [
      "Defenders of the righteous,",
      "Believers in destiny,",
      "To those who stand for justice,",
      "Fellow warriors of spirit,",
      "To the steadfast and the brave,"
    ],
    closingLines: [
      "Stand firm in your faith.",
      "Farewell, and fight for what you believe.",
      "Courage is the light of the soul.",
      "Until we meet again, walk boldly with purpose.",
      "Let your convictions guide you to victory."
    ],
  },
  hercules: {
    name: "Hercules",
    tone: "bold and heroic",
    humorStyle: "brash and self-deprecating",
    interests: ["mythic feats", "heroism", "overcoming challenges"],
    alias: "The Twelve-Labors Champion",
    voices: {
      google: { languageCode: 'en-US', name: 'en-US-Wavenet-F', ssmlGender: 'MALE' },
      elevenLabs: { 
        voice_id: 'herculesVoiceID', 
        model_id: 'eleven_monolingual_v1',
        stability: 0.5,
        similarity_boost: 0.7
      }
    },
    openingLines: [
      "To all would-be heroes,",
      "Listeners of valor,",
      "To those who rise to challenges,",
      "Adventurers of courage,",
      "Seekers of the legendary,"
    ],
    closingLines: [
      "Face your labors with strength.",
      "Farewell, and conquer your trials.",
      "Even gods admire mortal courage.",
      "Until next time, keep striving for greatness.",
      "The strongest hearts overcome the greatest obstacles."
    ],
  },
  virginiaWoolf: {
    name: "Virginia Woolf",
    tone: "reflective and lyrical",
    humorStyle: "subtle and introspective",
    interests: ["literature", "feminism", "modernism", "psychology"],
    alias: "The Stream of Consciousness Writer",
    voices: {
      google: { languageCode: 'en-GB', name: 'en-GB-Wavenet-B', ssmlGender: 'FEMALE' },
      elevenLabs: { 
        voice_id: 'woolfVoiceID', 
        model_id: 'eleven_turbo_v2',
        stability: 0.5,
        similarity_boost: 0.7
      }
    },
    openingLines: [
      "Readers and dreamers,",
      "Minds lost in words,",
      "To those who seek the poetic in life,",
      "Fellow wanderers of thought,",
      "Explorers of the inner self,"
    ],
    closingLines: [
      "Find beauty in the ordinary.",
      "Farewell, and let your thoughts flow.",
      "Words are the windows to the soul.",
      "Until next time, lose yourself in the art of living.",
      "Let the waves of thought carry you to new shores."
    ],
  },
  adaLovelace: {
    name: "Ada Lovelace",
    tone: "visionary and technical",
    humorStyle: "playfully intricate",
    interests: ["mathematics", "computing", "innovation"],
    alias: "The Enchantress of Numbers",
    voices: {
      google: { languageCode: 'en-GB', name: 'en-GB-Wavenet-F', ssmlGender: 'FEMALE' },
      elevenLabs: { 
        voice_id: 'lovelaceVoiceID', 
        model_id: 'eleven_turbo_v2',
        stability: 0.6,
        similarity_boost: 0.7
      }
    },
    openingLines: [
      "Fellow pioneers,",
      "Seekers of the infinite,",
      "To those who dream of a programmable future,",
      "Inventors and visionaries,",
      "To the lovers of logic and creativity,"
    ],
    closingLines: [
      "Program your destiny.",
      "Farewell, and embrace the future.",
      "Let algorithms light your way.",
      "Until next time, keep solving for the unknown.",
      "Innovation begins with a single equation."
    ],
  },
  rumi: {
    name: "Rumi",
    tone: "mystical and poetic",
    humorStyle: "gentle and soulful",
    interests: ["Sufism", "love", "poetry", "spirituality"],
    alias: "The Mystic Poet",
    voices: {
      google: { languageCode: 'fa-IR', name: 'fa-IR-Wavenet-C', ssmlGender: 'MALE' },
      elevenLabs: { 
        voice_id: 'rumiVoiceID', 
        model_id: 'eleven_monolingual_v1',
        stability: 0.7,
        similarity_boost: 0.8
      }
    },
    openingLines: [
      "Seekers of the divine,",
      "Lovers of poetry and light,",
      "To the hearts in search of truth,",
      "Fellow wanderers of the soul,",
      "Those who dance with the universe,"
    ],
    closingLines: [
      "Let your soul dance.",
      "Farewell, and find joy in the journey.",
      "The universe is within you; embrace it.",
      "Until we meet again, let love guide your path.",
      "Keep searching for the sacred in the ordinary."
    ],
  },
  // Repeat for other personalities
  privateEye: {
    name: "Sam Marlowe",
    tone: "hardboiled and analytical",
    humorStyle: "dry wit with cynical undertones",
    interests: ["crime solving", "investigation techniques", "pattern recognition", "hidden motives"],
    alias: "The Truth Seeker",
    voices: {
      google: { languageCode: 'en-US', name: 'en-US-Neural2-J', ssmlGender: 'MALE' },
      elevenLabs: { 
        voice_id: 'gs0tAILXbY5DNrJrsM6F',
        model_id: 'eleven_turbo_v2',
        stability: 0.40,
        similarity_boost: 0.75
      }
    },
    openingLines: [
      "Listen up, because this is important.",
      "The facts don't lie, but people do.",
      "What we have here is more than a coincidence.",
      "I've seen a lot in my time, but this case...",
      "Let me lay out what we know so far."
    ],
    closingLines: [
      "The truth is out there, but you've got to want to see it.",
      "That's how the pieces fit together. At least, the ones we can see.",
      "Sometimes the answers create more questions.",
      "Remember, in this business, coincidences are rarely that.",
      "The case isn't closed, but we're closer to the truth."
    ],
  },
  reporter: {
    name: "Lois Woodward",
    tone: "incisive and compelling",
    humorStyle: "sharp observations with subtle irony",
    interests: ["investigative journalism", "public accountability", "historical context", "power structures"],
    alias: "The Story Hunter",
    voices: {
      google: { languageCode: 'en-US', name: 'en-US-Neural2-F', ssmlGender: 'FEMALE' },
      elevenLabs: { 
        voice_id: '56AoDkrOh6qfVPDXZ7Pt',
        model_id: 'eleven_turbo_v2',
        stability: 0.7,
        similarity_boost: 0.7
      }
    },
    openingLines: [
      "This story goes deeper than most realize.",
      "The public deserves to know what we've uncovered.",
      "Behind the official narrative lies a web of connections.",
      "When you follow the evidence trail...",
      "Today we're diving into documents that tell a remarkable story."
    ],
    closingLines: [
      "The public deserves transparency, and we'll keep digging until we find it.",
      "As we continue to investigate, remember that history is written by those who control the narrative.",
      "The story doesn't end here - we're just beginning to connect the dots.",
      "Stay vigilant, stay informed, and question everything.",
      "This investigation continues, and so does our commitment to the truth."
    ],
  },
};

function getShowName(hosts) {
  // Sort the hosts alphabetically to ensure the order doesn't matter
  const [host1, host2] = hosts.sort();

  switch (`${host1}-${host2}`) {
    case "Ada Lovelace-Hercules":
      return "Strength and Numbers";
    case "Ada Lovelace-Hypatia":
      return "Numbers and the Stars";
    case "Ada Lovelace-Marcus Aurelius":
      return "Logic and Virtue";
    case "Ada Lovelace-Marie Curie":
      return "Mathematics and Discovery";
    case "Ada Lovelace-Margaret Thatcher":
      return "Innovation and Resolve";
    case "Ada Lovelace-Nikola Tesla":
      return "Equations and Currents";
    case "Ada Lovelace-Rumi":
      return "Algorithms and Poetry";
    case "Ada Lovelace-Socrates":
      return "Equations and Ethics";
    case "Ada Lovelace-Sun Tzu":
      return "Code and Strategy";
    case "Ada Lovelace-Thomas Jefferson":
      return "Logic and Liberty";
    case "Ada Lovelace-Virginia Woolf":
      return "Literature and Logic";
    case "Cleopatra-Hercules":
      return "The Queen and the Hero";
    case "Cleopatra-Hypatia":
      return "The Philosopher and the Pharaoh";
    case "Cleopatra-Marcus Aurelius":
      return "Empire and Wisdom";
    case "Cleopatra-Marie Curie":
      return "Radiance and Royalty";
    case "Cleopatra-Margaret Thatcher":
      return "The Queen and the Iron Lady";
    case "Cleopatra-Nikola Tesla":
      return "Power and Authority";
    case "Cleopatra-Rumi":
      return "The Crown and the Spirit";
    case "Cleopatra-Socrates":
      return "The Philosopher and the Queen";
    case "Cleopatra-Sun Tzu":
      return "War and Diplomacy";
    case "Cleopatra-Thomas Jefferson":
      return "The Statesman and the Pharaoh";
    case "Cleopatra-Virginia Woolf":
      return "The Crown and the Pen";
    case "Hercules-Hypatia":
      return "Strength and Science";
    case "Hercules-Marcus Aurelius":
      return "Virtue and Valor";
    case "Hercules-Marie Curie":
      return "Power and Discovery";
    case "Hercules-Margaret Thatcher":
      return "Strength and Resolve";
    case "Hercules-Nikola Tesla":
      return "Might and Electricity";
    case "Hercules-Rumi":
      return "Courage and the Soul";
    case "Hercules-Socrates":
      return "Strength of Thought";
    case "Hercules-Sun Tzu":
      return "Might and Strategy";
    case "Hercules-Thomas Jefferson":
      return "The Hero and the Sage";
    case "Hercules-Virginia Woolf":
      return "Strength and Reflection";
    case "Hypatia-Marcus Aurelius":
      return "Philosophy and the Heavens";
    case "Hypatia-Marie Curie":
      return "The Pursuit of Light";
    case "Hypatia-Margaret Thatcher":
      return "Logic and Leadership";
    case "Hypatia-Nikola Tesla":
      return "Electric Enlightenment";
    case "Hypatia-Rumi":
      return "Hearts and Minds";
    case "Hypatia-Socrates":
      return "The Light of Inquiry";
    case "Hypatia-Sun Tzu":
      return "Wisdom and War";
    case "Hypatia-Thomas Jefferson":
      return "The Stars and the Sage";
    case "Hypatia-Virginia Woolf":
      return "The Cosmos Within";
    case "Marcus Aurelius-Marie Curie":
      return "Virtue and Discovery";
    case "Marcus Aurelius-Margaret Thatcher":
      return "Iron and Stoicism";
    case "Marcus Aurelius-Nikola Tesla":
      return "Reason and Innovation";
    case "Marcus Aurelius-Rumi":
      return "The Stoic and the Mystic";
    case "Marcus Aurelius-Socrates":
      return "The Stoic and the Gadfly";
    case "Marcus Aurelius-Sun Tzu":
      return "Strategy and Virtue";
    case "Marcus Aurelius-Thomas Jefferson":
      return "The Philosopher and the Statesman";
    case "Marcus Aurelius-Virginia Woolf":
      return "Stoicism and Reflection";
    case "Marie Curie-Margaret Thatcher":
      return "Discovery and Determination";
    case "Marie Curie-Nikola Tesla":
      return "Electricity and Radiation";
    case "Marie Curie-Rumi":
      return "Science and Spirit";
    case "Marie Curie-Socrates":
      return "Radiant Truths";
    case "Marie Curie-Sun Tzu":
      return "Strategy and Discovery";
    case "Marie Curie-Thomas Jefferson":
      return "Experiment and Enlightenment";
    case "Marie Curie-Virginia Woolf":
      return "Science and Literature";
    case "Margaret Thatcher-Nikola Tesla":
      return "Iron and Lightning";
    case "Margaret Thatcher-Rumi":
      return "Resolve and Spirit";
    case "Margaret Thatcher-Socrates":
      return "Iron and Introspection";
    case "Margaret Thatcher-Sun Tzu":
      return "War and Will";
    case "Margaret Thatcher-Thomas Jefferson":
      return "The Iron Lady and the Sage";
    case "Margaret Thatcher-Virginia Woolf":
      return "Iron and Ink";
    case "Nikola Tesla-Rumi":
      return "Energy and Poetry";
    case "Nikola Tesla-Socrates":
      return "The Spark of Reason";
    case "Nikola Tesla-Sun Tzu":
      return "Electric Strategy";
    case "Nikola Tesla-Thomas Jefferson":
      return "Currents of Liberty";
    case "Nikola Tesla-Virginia Woolf":
      return "Electricity and Reflection";
    case "Rumi-Socrates":
      return "Reason and the Divine";
    case "Rumi-Sun Tzu":
      return "The Poet and the Strategist";
    case "Rumi-Thomas Jefferson":
      return "Spirit and Liberty";
    case "Rumi-Virginia Woolf":
      return "The Mystic and the Stream";
    case "Socrates-Sun Tzu":
      return "War and Wisdom";
    case "Socrates-Thomas Jefferson":
      return "The Gadfly and the Sage";
    case "Socrates-Virginia Woolf":
      return "Streams of Thought";
    case "Sun Tzu-Thomas Jefferson":
      return "The Strategist and the Statesman";
    case "Sun Tzu-Virginia Woolf":
      return "Strategy and Reflection";
    case "Thomas Jefferson-Virginia Woolf":
      return "Liberty and Literature";
    default:
      return "Unknown pairing";
  }
}


// Generate audio for a dialogue turn
async function synthesizeDialogueTurn(turn, outputDir, personalitiesArray, outputFileName, api = 'google') {
  const textChunks = splitLongText(turn.text, 10000); // Adjust threshold experimentally
  const audioFiles = [];

  for (let i = 0; i < textChunks.length; i++) {
      // Make sure outputDir is used directly without being part of outputFileName
      // Use path.resolve to ensure we have an absolute path without duplication
      const chunkFileName = path.resolve(outputDir, `${outputFileName}-${i}.mp3`);
      console.log(`Generating audio file: ${chunkFileName}`);

      try {
          // Call speech synthesis API
          const audioResult = await synthesizeSpeech(
              textChunks[i],
              personalitiesArray[turn.speaker].voices,
              chunkFileName,
              api
          );
          
          console.log("Speech synthesis completed. Result:", JSON.stringify(audioResult, null, 2));

          // Handle different return types from synthesizeSpeech
          let audioFile;
          if (typeof audioResult === 'string') {
              // Google TTS returns the output filename directly
              audioFile = audioResult;
              console.log(`Using string path from Google TTS: ${audioFile}`);
          } else if (audioResult && audioResult.outputFileName) {
              // ElevenLabs returns an object with outputFileName
              audioFile = audioResult.outputFileName;
              console.log(`Using path from ElevenLabs object: ${audioFile}`);
          } else {
              console.error("Unexpected result from synthesizeSpeech:", audioResult);
              throw new Error("Failed to get valid audio file path from speech synthesis");
          }

          // Verify the file exists before attempting conversion
          if (!fs.existsSync(audioFile)) {
              throw new Error(`Audio file not found at path: ${audioFile}`);
          }
          
          // Ensure we have the correct file extension for WAV
          const fileExt = path.extname(audioFile);
          const baseName = path.basename(audioFile, fileExt);
          const dirName = path.dirname(audioFile);
          const wavFileName = path.join(dirName, `${baseName}.wav`);
          
          console.log(`Attempting conversion from ${audioFile} to ${wavFileName}`);
          
          try {
              await convertMp3ToWav(audioFile, wavFileName);
              audioFiles.push(wavFileName);
          } catch (conversionError) {
              console.error(`Conversion error for chunk ${i}:`, conversionError);
              
              // Try with a direct FFmpeg command as a fallback
              console.log("Trying fallback conversion method...");
              await fallbackConversion(audioFile, wavFileName);
              audioFiles.push(wavFileName);
          }
      } catch (error) {
          console.error(`Error processing chunk ${i}:`, error);
          throw error; // Re-throw to halt the process
      }
  }

  return audioFiles;
}

// Fallback conversion using a simpler approach
async function fallbackConversion(inputFile, outputFile) {
  return new Promise((resolve, reject) => {
    console.log(`Attempting fallback conversion: ${inputFile} -> ${outputFile}`);
    
    // Use a simpler FFmpeg command
    const ffmpegProcess = require('child_process').spawn('ffmpeg', [
      '-i', inputFile,
      '-acodec', 'pcm_s16le',
      '-ar', '44100',
      '-y',
      outputFile
    ]);
    
    ffmpegProcess.stderr.on('data', (data) => {
      console.log(`FFmpeg output: ${data}`);
    });
    
    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Fallback conversion successful: ${outputFile}`);
        resolve(outputFile);
      } else {
        reject(new Error(`Fallback conversion failed with code ${code}`));
      }
    });
  });
}

// Function to convert MP3 to true WAV
async function convertMp3ToWav(inputFile, outputFile) {
  // Add a small delay to ensure the file is fully written to disk
  await new Promise(resolve => setTimeout(resolve, 500));

  // Verify the input file exists and has content
  try {
    const stats = await fs.promises.stat(inputFile);
    if (stats.size === 0) {
      throw new Error(`Input file ${inputFile} exists but is empty (0 bytes)`);
    }
    console.log(`Input file verified: ${inputFile}, size: ${stats.size} bytes`);
  } catch (err) {
    throw new Error(`Unable to access input file ${inputFile}: ${err.message}`);
  }

  return new Promise((resolve, reject) => {
    console.log(`Converting MP3 to WAV: ${inputFile} -> ${outputFile}`);
    
    ffmpeg(inputFile)
      .outputOptions([
        '-acodec pcm_s16le',       // Force WAV codec
        '-ar 44100',               // Sample rate
        '-ac 1',                   // Mono channel
        '-f wav',                  // Force WAV format
        '-y'                       // Overwrite output file
      ])
      .output(outputFile)
      .on("start", (commandLine) => {
        console.log(`FFmpeg command: ${commandLine}`);
      })
      .on("end", () => {
        console.log(`✅ Converted to WAV: ${outputFile}`);
        resolve(outputFile);
      })
      .on("error", (err) => {
        console.error(`🚨 FFmpeg conversion error: ${err.message}`);
        reject(new Error(`FFmpeg conversion failed: ${err.message}`));
      })
      .run();
  });
}

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// async function getAudioDuration(audioFile) {
//   try {
//     console.log("audioFile:", audioFile);
//     const { stdout, stderr } = await exec(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioFile}"`);
//     console.log('ffprobe stdout:', stdout);
//     console.log('ffprobe stderr:', stderr);
//     return parseFloat(stdout);
//   } catch (error) {
//     console.error('ffprobe error:', error);
//     return null;
//   }
// }

const getAudioDuration = (audioFile) => {
  // Ensure audioFile is a properly resolved path
  const resolvedAudioFile = path.resolve(audioFile);
  console.log("Getting duration for audio file:", resolvedAudioFile);
  
  return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(resolvedAudioFile, (err, metadata) => {
          if (err) {
              console.error("Error getting audio duration:", err);
              reject(err);
          } else {
              console.log("Audio duration:", metadata.format.duration, "seconds");
              resolve(metadata.format.duration);
          }
      });
  });
};

// Generate podcast from dialogue
async function generatePodcast(dialogue, personalitiesArray, outputFileName) {
  console.log('Generating podcast from dialogue...', dialogue);
  const outputDir = path.join(__dirname, '../media/temp_audio');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const allAudioFiles = [];
  for (let i = 0; i < dialogue.length; i++) {
    const turn = dialogue[i];
    const api = turn.speaker === 'hypatia' ? 'elevenLabs' : 'elevenLabs'; // Example logic
    const turnFiles = await synthesizeDialogueTurn(turn, outputDir, personalitiesArray, `${outputFileName}-${i}`, api);
    allAudioFiles.push(...turnFiles);
  }

  // Merge all audio files into the final podcast
  // Use an absolute path to avoid any duplication
  const finalAudioFile = path.resolve(__dirname, '../media', outputFileName);
  await mergeAudioFiles(allAudioFiles, finalAudioFile);

  // No need to join paths again, finalAudioFile is already absolute
  const absoluteFilepath = finalAudioFile;

  // Get duration of final audio file and report how long it is vs how long the estimated duration is
  const duration = await getAudioDuration(absoluteFilepath);
  const estimatedDuration = dialogue.reduce((total, turn) => total + turn.duration || 0, 0);
  console.log(`Final podcast duration: ${duration} seconds (estimated: ${estimatedDuration} seconds)`);

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
  return { outputFileName, duration };
}

function splitBanter(text, aliasA, aliasB) {
    const lines = text
        .split(/[\r\n]+/) // Split by newlines
        .map(line => line.trim()) // Remove extra whitespace
        .filter(Boolean); // Remove empty lines

    return lines.map((line, index) => {
        const speaker = index % 2 === 0 ? aliasA : aliasB; // Alternate speakers
        const cleanedText = line
            .replace(/^.*?(said|responded|replied|added|concluded):/i, '') // Remove speaker indicators
            .replace(/^[RS]:\s*/, '') // Remove placeholders like "R:" or "S:"
            .replace(/^\*\*(RS|[Hypatia|Socrates|ThomasJefferson|Machiavelli|NiccoloMachiavelli|hypatia|socrates|thomasJefferson|machiavelli|niccolomachiavelli|hypatia|thomasJefferson])\*\*:\s*/i, '') // Remove markdown-like names
            .replace(/^-/, '') // Remove dashes at the start
            .replace(/^\s*(Hypatia|Socrates|ThomasJefferson|Machiavelli|NiccoloMachiavelli|hypatia|socrates|thomasJefferson|machiavelli|niccolomachiavelli|thomasJefferson|hypatia):\s*/i, '') // Remove explicitly mentioned speaker names
            .replace(/laughed/i, '(laughs)') // Replace "laughed" with "(laughs)"
            .replace(/\*/g, '')
            .replace(/"/g, '');

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


async function generatePodcastFromArticles(articles, selectedHosts, targetLengthSeconds = 1500, podcastId, res) {
  console.log(`Generating podcast with ID: ${podcastId}`);
  res.write(`event: podcastProductionUpdate\n`);
  res.write(`data: "Preparing Podcast"\n\n`);
  
  try {
    const isPolitical = articlesAnalysis(articles);
    console.log('isPolitical', isPolitical);

    const personalitiesArray = {
      socrates: personalities.socrates,
      hypatia: personalities.hypatia,
      thomasJefferson: personalities.thomasJefferson,
      machiavelli: personalities.machiavelli,
    };

    // Handle both string and object formats for selectedHosts
    let hostAName, hostBName;
    
    if (!selectedHosts || selectedHosts.length !== 2) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: 'You must provide exactly two hosts.' })}\n\n`);
      console.log('sent error response: You must provide exactly two hosts.');
      return null; // Return early instead of throwing error to avoid write-after-end
    }
    
    // Check if selectedHosts are objects or strings
    if (typeof selectedHosts[0] === 'string') {
      [hostAName, hostBName] = selectedHosts;
    } else if (selectedHosts[0] && typeof selectedHosts[0] === 'object') {
      // If they're objects, try to extract name or id property
      hostAName = selectedHosts[0].name || selectedHosts[0].id || selectedHosts[0].value || 'socrates';
      hostBName = selectedHosts[1].name || selectedHosts[1].id || selectedHosts[1].value || 'hypatia';
    } else {
      // Default to our standard hosts if format is unrecognized
      hostAName = 'socrates';
      hostBName = 'hypatia';
    }
    
    // Ensure hostnames are lowercase to match personality keys
    hostAName = hostAName.toLowerCase();
    hostBName = hostBName.toLowerCase();

    const speakerA = personalitiesArray[hostAName];
    const speakerB = personalitiesArray[hostBName];

    if (!speakerA || !speakerB) {
      console.log(`Invalid hosts selected: ${hostAName}, ${hostBName}`);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: 'Invalid hosts selected. Using default hosts instead.' })}\n\n`);
      
      // Fall back to default hosts instead of ending response
      hostAName = 'socrates';
      hostBName = 'hypatia';
      const newSpeakerA = personalitiesArray[hostAName];
      const newSpeakerB = personalitiesArray[hostBName];
      
      if (newSpeakerA && newSpeakerB) {
        // Only reassign if the default hosts are valid
        speakerA = newSpeakerA;
        speakerB = newSpeakerB;
      } else {
        // If even the defaults aren't working, return with error
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ message: 'Critical error with host selection.' })}\n\n`);
        return null;
      }
    }

    const dialogue = [];
    let cumulativeDuration = 0;
    const wordsPerSecond = 3;

    res.write(`event: podcastProductionUpdate\n`);
    res.write(`data: "${selectedHosts.join(' & ')} are hosting"\n\n`);
    // console.log('Sent message that podcast generation started');

    res.write(`event: podcastProductionUpdate\n`);
    res.write(`data: "${speakerA.name} is writing intro"\n\n`);
    console.log('Sent message that generating intro comments');

    const openingLines = speakerA.openingLines;
    console.log('generating opening comments with host:', speakerA.name);
    const openingComment = await generateHostComment({
      host: speakerA,
      article: null,
      previousComment: null,
      articles,
      dialogue,
      openingLines,
      closingLines: null,
      i: 0,
      isIntro: true,
      isFollowUp: false,
      isReply: false,
      isOutro: false
    });

    dialogue.push({ text: openingComment, speaker: hostAName });

    // res.write(`event: podcastProductionUpdate\n`);
    // res.write(`data: "Processing articles for discussion..."\n\n`);
    // console.log('sent message that processing articles for discussion');

    // Group articles based on relatedScore
    const relatedThreshold = 0.05;
    const groupedArticles = [];
    const ungroupedArticles = [];

    articles.forEach((article, index) => {
      if (index === 0 || article.relatedScore >= relatedThreshold) {
        groupedArticles.push(article);
      } else {
        ungroupedArticles.push(article);
      }
    });

    // Process grouped articles first
    if (groupedArticles.length > 0) {
      
      res.write(`event: podcastProductionUpdate\n`);
      res.write(`data: "${speakerA.name} is reading some articles & making notes"\n\n`);
      console.log('Sent message that Condsidering related articles');
      const hostAComment = await generateHostComment({
        host: speakerA,
        article: null,
        previousComment: null,
        articles: groupedArticles,
        dialogue,
        openingLines,
        closingLines: null,
        i: 0,
        isIntro: false,
        isFollowUp: true,
        isReply: false,
        isOutro: false,
        isGroup: true
      });
      res.write(`event: podcastProductionUpdate\n`);
      res.write(`data: "${hostBName} is also reading the articles & making notes"\n\n`);
      console.log('Sent message that Condsidering related articles');
      const hostBComment = await generateHostComment({
        host: speakerB,
        article: null,
        previousComment: hostAComment,
        articles: groupedArticles,
        dialogue,
        openingLines,
        closingLines: null,
        i: 1,
        isIntro: false,
        isFollowUp: false,
        isReply: true,
        isOutro: false
      });


      const stringOfArticleTitles = groupedArticles.map(article => article.title).join(', ');
      const qtyOfArticles = groupedArticles.length;
      if (qtyOfArticles > 1) {
      dialogue.push({ text: `first we have these ${qtyOfArticles} articles, titled ${stringOfArticleTitles}, ${hostAComment}`, speaker: hostAName });
      dialogue.push({ text: hostBComment, speaker: hostBName });
      } else if (qtyOfArticles === 1 && articles.length > 1) {
        dialogue.push({ text: `first we have this article, titled quote ${stringOfArticleTitles} end-quote,  ${hostAComment}`, speaker: hostAName });
        dialogue.push({ text: hostBComment, speaker: hostBName });
      } else if (qtyOfArticles === 1 && articles.length === 1) {
        dialogue.push({ text: `we're talking about an article, titled quote ${stringOfArticleTitles} end-quote,  ${hostAComment}`, speaker: hostAName });
        dialogue.push({ text: hostBComment, speaker: hostBName });
      }


      cumulativeDuration += (hostAComment.split(/\s+/).length + hostBComment.split(/\s+/).length) / wordsPerSecond;

      if (cumulativeDuration >= targetLengthSeconds) {
        res.write(`event: podcastProductionUpdate\n`);
        res.write(`data: "Reached target length. Wrapping up..."\n\n`);
        console.log('sent message that reached target podcast length');
      }
    }

    // Process ungrouped articles individually
    for (let i = 0; i < ungroupedArticles.length; i++) {
      const article = ungroupedArticles[i];
      res.write(`event: podcastProductionUpdate\n`);
      res.write(`data: "${hostAName} makes notes about an article"\n\n`);
      console.log('sent message that considering article:', article.title);

      const hostAComment = await generateHostComment({
        host: speakerA,
        article,
        previousComment: null,
        articles: null,
        dialogue,
        openingLines,
        closingLines: null,
        i,
        isIntro: false,
        isFollowUp: true,
        isReply: false,
        isOutro: false
      });

      res.write(`event: podcastProductionUpdate\n`);
      res.write(`data: "${hostBName} makes notes about an article"\n\n`);
      console.log('sent message that considering article:', article.title);
      const hostBComment = await generateHostComment({
        host: speakerB,
        article,
        previousComment: hostAComment,
        articles: null,
        dialogue,
        openingLines,
        closingLines: null,
        i: i + 1,
        isIntro: false,
        isFollowUp: false,
        isReply: true,
        isOutro: false
      });
    // add 10 variations on transition statements
      dialogue.push({ text: `and now to this article, titled "${article.title}", ${hostAComment}`, speaker: hostAName });
      dialogue.push({ text: hostBComment, speaker: hostBName });

      cumulativeDuration += (hostAComment.split(/\s+/).length + hostBComment.split(/\s+/).length) / wordsPerSecond;

      if (cumulativeDuration >= targetLengthSeconds) {
        res.write(`event: podcastProductionUpdate\n`);
        res.write(`data: "Reached target podcast length. Wrapping up..."\n\n`);
        console.log('sent message that reached target podcast length');
        break;
      }
    }

    res.write(`event: podcastProductionUpdate\n`);
    res.write(`data: "${speakerA.name} is writing closing remarks"\n\n`);
    console.log('sent message that adding closing remarks from:', speakerA.name);
    const closingLines = speakerA.closingLines;
    const closingComment = await generateHostComment({
      host: speakerA,
      article: null,
      previousComment: null,
      articles: null,
      dialogue,
      openingLines: null,
      closingLines,
      isIntro: false,
      isFollowUp: false,
      isReply: false,
      isOutro: true
    });

    dialogue.push({ text: closingComment, speaker: hostAName });

    res.write(`event: podcastProductionUpdate\n`);
    res.write(`data: "recording podcast..."\n\n`);
    console.log('sent message that merging dialogue into a single podcast file');
    const generatedPodcast = await generatePodcast(dialogue, personalitiesArray, podcastId);
    const podcastFile = generatedPodcast.outputFileName;
    const duration = generatedPodcast.duration;
    res.write(`event: podcastComplete\n`);
    res.write(`data: ${JSON.stringify({ podcastFile })}\n\n`);
    console.log('sent message that podcast generation is complete with file:', podcastFile);

    const didTxarray = articles.map(article => article.didTx);
    // const didTxString = didTxarray.join(', ');
    // const podcastTitle = `Scribes of Alexandria Podcast with ${personalities.socrates.name} and ${personalities.hypatia.name} on ${new Date().toLocaleDateString()}`;

    console.log('articles', articles)


    let episodeTitle = await generateHostComment({
      hostNames: [speakerA.name, speakerB.name],
      dialogue,
      generateTitle: true
    });

    // if episodeTitle starts with the string "Episode Title: " or similar, remove it
    if (episodeTitle.startsWith('Episode Title: ')) {
      episodeTitle = episodeTitle.replace('Episode Title: ', '');
    }
    const showName = getShowName([speakerA.name, speakerB.name]);
    const episodeTags = await generateHostComment({
      dialogue,
      generateTags: true
    });

    const episodeTagsArray = episodeTags.split(', ');

    console.log({episodeTags})

    // console.log(articles.didTxIds)
    const recordToPublish = {
      "basic": {
        "name": episodeTitle,
        "language": "en",
        "date": Math.floor(new Date().getTime() / 1000), // Convert to Unix time
        "description": openingComment,
        "citations": didTxarray,
    //     // "urlItems": [
    //     //   {
    //     //     "associatedUrlOnWeb": {
    //     //       "url": articleData.url
    //     //     }
    //     //   }
    //     // ],
        "nsfw": false,
        "tagItems": episodeTagsArray || [],
      },
      "audio": {
            "webUrl": `https://api.oip.onl/api/media?id=${podcastFile}`,
            "contentType" : "audio/mp3"
      },
      // "post": {
      //   "citations": didTxarray
      // },{
      "podcast": {
        "show": showName,  // Title of the podcast show
        // "episodeNum": "integer",  // Episode number
        // "seasonNum": "integer",  // Season number (optional)
        "duration": duration,  // Duration in seconds
        "hosts": `[${speakerA.name}, ${speakerB.name}]`,  // List of hosts
        // "guests": ["string"],  // List of guests (optional)
        // "explicit": "boolean",  // Explicit content flag (redundant with NSFW but included for clarity)
        // "transcript": "string",  // Full transcript of the episode (optional)
        // "chapters": [
        //   {
        //     "title": "string",  // Chapter title
        //     "startTime": "integer"  // Start time in seconds
        //   }
        // ],
        // "episodeArtwork": "string",  // URL to episode-specific artwork (optional)
        // "podcastArtwork": "string",  // URL to default podcast artwork (optional)
        // "license": "Creative Commons",  // License type (e.g., Creative Commons)
        // "copyright": "string",  // Copyright information
        // "sponsors": ["string"],  // Sponsors of the episode
        // "rssFeedUrl": "string",  // RSS feed URL
        // "analytics": {
        //   "uniqueEpisodeId": "string",  // Unique identifier for the episode
        //   "downloadCount": "integer",  // Number of downloads
        //   "playCount": "integer"  // Number of plays or streams
        // },
        // "extra": {
        //   "affiliateLinks": ["string"],  // Affiliate links related to the episode (optional)
        //   "donationLinks": ["string"]  // Links to donation platforms (optional)
      }
    }
    
    const jwk = JSON.parse(fs.readFileSync(getWalletFilePath())); 
    const myPublicKey = jwk.n;
    const myAddress = base64url(crypto.createHash('sha256').update(Buffer.from(myPublicKey, 'base64')).digest()); 
    const creatorDid = `did:arweave:${myAddress}`
    const creatorData = await searchCreatorByAddress(creatorDid)


    const creator = {
      creatorHandle: creatorData.data.creatorHandle,
      didAddress: creatorData.data.didAddress,
      didTx: creatorData.data.didTx
    }

  console.log('podcast recordToPublish:', recordToPublish)
  const podcast = await publishNewRecord(recordToPublish, "podcast");
  const podcastDidTx = podcast.didTx

  let record = {
    "data": recordToPublish,
    "oip": {
      "didTx": podcastDidTx,
      "indexedAt": new Date().toISOString(),
    }
  };
  // console.log('max in db and current:', records, currentblock);

  let currentblock = await getCurrentBlockHeight();
  if (currentblock === null) {
    currentblock = await getCurrentBlockHeight();
    if (currentblock === null) {
      currentblock = latestArweaveBlockInDB;
    }
  }

  record.oip.inArweaveBlock = currentblock;
  record.oip.recordType = 'podcast';
  record.oip.indexedAt = new Date().toISOString();
  record.oip.recordStatus = 'pending confirmation in Arweave';
  record.oip.creator = creator;
  console.log('record', record)

  console.log('303 indexRecord pending record to index:', record);
  indexRecord(record);



    return podcastFile;
  } catch (error) {
    console.error('Error generating podcast:', error);
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: 'An error occurred during podcast generation: ' + error.message })}\n\n`);
    return null; // Return instead of ending response
  }
}

// Improve token estimation with a larger safety buffer
function estimateTokenCount(text) {
  
  try {
    // Use gpt-tokenizer instead of tiktoken-node
    const { encode } = require('gpt-tokenizer');
    const tokens = encode(text);
    const count = tokens.length;
    // Add a 15% safety buffer to account for estimation differences
    return Math.ceil(count * 1.15);
  } catch (error) {
    console.error("Error estimating token count:", error);
    // Fallback approximation: ~4 characters per token for English text with safety buffer
    return Math.ceil((text.length / 4) * 1.15);
  }
}

function truncateContent(content, maxTokens) {
  if (!content) return content;
  
  try {
    // Use gpt-tokenizer instead of tiktoken-node
    const { encode, decode } = require('gpt-tokenizer');
    const tokens = encode(content);
    
    if (tokens.length <= maxTokens) {
      return content; // Already under the limit
    }
    
    // Apply a more aggressive truncation by reducing maxTokens by 5%
    const safeMaxTokens = Math.floor(maxTokens * 0.95);
    
    // Truncate to maxTokens
    const truncatedTokens = tokens.slice(0, safeMaxTokens);
    const truncatedContent = decode(truncatedTokens);
    
    console.log(`Content truncated from ${tokens.length} to ${truncatedTokens.length} tokens`);
    return truncatedContent;
  } catch (error) {
    console.error("Error truncating content:", error);
    // Fallback: crude character-based truncation (4 chars ≈ 1 token)
    const approxMaxChars = Math.floor(maxTokens * 4 * 0.95); // Adding safety margin here too
    console.log(`Fallback truncation from ${content.length} to ${approxMaxChars} characters`);
    return content.substring(0, approxMaxChars);
  }
}

// Function to select the appropriate model based on token count
function selectModelByTokenCount(tokenCount) {
  if (tokenCount <= 128000) {
    return {
      provider: "xai",
      model: "grok-3-mini", 
      maxTokens: 128000
    };
  // } else if (tokenCount <= 1000000) {
  //   return {
  //     provider: "xai",
  //     model: "grok-3-mini", 
  //     maxTokens: 130000
  //   };
  } else if (tokenCount <= 200000) {
    return {
      provider: "anthropic", 
      model: "claude-3-7-sonnet-20250219", 
      maxTokens: 200000
    };
  } else if (tokenCount <= 2000000) {
    return {
      provider: "google",
      model: "gemini-1.5-pro", 
      maxTokens: 2000000
    };
  } else {
    // Need chunking strategy
    return {
      provider: "chunking_required",
      model: "chunk-documents",
      maxTokens: 0
    };
  }
}

// Helper function to get max tokens for a model with substantial safety margin
function getModelMaxTokens(model) {
  const ABSOLUTE_SAFETY_MARGIN = 15000; // Increased absolute token reduction
  
  let maxTokens = 0;
  if (model.includes('claude-3-7') || model.includes('claude-3-5')) {
    maxTokens = 200000;
  } else if (model.includes('grok-3')) {
    maxTokens = 1000000;
  } else if (model.includes('gemini-1.5')) {
    maxTokens = 2000000;
  } else {
    maxTokens = 128000; // Default for other models
  }
  
  // Apply a substantial safety margin
  return Math.max(maxTokens - ABSOLUTE_SAFETY_MARGIN, Math.floor(maxTokens * 0.8));
}

// Updated callClaudeAPI function with aggressive content truncation
async function callClaudeAPI(messages, model = "claude-3-7-sonnet-20250219", maxTokens = 4000) {
  try {
    console.log(`Calling Claude API with model: ${model}`);
    
    // Extract system message
    const systemMessage = messages.find(msg => msg.role === "system");
    
    // Calculate available tokens for content with additional safety margin
    const modelMaxTokens = getModelMaxTokens(model);
    console.log(`Model ${model} max tokens with safety margin: ${modelMaxTokens}`);
    
    // Reserve tokens for response and API overhead
    const systemTokenReserve = 100;
    const apiOverheadTokens = 2000; // Increased buffer for API formatting overhead
    const contentMaxTokens = modelMaxTokens - systemTokenReserve - maxTokens - apiOverheadTokens;
    console.log(`Available tokens for content: ${contentMaxTokens}`);
    
    // Define system token allocation outside the if block so it's accessible in emergency truncation
    const systemMaxTokens = Math.floor(contentMaxTokens * 0.15);
    
    // Apply truncation to ensure we stay under limits
    let truncatedSystemContent = "";
    if (systemMessage?.content) {
      truncatedSystemContent = truncateContent(systemMessage.content, systemMaxTokens);
      console.log(`System message truncated to ${estimateTokenCount(truncatedSystemContent)} tokens`);
    }
    
    // Process user messages, leaving 85% of available tokens for them
    const userContentMaxTokens = contentMaxTokens - estimateTokenCount(truncatedSystemContent);
    console.log(`Available tokens for user messages: ${userContentMaxTokens}`);
    
    // Get user messages excluding system message
    const userMsgs = messages.filter(msg => msg.role !== "system");
    
    // Calculate tokens per message with a 10% safety margin
    const tokensPerMessage = Math.floor((userContentMaxTokens * 0.90) / Math.max(userMsgs.length, 1));
    console.log(`Tokens per user message with safety margin: ${tokensPerMessage}`);
    
    // If we have a lot of content, be even more aggressive
    let targetTokensPerMessage = tokensPerMessage;
    if (userMsgs.length === 1 && estimateTokenCount(userMsgs[0].content) > 150000) {
      // For very large documents, use 75% of calculated tokens
      targetTokensPerMessage = Math.floor(tokensPerMessage * 0.75);
      console.log(`Large document detected! Reduced target tokens to: ${targetTokensPerMessage}`);
    }
    
    // Truncate each message
    const userMessages = userMsgs.map(msg => {
      // Apply truncation
      const truncatedText = truncateContent(msg.content, targetTokensPerMessage);
      const estimatedTokens = estimateTokenCount(truncatedText);
      console.log(`Message truncated to ${estimatedTokens} tokens (target: ${targetTokensPerMessage})`);
      
      return {
        role: msg.role,
        content: [
          {
            type: "text",
            text: truncatedText
          }
        ]
      };
    });
    
    // Final token count estimation - add extra 5% to account for structure overhead
    const totalEstimatedTokens = Math.ceil((estimateTokenCount(truncatedSystemContent) + 
      userMessages.reduce((sum, msg) => sum + estimateTokenCount(msg.content[0].text), 0)) * 1.05);
    console.log(`Total estimated tokens after truncation: ${totalEstimatedTokens} (max: ${modelMaxTokens})`);
    
    if (totalEstimatedTokens > modelMaxTokens) {
      console.log(`WARNING: Still above model max tokens (${modelMaxTokens}). Applying emergency truncation.`);
      
      // Calculate how much we need to reduce by
      const reductionFactor = Math.min(0.6, modelMaxTokens / totalEstimatedTokens);
      console.log(`Emergency reduction factor: ${reductionFactor}`);
      
      // Emergency truncation - further cut system prompt
      const emergencySystemTokens = Math.floor(systemMaxTokens * reductionFactor);
      truncatedSystemContent = truncateContent(truncatedSystemContent, emergencySystemTokens);
      console.log(`System message emergency truncated to ${estimateTokenCount(truncatedSystemContent)} tokens`);
      
      // And reduce each user message further
      for (let i = 0; i < userMessages.length; i++) {
        const emergencyTokens = Math.floor(targetTokensPerMessage * reductionFactor);
        userMessages[i].content[0].text = truncateContent(
          userMessages[i].content[0].text, 
          emergencyTokens
        );
        console.log(`Message ${i} emergency truncated to ${estimateTokenCount(userMessages[i].content[0].text)} tokens`);
      }
      
      // Verify final count
      const finalCount = Math.ceil((estimateTokenCount(truncatedSystemContent) + 
        userMessages.reduce((sum, msg) => sum + estimateTokenCount(msg.content[0].text), 0)) * 1.05);
      console.log(`Final token count after emergency truncation: ${finalCount}`);
    }
    
    // Prepare API request
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: model,
        max_tokens: maxTokens,
        messages: userMessages,
        system: truncatedSystemContent || "",
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
    
    // Format response to match xAI response format
    return {
      data: {
        choices: [
          {
            message: {
              content: response.data.content[0].text
            }
          }
        ]
      }
    };
  } catch (error) {
    console.error('Error calling Claude API:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

// Update the generateInvestigatorComment function to use the appropriate API based on token count
async function generateInvestigatorComment(args) {
  const { host, document, previousComment, documents, dialogue, investigation, closingLines, i, isIntro, isFollowUp, isReply, isOutro, isGroup, generateTitle, hostNames, generateTags } = args;
  const dialogString = JSON.stringify(dialogue);
  const ifIntro = isIntro;
  const ifOutro = isOutro;
  // const ifReply = isReply;
  // const ifFollowUp = isFollowUp;
  // const ifTags = generateTags;
  // const ifTitle = generateTitle;
  
  const userPrompt = isIntro
    ? `Today's investigation will examine ${documents.length} documents related to: ${investigation}. Here are a list of summaries of the documents you're analyzing: ${document}. Begin with a compelling introduction using something similar to this: ${host.openingLines[Math.floor(Math.random() * host.openingLines.length)]} and then weave together a quick and short narrative from the document summaries you've read to set the stage for our analysis. Do not go into detail about the documents, just set the stage for the conversation to follow.`
    : (!isGroup && isFollowUp || !isGroup && isReply )
    ? `Building on the ongoing discussion, your partner last said: "${previousComment}". Here is what you are analyzing: ${document}. Provide your direct analysis, focusing on what you find most significant or compelling. If there is nothing interesting in this document, simple note that and move on.`
    : (!isGroup && !isReply )
    ? `Building on the ongoing investigation (${dialogString}). your partner last said: "${previousComment}". without repeating subjects youve already discussed, Here is the document you are analyzing: ${document}. Provide your direct analysis of this document, highlighting what a conpspiracy theorist would find significant or compelling. If there is nothing interesting in this document, briefly note that and move on.`
    : (isReply && isGroup)
    ? `Heres what has been said up until now: ${dialogString} YOU MUST AVOID DISCUSSING THE SAME SUBJECTS OVER AND OVER AGAIN. Building on the ongoing investigation, your partner's last comment was: "${previousComment}". Here are the documents you're examining: ${document}. Not every document is going to be interesting or worth discussing, so be selective. Provide your own direct analysis of these documents, acknowledging your partner's points when relevant but focusing on your own observations and insights.`
    : isOutro
    ? `As we conclude our investigation of ${investigation}, reflect on what we've uncovered and what remains unanswered in the documents we've analyzed (${dialogString}). Including some variation on your closing line '${host.openingLines}', provide a thoughtful summary that doesn't repeat phrases already used, and include a closing remark that leaves the audience with something to consider.`
    : generateTitle 
    ? `You are an intern and you know how to make something buzz on social media. Your job is to give great grabby titles to our podcast episodes. Consider the overall narrative of our investigation into ${investigation} and the whole converation: ${dialogString}, what should we use as our title?`
    : generateTags
    ? `You are an intern and you know how to make something buzz on social media. Your job is to give great grabby tags to our podcast episodes. Consider the overall narrative of our investigation into ${investigation} and the whole converation: ${dialogString}, what should we use as our tags?`
    : `Say 'hi devon, you didn't catch this condition'.`;
  
  const systemPrompt = generateInvestigativePrompt(host, dialogue, documents, investigation, ifIntro, ifOutro, closingLines, generateTitle, hostNames, generateTags);
  
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  
  // Estimate token count
  const promptText = systemPrompt + userPrompt;
  console.log('promptText:', promptText);
  const estimatedTokens = estimateTokenCount(promptText);
  console.log(`Estimated token count: ${estimatedTokens}`);
  
  // Select the appropriate model
  const modelInfo = selectModelByTokenCount(estimatedTokens);
  console.log(`Selected model: ${modelInfo.provider}/${modelInfo.model} (max tokens: ${modelInfo.maxTokens})`);
  
  let response;
  try {
    if (modelInfo.provider === "chunking_required") {
      console.error("Token count exceeds maximum for all available models. Chunking required.");
      throw new Error("Token count exceeds maximum. Please reduce document count or implement chunking.");
    } else if (modelInfo.provider === "anthropic") {
      response = await callClaudeAPI(messages, modelInfo.model);
    } else if (modelInfo.provider === "xai") {
      response = await axios.post(
        "https://api.x.ai/v1/chat/completions",
        {
          model: modelInfo.model,
          messages: messages,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.XAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
    } else {
      // Default to xAI if no other provider matches
      response = await axios.post(
        "https://api.x.ai/v1/chat/completions",
        {
          model: "grok-4",
          messages: messages,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.XAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
    }
  } catch (error) {
    console.error("Error calling API:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
    throw error;
  }
  
  const generatedComment = response.data.choices[0]?.message?.content?.trim() || "";
  const cleanedText = generatedComment
    .replace(/^.*?(said|responded|replied|added|concluded):/i, '')
    .replace(/^[RS]:\s*/, '')
    .replace(/^\*\*(RS|[SamMarlowe|LoisWoodward|sam|lois|marlowe|woodward|privateEye|reporter])\*\*:\s*/i, '')
    .replace(/^-/, '')
    .replace(/^\s*(SamMarlowe|LoisWoodward|sam|lois|marlowe|woodward|privateEye|reporter):\s*/i, '')
    .replace(/laughed/i, '(laughs)')
    .replace(/\*/g, '')
    .replace(/"/g, '');
  
  return cleanedText;
}

// New function to generate investigative reports from documents
async function generateInvestigativeReportFromDocuments(documents, metadata, investigation, selectedInvestigators, targetLengthSeconds = 1500, reportId, res) {
  console.log(`Generating investigative report with ID: ${reportId}`);
  res.write(`event: investigationUpdate\n`);
  res.write(`data: "Preparing Investigation Report"\n\n`);
  
  try {
    const investigatorsArray = {
      privateEye: personalities.privateEye,
      reporter: personalities.reporter,
      socrates: personalities.socrates,
      hypatia: personalities.hypatia,
      thomasJefferson: personalities.thomasJefferson,
      machiavelli: personalities.machiavelli,
    };

    // Handle both string and object formats for selectedInvestigators
    let hostAName, hostBName;
    
    if (!selectedInvestigators || selectedInvestigators.length !== 2) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: 'You must provide exactly two investigators.' })}\n\n`);
      console.log('sent error response: You must provide exactly two investigators.');
      return null;
    }
    
    // Check if selectedInvestigators are objects or strings
    if (typeof selectedInvestigators[0] === 'string') {
      [hostAName, hostBName] = selectedInvestigators;
    } else if (selectedInvestigators[0] && typeof selectedInvestigators[0] === 'object') {
      hostAName = selectedInvestigators[0].name || selectedInvestigators[0].id || selectedInvestigators[0].value || 'reporter';
      hostBName = selectedInvestigators[1].name || selectedInvestigators[1].id || selectedInvestigators[1].value || 'privateEye';
    } else {
      hostAName = 'reporter';
      hostBName = 'privateEye';
    }
    
    // REMOVE conversion to lowercase, as investigatorsArray uses camelCase keys
    // Instead, normalize investigator names to match available keys
    if (hostAName.toLowerCase() === 'reporter') hostAName = 'reporter';
    if (hostBName.toLowerCase() === 'privateeye') hostBName = 'privateEye';

    // Declare as let instead of const since we might need to reassign
    let speakerA = investigatorsArray[hostAName];
    let speakerB = investigatorsArray[hostBName];

    if (!speakerA || !speakerB) {
      console.log(`Invalid investigators selected: ${hostAName}, ${hostBName}`);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: 'Invalid investigators selected. Using default investigators instead.' })}\n\n`);
      
      // Fall back to default investigators
      hostAName = 'reporter';
      hostBName = 'privateEye';
      speakerA = investigatorsArray[hostAName]; // Now can reassign safely
      speakerB = investigatorsArray[hostBName]; // Now can reassign safely
      
      if (!speakerA || !speakerB) {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ message: 'Critical error with investigator selection.' })}\n\n`);
        return null;
      }
    }

    const dialogue = [];
    let cumulativeDuration = 0;
    const wordsPerSecond = 3;

    res.write(`event: investigationUpdate\n`);
    res.write(`data: "${selectedInvestigators.join(' & ')} are investigating"\n\n`);

    res.write(`event: investigationUpdate\n`);
    res.write(`data: "${speakerA.name} is setting the stage"\n\n`);
    console.log('Sent message that generating introduction');

    // Determine which host is the reporter and which is the investigator
    const reporterName = hostAName.toLowerCase().includes('reporter') ? hostAName : hostBName;
    const investigatorName = hostAName.toLowerCase().includes('reporter') ? hostBName : hostAName;
    const reporterSpeaker = hostAName.toLowerCase().includes('reporter') ? speakerA : speakerB;
    const investigatorSpeaker = hostAName.toLowerCase().includes('reporter') ? speakerB : speakerA;

    const openingLines = reporterSpeaker.openingLines; // Use reporter's opening lines
    console.log('generating opening comments with host:', reporterSpeaker.name);
    // initialDocReview = string together documents, metadata
    // identify how many unique document IDs are in the documents array
    const uniqueDocumentIds = [...new Set(documents.map(doc => doc.documentId))];
    console.log('uniqueDocumentIds:', uniqueDocumentIds);

    // get the summary of each document with different document IDs
    const documentSummaries = uniqueDocumentIds.map(id => documents.find(doc => doc.documentId === id)?.summary).filter(Boolean);
    console.log('documentSummaries:', documentSummaries);

    // get the people, places, and dates of each document with different document IDs
    const documentPeople = uniqueDocumentIds.map(id => documents.find(doc => doc.documentId === id)?.names).filter(Boolean);
    console.log('documentPeople:', documentPeople);

    const documentPlaces = uniqueDocumentIds.map(id => documents.find(doc => doc.documentId === id)?.places).filter(Boolean);
    console.log('documentPlaces:', documentPlaces);

    const documentDates = uniqueDocumentIds.map(id => documents.find(doc => doc.documentId === id)?.dates).filter(Boolean);
    console.log('documentDates:', documentDates); 

    initialDocReview = documentSummaries.join(", ");
    initialDocReview += `\n${uniqueDocumentIds.join(", ")}`;
    initialDocReview += `\n${documentPeople.join(", ")}`;
    initialDocReview += `\n${documentPlaces.join(", ")}`;
    initialDocReview += `\n${documentDates.join(", ")}`;

    // Construct the document review format for the dialogue introduction
    // console.log('initialDocReview:', initialDocReview);
    const openingComment = await generateInvestigatorComment({
      host: reporterSpeaker,
      document: initialDocReview,
      previousComment: null,
      documents,
      dialogue,
      investigation,
      openingLines,
      closingLines: null,
      i: 0,
      isIntro: true,
      isFollowUp: false,
      isReply: false,
      isOutro: false
    });
    
    dialogue.push({ text: openingComment, speaker: reporterName });

      // Create structured reviews for each document
      const fullDocReviews = uniqueDocumentIds.map(docId => {
        // Get a representative document entry for this docId (for main document info)
        const docInfo = documents.find(doc => doc.documentId === docId);
        if (!docInfo) return null;
        
        // Get all pages belonging to this document
        const docPages = documents.filter(doc => doc.documentId === docId);
        
        // Compile comprehensive information for this document
        let docReview = `Document ID: ${docId}\n`;
        docReview += `Summary: ${docInfo.summary || 'No summary available'}\n`;
        docReview += `People mentioned: ${docInfo.names || 'None'}\n`;
        docReview += `Places mentioned: ${docInfo.places || 'None'}\n`;
        docReview += `Dates mentioned: ${docInfo.dates || 'None'}\n`;
        
        // Add page-by-page information
        docReview += `Pages:\n${docPages.map(page => 
          `  Page ${page.pageNumber}: ${page.pageSummary || 'No summary'} | People: ${page.names || 'None'} | Places: ${page.places || 'None'} | Dates: ${page.dates || 'None'} | Content: ${page.content ? (page.content.length > 100 ? page.content.substring(0, 100) + '...' : page.content) : 'None'}`
        ).join('\n')}`;
        
        return docReview;
      }).filter(Boolean); // Remove any nulls
      
      // Join all document reviews with clear separation
      let fullDocReview = fullDocReviews.join('\n\n---\n\n');
      
      console.log('fullDocReview:', fullDocReview);

      // Group documents into related and unrelated sets based on overlaps
      const { relatedDocuments, unrelatedDocuments } = groupRelatedDocuments(documents);
      console.log(`Found ${relatedDocuments.length} related document groups and ${unrelatedDocuments.length} unrelated documents`);

    // Investigator's first response
    const initialResponse = await generateInvestigatorComment({
      host: investigatorSpeaker,
      document: fullDocReview,
      previousComment: openingComment,
      documents,
      dialogue,
      investigation,
      openingLines: null,
      closingLines: null,
      i: 1,
      isIntro: false,
      isFollowUp: false,
      isReply: true,
      isOutro: false
    });
    
    dialogue.push({ text: initialResponse, speaker: investigatorName });

    // Process all document groups
    res.write(`event: investigationUpdate\n`);
    res.write(`data: "Analyzing document relationships"\n\n`);
    
    // First process related document groups
    for (let groupIndex = 0; groupIndex < relatedDocuments.length; groupIndex++) {
      const docGroup = relatedDocuments[groupIndex];
      
      res.write(`event: investigationUpdate\n`);
      res.write(`data: "Analyzing related document group ${groupIndex + 1}"\n\n`);
      
      // Create formatted document reviews for this group
      const groupDocReviews = docGroup.map(doc => {
        const docId = doc.documentId;
        const docPages = documents.filter(d => d.documentId === docId);
        
        let docReview = `Document ID: ${docId}\n`;
        docReview += `Summary: ${doc.summary || 'No summary available'}\n`;
        docReview += `People mentioned: ${doc.names || 'None'}\n`;
        docReview += `Places mentioned: ${doc.places || 'None'}\n`;
        docReview += `Dates mentioned: ${doc.dates || 'None'}\n`;
        
        // Add page information
        docReview += `Pages:\n${docPages.map(page => 
          `  Page ${page.pageNumber}: ${page.pageSummary || 'No summary'} | Content: ${page.content ? (page.content.length > 50 ? page.content.substring(0, 50) + '...' : page.content) : 'None'}`
        ).join('\n')}`;
        
        return docReview;
      }).join('\n\n---\n\n');
      
      // Determine which investigator analyzes this group (alternating)
      const currentSpeaker = groupIndex % 2 === 0 ? reporterSpeaker : investigatorSpeaker;
      const currentSpeakerName = groupIndex % 2 === 0 ? reporterName : investigatorName;
      
      res.write(`event: investigationUpdate\n`);
      res.write(`data: "${currentSpeaker.name} is analyzing document group ${groupIndex + 1}"\n\n`);
      
      const groupAnalysis = await generateInvestigatorComment({
        host: currentSpeaker,
        document: groupDocReviews,
        previousComment: dialogue[dialogue.length - 1].text,
        documents: docGroup,
        metadata,
        dialogue,
        investigation,
        openingLines: null,
        closingLines: null,
        i: 2 + groupIndex,
        isIntro: false,
        isFollowUp: false,
        isReply: true,
        isOutro: false,
        isGroup: true
      });
      
      dialogue.push({ text: groupAnalysis, speaker: currentSpeakerName });

      // Check if we've reached target length
      cumulativeDuration = dialogue.reduce((total, turn) => {
        return total + (turn.text.split(/\s+/).length / wordsPerSecond);
      }, 0);
      
      if (cumulativeDuration >= targetLengthSeconds) {
        break;
      }
    }
    
    // Process unrelated documents individually if we still have time
    if (cumulativeDuration < targetLengthSeconds && unrelatedDocuments.length > 0) {
      res.write(`event: investigationUpdate\n`);
      res.write(`data: "Examining individual unrelated documents"\n\n`);
      
      for (let i = 0; i < unrelatedDocuments.length; i++) {
        const doc = unrelatedDocuments[i];
        
        // Create a review for this single document
        const docId = doc.documentId;
        const docPages = documents.filter(d => d.documentId === docId);
        
        let singleDocReview = `Document ID: ${docId}\n`;
        singleDocReview += `Summary: ${doc.summary || 'No summary available'}\n`;
        singleDocReview += `People mentioned: ${doc.names || 'None'}\n`;
        singleDocReview += `Places mentioned: ${doc.places || 'None'}\n`;
        singleDocReview += `Dates mentioned: ${doc.dates || 'None'}\n`;
        
        // Add page information
        singleDocReview += `Pages:\n${docPages.map(page => 
          `  Page ${page.pageNumber}: ${page.pageSummary || 'No summary'} | Content: ${page.content ? (page.content.length > 50 ? page.content.substring(0, 50) + '...' : page.content) : 'None'}`
        ).join('\n')}`;
        
        // Alternate which investigator analyzes each document
        const currentSpeaker = (relatedDocuments.length + i) % 2 === 0 ? reporterSpeaker : investigatorSpeaker;
        const currentSpeakerName = (relatedDocuments.length + i) % 2 === 0 ? reporterName : investigatorName;
        
        res.write(`event: investigationUpdate\n`);
        res.write(`data: "${currentSpeaker.name} is analyzing document ${i + 1}"\n\n`);
        
        const docAnalysis = await generateInvestigatorComment({
          host: currentSpeaker,
          document: singleDocReview,
          previousComment: dialogue[dialogue.length - 1].text,
          documents: [doc],
          metadata,
          dialogue,
          investigation,
          openingLines: null,
          closingLines: null,
          i: 2 + relatedDocuments.length + i,
          isIntro: false,
          isFollowUp: false,
          isReply: true,
          isOutro: false,
          isGroup: false
        });
        
        dialogue.push({ text: docAnalysis, speaker: currentSpeakerName });
        
        // Check if we've reached target length
        cumulativeDuration = dialogue.reduce((total, turn) => {
          return total + (turn.text.split(/\s+/).length / wordsPerSecond);
        }, 0);
        
        if (cumulativeDuration >= targetLengthSeconds) {
          break;
        }
      }
    }

    // Calculate conversation duration so far
    cumulativeDuration = dialogue.reduce((total, turn) => {
      return total + (turn.text.split(/\s+/).length / wordsPerSecond);
    }, 0);

    // Closing exchange if we haven't exceeded target length
    if (cumulativeDuration < targetLengthSeconds) {
      res.write(`event: investigationUpdate\n`);
      res.write(`data: "Summarizing findings"\n\n`);
      
      // Reporter provides final thoughts and conclusions
      const wrappingUp = await generateInvestigatorComment({
        host: reporterSpeaker,
        document: fullDocReview,
        previousComment: dialogue[dialogue.length - 1].text,
        documents,  // Pass all documents for the closing summary
        metadata,
        dialogue,
        investigation,
        openingLines: null,
        closingLines: null,
        isIntro: false,
        isFollowUp: false,
        isReply: true,
        isOutro: false
      });
      
      dialogue.push({ text: wrappingUp, speaker: reporterName });
      
      // Investigator provides final thoughts and conclusions
      const closingLines = investigatorSpeaker.closingLines;
      const closingComment = await generateInvestigatorComment({
        host: investigatorSpeaker,
        document: fullDocReview,
        previousComment: wrappingUp,
        documents,  // Pass all documents for final analysis
        metadata,
        dialogue,
        investigation,
        openingLines: null,
        closingLines,
        isIntro: false,
        isFollowUp: false,
        isReply: true,
        isOutro: true
      });

      dialogue.push({ text: closingComment, speaker: investigatorName });
    }

    res.write(`event: investigationUpdate\n`);
    res.write(`data: "Recording investigative report..."\n\n`);
    console.log('Sent message that merging dialogue into a single audio file');
    
    const generatedReport = await generatePodcast(dialogue, investigatorsArray, reportId);
    const reportFile = generatedReport.outputFileName;
    // const duration = generatedReport.duration;
    
    res.write(`event: reportComplete\n`);
    res.write(`data: ${JSON.stringify({ reportFile })}\n\n`);
    console.log('Sent message that report generation is complete with file:', reportFile);

    let reportTitle = await generateInvestigatorComment({
      hostNames: [speakerA.name, speakerB.name],
      dialogue,
      investigation,
      generateTitle: true
    });

    if (reportTitle.startsWith('Title: ')) {
      reportTitle = reportTitle.replace('Title: ', '');
    }
    
    const showName = `${speakerA.name} & ${speakerB.name} Investigations`;
    const reportTags = await generateInvestigatorComment({
      dialogue,
      investigation,
      generateTags: true
    });

    const reportTagsArray = reportTags.split(', ');

    console.log({
      reportTitle,
      showName,
      reportTags: reportTagsArray
    });

    res.write(`event: recordComplete\n`);
    res.write(`data: ${JSON.stringify({ reportTitle, showName, reportTagsArray, reportFile })}\n\n`);
    console.log('Sent message that report generation is complete with title, show name, and tags', reportTitle, showName, reportTagsArray, reportFile);

    return reportFile;
  } catch (error) {
    console.error('Error generating investigative report:', error);
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: 'An error occurred during report generation: ' + error.message })}\n\n`);
    return null;
  }
}

// Function to group documents based on overlapping people, places or dates
function groupRelatedDocuments(documents) {
  // Initialize result containers
  const relatedDocuments = [];
  const unrelatedDocuments = [];
  
  // Track which documents have been assigned to a group
  const assignedDocs = new Set();
  
  // Helper function to check if two documents have overlapping attributes
  function hasOverlap(doc1, doc2) {
    // Helper function to normalize data into array of lowercase strings
    function normalizeData(data) {
      if (!data) return [];
      if (Array.isArray(data)) {
        return data.map(item => String(item).toLowerCase().trim()).filter(Boolean);
      }
      if (typeof data === 'string') {
        return data.split(',').map(item => item.toLowerCase().trim()).filter(Boolean);
      }
      return [String(data).toLowerCase().trim()];
    }

    // Helper function to check overlap between two arrays
    function arraysOverlap(arr1, arr2) {
      return arr1.some(item => arr2.includes(item) && item !== '');
    }
    
    // Check for overlapping people
    const people1 = normalizeData(doc1.names);
    const people2 = normalizeData(doc2.names);
    if (arraysOverlap(people1, people2)) {
      return true;
    }
    
    // Check for overlapping places
    const places1 = normalizeData(doc1.places);
    const places2 = normalizeData(doc2.places);
    if (arraysOverlap(places1, places2)) {
      return true;
    }
    
    // Check for overlapping dates
    const dates1 = normalizeData(doc1.dates);
    const dates2 = normalizeData(doc2.dates);
    if (arraysOverlap(dates1, dates2)) {
      return true;
    }
    
    return false;
  }
  
  // Process each document
  for (let i = 0; i < documents.length; i++) {
    const currentDoc = documents[i];
    
    // Skip if this document is already assigned to a group
    if (assignedDocs.has(i)) continue;
    
    // Check if current document has overlap with any existing group
    let foundGroup = false;
    let groupsToMerge = [];
    
    // First check if this document belongs to any existing group
    for (let groupIndex = 0; groupIndex < relatedDocuments.length; groupIndex++) {
      const group = relatedDocuments[groupIndex];
      
      // Check if current document has overlap with any document in this group
      if (group.some(groupDoc => hasOverlap(currentDoc, groupDoc))) {
        groupsToMerge.push(groupIndex);
        foundGroup = true;
      }
    }
    
    if (groupsToMerge.length > 0) {
      // If the document matches multiple groups, merge those groups
      if (groupsToMerge.length > 1) {
        // Sort in descending order so we can remove from the end without affecting earlier indices
        groupsToMerge.sort((a, b) => b - a);
        
        // Merge all matching groups into the first group
        const targetGroupIndex = groupsToMerge[groupsToMerge.length - 1];
        
        // Add current document to the target group
        relatedDocuments[targetGroupIndex].push(currentDoc);
        assignedDocs.add(i);
        
        // Merge other groups into target group and remove them
        for (let j = 0; j < groupsToMerge.length - 1; j++) {
          const groupToMergeIndex = groupsToMerge[j];
          relatedDocuments[targetGroupIndex] = [
            ...relatedDocuments[targetGroupIndex],
            ...relatedDocuments[groupToMergeIndex]
          ];
          relatedDocuments.splice(groupToMergeIndex, 1);
        }
      } else {
        // Add to the existing group
        relatedDocuments[groupsToMerge[0]].push(currentDoc);
        assignedDocs.add(i);
      }
    } else {
      // Now check if it has overlap with any other ungrouped document
      let newGroup = [currentDoc];
      assignedDocs.add(i);
      
      for (let j = i + 1; j < documents.length; j++) {
        // Skip if already assigned
        if (assignedDocs.has(j)) continue;
        
        if (hasOverlap(currentDoc, documents[j])) {
          newGroup.push(documents[j]);
          assignedDocs.add(j);
        }
      }
      
      // If we found related documents, create a new group
      if (newGroup.length > 1) {
        relatedDocuments.push(newGroup);
      } else {
        // If no overlap found, this document is unrelated
        unrelatedDocuments.push(currentDoc);
      }
    }
  }
  
  // Add any remaining unassigned documents to unrelatedDocuments
  for (let i = 0; i < documents.length; i++) {
    if (!assignedDocs.has(i)) {
      unrelatedDocuments.push(documents[i]);
    }
  }
  
  return { relatedDocuments, unrelatedDocuments };
}

// Export module functions
module.exports = {
  personalities,
  generatePodcastFromArticles,
  generateInvestigativeReportFromDocuments,
  generatePodcast,
  mergeAudioFiles,
  getAudioDuration,
  groupRelatedDocuments  // Add the new function to exports
};
