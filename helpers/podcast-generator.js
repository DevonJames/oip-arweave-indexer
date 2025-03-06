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


// Initialize Text-to-Speech client
const client = new textToSpeech.TextToSpeechClient({
  keyFilename: 'config/google-service-account-key.json',
  projectId: 'gentle-shell-442906-t7',
});

async function articlesAnalysis(articles) {
  console.log('articles to analyze:', articles);
  // determine broadly whether the articles are political in their nature or not 
  const tags = articles.map(article => article.tags.split(',').map(tag => tag.trim()))
  
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
        ? "Feel free to reference Plato’s allegory of the cave if it adds depth, but only sparingly."
        : "Avoid referencing Plato’s allegory of the cave unless absolutely relevant.";
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

async function generateHostComment(args) {
  const { host, article, previousComment, articles, dialogue, openingLines, closingLines, i , isIntro, isMain, isReply, isOutro, isGroup, generateTitle, hostNames, generateTags } = args;
  const dialogString = JSON.stringify(dialogue);
  const ifIntro = isIntro;
  const ifOutro = isOutro;
  const ifReply = isReply;
  const ifMain = isMain;
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
  // console.log('generating intro, main, reply or outro?', {ifIntro, ifMain, ifReply, ifOutro});
  const response = await axios.post(
    "https://api.x.ai/v1/chat/completions",
    {
      model: "grok-beta",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.XAI_BEARER_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
  // console.log({ifIntro, ifMain, ifReply, ifOutro}, 'generating comments with this system prompt:', {systemPrompt}, 'and this user prompt:', {userPrompt}, 'result:', response.data.choices[0].message.content.trim());
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
          model: "grok-beta",
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
    alias: "The Prince’s Advisor",
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
      // Ensure the file extension is properly set to .wav
      const chunkFileName = path.join(outputDir, `${outputFileName}.mp3`);
      // console.log(`Generating audio file: ${chunkFileName}`);

      const audioFile = await synthesizeSpeech(
          textChunks[i],
          personalitiesArray[turn.speaker].voices,
          chunkFileName,
          api
      );

      // Convert to WAV format
      const wavFileName = chunkFileName.replace(".mp3", ".wav");
      await convertMp3ToWav(audioFile, wavFileName);

      audioFiles.push(wavFileName);
  }

  return audioFiles;
}

// Function to convert MP3 to true WAV
async function convertMp3ToWav(inputFile, outputFile) {
  return new Promise((resolve, reject) => {
      ffmpeg()
          .input(inputFile)
          .output(outputFile)
          .audioCodec("pcm_s16le") // Forces WAV format
          .audioFrequency(44100)   // Standard 44.1 kHz
          .on("end", () => {
              // console.log(`✅ Converted to WAV: ${outputFile}`);
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
      console.log("audioFile:", audioFile);
  return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioFile, (err, metadata) => {
          if (err) {
              reject(err);
          } else {
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
  const finalAudioFile = path.join('media', outputFileName);
  await mergeAudioFiles(allAudioFiles, finalAudioFile);

  const absoluteFilepath = path.join(__dirname, '../', finalAudioFile);

  // Get duration of final audio file and report how long it is vs how long the estimated duration is
  const duration = await getAudioDuration(absoluteFilepath);
  const estimatedDuration = dialogue.reduce((total, turn) => total + turn.duration, 0);
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


async function generatePodcastFromArticles(articles, selectedHosts, targetLengthSeconds = 1500, podcastId, res) {
  console.log(`Generating podcast with ID: ${podcastId}`);
  res.write(`event: podcastProductionUpdate\n`);
  res.write(`data: "Preparing Podcast"\n\n`);
  
  const isPolitical = articlesAnalysis(articles);
  console.log('isPolitical', isPolitical);

  const personalitiesArray = {
    socrates: personalities.socrates,
    hypatia: personalities.hypatia,
    thomasJefferson: personalities.thomasJefferson,
    machiavelli: personalities.machiavelli,
  };

  if (!selectedHosts || selectedHosts.length !== 2) {
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: 'You must provide exactly two hosts.\n\n' })}\n\n`);
    console.log('sent error response: You must provide exactly two hosts.');
    res.end();
    throw new Error('You must provide exactly two hosts.');
  }

  const [hostAName, hostBName] = selectedHosts;
  const speakerA = personalitiesArray[hostAName];
  const speakerB = personalitiesArray[hostBName];

  if (!speakerA || !speakerB) {
    console.log(`Invalid hosts selected: ${hostAName}, ${hostBName}`);
    res.end();
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
    isMain: false,
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
      isMain: true,
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
      isMain: false,
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
      isMain: true,
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
      isMain: false,
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
    isMain: false,
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
  
  const jwk = JSON.parse(fs.readFileSync(process.env.WALLET_FILE)); 
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
}


// Export module functions
module.exports = {
  personalities,
  generatePodcastFromArticles,
  synthesizeDialogueTurn,
  mergeAudioFiles,
  getAudioDuration
};



  // Example usage
//   async function generatePodcastFromArticles(articles, selectedHosts, targetLengthSeconds = 3500, podcastId, res) {
//     console.log(' Generating podcast with', articles.length, 'articles, with hosts:', selectedHosts, 'Podcast ID:', podcastId);

//     if (ongoingPodcastProduction.has(podcastId)) {
//       console.log(`Podcast already in production for these articles and hosts. Following that production by reconnecting to existing stream.`);
      
//       // Resume sending updates for the ongoing scrape
//       const existingStream = ongoingPodcastProduction.get(podcastId);
//       existingStream.clients.push(res);
      
//       // Send existing data if available
//       existingStream.data.forEach(chunk => res.write(chunk));
//       return;
//     }
//     // If this is a new scrape, set up a new entry in ongoingPodcastProduction
//     const streamData = {
//       clients: [res],
//       data: []
//     };
//     ongoingPodcastProduction.set(podcastId, streamData);


//     const personalitiesArray = {
//         socrates: personalities.socrates,
//         hypatia: personalities.hypatia,
//         thomasJefferson: personalities.thomasJefferson,
//         machiavelli: personalities.machiavelli,
//       };

//        // Validate and extract personalities for the selected hosts
//         if (!selectedHosts || selectedHosts.length !== 2) {
//             throw new Error('You must provide exactly two hosts.');
//         }
//         const [hostAName, hostBName] = selectedHosts;
//         console.log('hostAName', hostAName);
//         console.log('hostBName', hostBName);

//         if (!personalitiesArray[hostAName] || !personalitiesArray[hostBName]) {
//           throw new Error(`Invalid hosts selected: ${hostAName}, ${hostBName}`);
//         }
      
//         const speakerA = hostAName;
//         const speakerB = hostBName;
//         const speakerAPersonality = personalitiesArray[hostAName];
//         const speakerBPersonality = personalitiesArray[hostBName];

//     console.log('Generating podcast with hosts:', speakerA, 'and', speakerB);

//   // Dialogue and cumulative length setup
//   const dialogue = [];
//   let cumulativeDuration = 0;
//   const wordsPerSecond = 3;

//     console.log('step 1 generating intro comments with host:', speakerAPersonality.name, speakerAPersonality.voice.name);
//     res.write(`event: generatingIntro\n`);
//     res.write(`data: ${speakerAPersonality.name}\n\n`);
//       // res.flush(); // Ensures data is flushed to the client immediately
//     console.log('Sent initialData:', articleData);

//     const openingLines = personalitiesArray[speakerA].openingLines;
//     const closingLines = personalitiesArray[speakerA].closingLines;
    
//     // Select a random opening line
//     const randomOpeningLine = openingLines[Math.floor(Math.random() * openingLines.length)];
//     const hostAIntro = await generateHostComment({
//         host: speakerAPersonality,
//         article: null,
//         previousComment: null,
//         articles,
//         dialogue,
//         openingLines: openingLines,
//     });
    
//     dialogue.push({ text: `${hostAIntro}`, speaker: speakerA });
    

//     // const hostAIntro = await generateHostComment(speakerAPersonality, null, null, articles, null, openingLines);
//     // const hostAIntro = await generateHostComment(args={host: speakerAPersonality, article: null, previousComment: null, articles, dialogue, openingLines});
//     // // const randomIndexOpening = Math.floor(Math.random() * openingLines.length);
//     // // const openingLine = openingLines[randomIndexOpening];
//     // const openingDuration = hostAIntro.split(/\s+/).length / wordsPerSecond;
//     // dialogue.push({ text: `${hostAIntro}`, speaker: speakerA });
//     // dialogue.push({ text: `Friends and comrades! ${hostAIntro}`, speaker: speakerA });
  
//   // Split articles into two halves
//   const half = Math.ceil(articles.length / 2);
//   const articlesForAFirst = articles.slice(0, half);
//   const articlesForBFirst = articles.slice(half);
  
//   // Function for speakerA starting
//   async function processArticlesWithAStarting(articles) {
//     for (const article of articles) {
//       if (cumulativeDuration >= targetLengthSeconds) {
//         console.log('Target length reached, stopping further dialogue generation.');
//         break;
//       }
  
//       // Generate comments
//       console.log('Generating article comments with host:', speakerAPersonality.name);
//     //   const hostAComment = await generateHostComment(speakerAPersonality, article.content, null, null, dialogue);
//       const hostAComment = await generateHostComment(args={host: speakerAPersonality, article, previousComment: null, articles, dialogue, openingLines});
//     console.log('Generating follow-up comments with host:', speakerBPersonality.name);
//     //   const hostBComment = await generateHostComment(speakerBPersonality, article.content, previousComment = hostAComment, null, dialogue);
//         const hostBComment = await generateHostComment(args={host: speakerBPersonality, article, previousComment: hostAComment, articles, dialogue, openingLines});
  
//       // Calculate durations
//       const hostACommentDuration = hostAComment.split(/\s+/).length / wordsPerSecond;
//       const hostBCommentDuration = hostBComment.split(/\s+/).length / wordsPerSecond;
  
//       if (cumulativeDuration + hostACommentDuration + hostBCommentDuration > targetLengthSeconds) {
//         console.log('Adding these comments would exceed target length, stopping.');
//         break;
//       }
//     let title = article.title.replace(/\*/g, '');
//       // Add comments to dialogue
//       dialogue.push({ text: `${title}: ${hostAComment}`, speaker: speakerA });
//       cumulativeDuration += hostACommentDuration;
  
//       dialogue.push({ text: `${hostBComment}`, speaker: speakerB });
//       cumulativeDuration += hostBCommentDuration;
  
//       // Generate banter
//       if (cumulativeDuration < targetLengthSeconds) {
//         const banterDialogue = await generateBanter(hostAComment, hostBComment, speakerA, speakerB, dialogue);
//         const banterDuration = banterDialogue.reduce((sum, line) => sum + line.text.split(/\s+/).length, 0) / wordsPerSecond;
  
//         if (cumulativeDuration + banterDuration <= targetLengthSeconds) {
//           dialogue.push(...banterDialogue);
//           cumulativeDuration += banterDuration;
//         } else {
//           console.log('Banter skipped due to time constraints.');
//         }
//       }
  
//       console.log(`Cumulative duration so far: ${cumulativeDuration.toFixed(2)} seconds`);
//     }
//   }
  
//   // Function for speakerB starting
//   async function processArticlesWithBStarting(articles) {
//     for (const article of articles) {
//       if (cumulativeDuration >= targetLengthSeconds) {
//         console.log('Target length reached, stopping further dialogue generation.');
//         break;
//       }
  
//       // Generate comments
//       console.log('Generating article comments with host:', speakerBPersonality.name);
//     //   const hostBComment = await generateHostComment(speakerBPersonality, article.content, null, null, dialogue);
//         const hostBComment = await generateHostComment(args={host: speakerBPersonality, article, previousComment: null, articles, dialogue, openingLines});
//     console.log('Generating follow-up comments with host:', speakerAPersonality.name);
//     //   const hostAComment = await generateHostComment(speakerAPersonality, article.content, previousComment = hostBComment, null, dialogue);
//       const hostAComment = await generateHostComment(args={host: speakerAPersonality, article, previousComment: hostBComment, articles, dialogue, openingLines});
//       // Calculate durations
//       const hostBCommentDuration = hostBComment.split(/\s+/).length / wordsPerSecond;
//       const hostACommentDuration = hostAComment.split(/\s+/).length / wordsPerSecond;
  
//       if (cumulativeDuration + hostACommentDuration + hostBCommentDuration > targetLengthSeconds) {
//         console.log('Adding these comments would exceed target length, stopping.');
//         break;
//       }
  
//       // Add comments to dialogue
//       dialogue.push({ text: `${hostBComment}`, speaker: speakerB });
//       cumulativeDuration += hostBCommentDuration;
  
//       dialogue.push({ text: `${article.title}: ${hostAComment}`, speaker: speakerA });
//       cumulativeDuration += hostACommentDuration;
  
//       // Generate banter
//       if (cumulativeDuration < targetLengthSeconds) {
//         const banterDialogue = await generateBanter(hostBComment, hostAComment, speakerB, speakerA, dialogue);
//         const banterDuration = banterDialogue.reduce((sum, line) => sum + line.text.split(/\s+/).length, 0) / wordsPerSecond;
  
//         if (cumulativeDuration + banterDuration <= targetLengthSeconds) {
//           dialogue.push(...banterDialogue);
//           cumulativeDuration += banterDuration;
//         } else {
//           console.log('Banter skipped due to time constraints.');
//         }
//       }
  
//       console.log(`Cumulative duration so far: ${cumulativeDuration.toFixed(2)} seconds`);
//     }
//   }
  
//   // Process articles
//   await processArticlesWithAStarting(articlesForAFirst);
//   await processArticlesWithBStarting(articlesForBFirst);
  
//   console.log('Final dialogue length:', cumulativeDuration.toFixed(2), 'seconds');
  
//     const cleanedDialogue = preprocessDialogueForSynthesis(dialogue);
//     // const closingLines = [
//     //   "Be strong and prosperous.",
//     //   "I entrust it to the gods.",
//     //   "The rest the gods will know.",
//     //   "Act courageously.",
//     //   "I am grateful to you all.",
//     //   "If I seemed unjust to anyone, entrust it to the gods.",
//     //   "May Zeus and fortune lead you to what is good.",
//     //   "Farewell and remember what has been said."
//     // ];
    

//     // Add closing line
//     const randomClosingLine = closingLines[Math.floor(Math.random() * closingLines.length)];
//     if (cumulativeDuration + randomClosingLine.split(/\s+/).length / wordsPerSecond <= targetLengthSeconds) {
//         dialogue.push({ text: randomClosingLine, speaker: speakerA });
//     }

//     // const randomIndexClosing = Math.floor(Math.random() * closingLines.length);
//     // const closingDuration = closingLine.split(/\s+/).length / wordsPerSecond;
//     // const closingLine = closingLines[randomIndexClosing];
//     // if (cumulativeDuration + closingDuration <= targetLengthSeconds) {
//     //   cleanedDialogue.push({ text: closingLine, speaker: speakerA });
//     // }
  
//     // const dialogue = []; // Populate dialogue using your existing logic (e.g., host comments, banter)
//   // const outputFileName = generateAudioFileName(articles.map(article => article.url).join(', '), 'mp3');
//   return await generatePodcast(dialogue, personalitiesArray, podcastId);
// }

// //  working great but going to add the abulity to group articles by their similarity
// async function generatePodcastFromArticles(articles, selectedHosts, targetLengthSeconds = 3500, podcastId, res) {
//   console.log(`Generating podcast with ID: ${podcastId}`);
  
//   const isPolitical = articlesAnalysis(articles)
//   console.log('isPolitical', isPolitical);
//   // Personalities setup
//   const personalitiesArray = {
//     socrates: personalities.socrates,
//     hypatia: personalities.hypatia,
//     thomasJefferson: personalities.thomasJefferson,
//     machiavelli: personalities.machiavelli,
//   };

//   // Validate selected hosts
//   if (!selectedHosts || selectedHosts.length !== 2) {
//     res.write(`event: error\n`);
//     res.write(`data: ${JSON.stringify({ message: 'You must provide exactly two hosts.' })}\n\n`);
//     res.end();
//     throw new Error('You must provide exactly two hosts.');
//   }

//   const [hostAName, hostBName] = selectedHosts;
//   const speakerA = personalitiesArray[hostAName];
//   const speakerB = personalitiesArray[hostBName];

//   if (!speakerA || !speakerB) {
//     // res.write(`event: error\n`);
//     // res.write(`data: ${JSON.stringify({ message: `Invalid hosts selected: ${hostAName}, ${hostBName}` })}\n\n`);
//     res.end();
//     // throw new Error(`Invalid hosts selected: ${hostAName}, ${hostBName}`);
//   }

//   // Initialization
//   const dialogue = [];
//   let cumulativeDuration = 0;
//   const wordsPerSecond = 3;

//   res.write(`event: progress\n`);
//   res.write(`data: "Podcast generation started. Hosts: ${speakerA.name} and ${speakerB.name}"\n\n`);

//   // Generate opening comments
//   res.write(`event: progress\n`);
//   res.write(`data: "Generating intro comments from ${speakerA.name}"\n\n`);
  
//   const openingLines = speakerA.openingLines;
//   console.log('generating opening comments with host:', speakerA.name, speakerA.voices);
//   const openingComment = await generateHostComment({
//     host: speakerA,
//     article: null,
//     previousComment: null,
//     articles,
//     dialogue,
//     openingLines,
//     closingLines: null,
//     i: 0
//   });

//   dialogue.push({ text: openingComment, speaker: hostAName });

//   // Process articles
//   res.write(`event: progress\n`);
//   res.write(`data: "Processing articles for discussion..."\n\n`);

//   for (let i = 0; i < articles.length; i++) {
//     const article = articles[i];
//     res.write(`event: progress\n`);
//     res.write(`data: "Considering article: ${article.title}"\n\n`);

//     const hostAComment = await generateHostComment({
//       host: speakerA,
//       article,
//       previousComment: null,
//       articles: null,
//       dialogue,
//       openingLines,
//       closingLines: null,
//       i
//     });

//     const hostBComment = await generateHostComment({
//       host: speakerB,
//       article,
//       previousComment: hostAComment,
//       articles: null,
//       dialogue,
//       openingLines,
//       closingLines: null,
//       i: i+1
//     });

//     dialogue.push({ text: hostAComment, speaker: hostAName });
//     dialogue.push({ text: hostBComment, speaker: hostBName });

//     cumulativeDuration += (hostAComment.split(/\s+/).length + hostBComment.split(/\s+/).length) / wordsPerSecond;

//     // Generate banter
//     if (Math.random() < 0.5) { // Random chance to generate banter
//       res.write(`event: progress\n`);
//       res.write(`data: "Generating banter between ${speakerA.name} and ${speakerB.name}"\n\n`);
//       const banterDialogue = await generateBanter(hostAComment, hostBComment, hostAName, hostBName, dialogue);
//       dialogue.push(...banterDialogue);
//     }

//     if (cumulativeDuration >= targetLengthSeconds) {
//       res.write(`event: progress\n`);
//       res.write(`data: "Reached target podcast length. Wrapping up..."\n\n`);
//       break;
//     }
//   }

//   // Generate closing comments
//   res.write(`event: progress\n`);
//   res.write(`data: "Adding closing remarks from ${speakerA.name}"\n\n`);
//   const closingLines = speakerA.closingLines;
//   const closingComment = await generateHostComment({
//     host: speakerA,
//     article: null,
//     previousComment: null,
//     articles: null,
//     dialogue,
//     openingLines: null,
//     closingLines,
//   });
//   // const closingComment = closingLines[Math.floor(Math.random() * closingLines.length)];
//   dialogue.push({ text: closingComment, speaker: hostAName });

//   // Generate the final podcast
//   res.write(`event: progress\n`);
//   res.write(`data: "Merging dialogue into a single podcast file..."\n\n`);
  
//   const podcastFile = await generatePodcast(dialogue, personalitiesArray, podcastId);

//   res.write(`event: podcastComplete\n`);
//   res.write(`data: ${JSON.stringify({ message: "Podcast generation complete!", podcastFile })}\n\n`);
//   res.end();

//   return podcastFile;
// }


// Prepare text-to-speech synthesis request
// async function synthesizeSpeech(text, voice, outputFileName) {
//   const request = {
//     input: { text },
//     voice,
//     audioConfig: {
//       audioEncoding: 'MP3',
//     //   speakingRate: 1.15,
//     },
//   };

//   try {
//     console.log(`Synthesizing speech for text: "${text.substring(0, 50)}..."`);
//     const [response] = await client.synthesizeSpeech(request);
//     await fs.promises.writeFile(outputFileName, response.audioContent, 'binary');
//     console.log(`Saved audio to ${outputFileName}`);
//     return outputFileName;
//   } catch (error) {
//     console.error(`Error during speech synthesis: ${error.message}`);
//     throw error;
//   }
// }

// this one works great with eleven labs models
// async function synthesizeSpeech_(text, voiceConfig, outputFileName, api = 'elevenLabs') {
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



// // working great but trying an upgrade
// async function generateHostComment(args) {
//   console.log('args in generateHostComment:', args);
//     const { host, article, previousComment, articles, dialogue, openingLines, i } = args;
//     const dialogString = JSON.stringify(dialogue);
//     const ifIntro = dialogue && dialogue.length === 0;
//     const today = new Date();
//     let signifcanceOfThePassageOfTime = '';
//     if (articles !== null && articles.length > 1) {
//       console.log('generateHostComment for article:', i)
//       if (article !== null) {
//         console.log('article comments... article', article);
//         const articlePublishDate = new Date(article.date.replace("Published on: ", ""));
//         const daysSincePublish = Math.floor((today - articlePublishDate) / (1000 * 60 * 60 * 24));
//         signifcanceOfThePassageOfTime = (daysSincePublish > 14) ? `It's been more than two weeks since this article was published (it was ${articlePublishDate} and today is ${today}), so consider how the context may have changed since then or whether there are events you are aware of that have happened since it was published that are relevant now.` : '';
//       } else {
//         console.log('intro comments... articles:', i, articles);
//         const articlePublishDate = new Date(articles[i].date.replace("Published on: ", ""));
//         const daysSincePublish = Math.floor((today - articlePublishDate) / (1000 * 60 * 60 * 24));
//         signifcanceOfThePassageOfTime = (daysSincePublish > 14) ? `It's been more than two weeks since this article was published (it was ${articlePublishDate} and today is ${today}), so consider how the context may have changed since then or whether there are events you are aware of that have happened since it was published that are relevant now.` : '';
//       } 
//     }
//     // else  {
//       // const articlePublishDate = new Date(article.date.replace("Published on: ", ""));
//       // const daysSincePublish = Math.floor((today - articlePublishDate) / (1000 * 60 * 60 * 24));
//       // signifcanceOfThePassageOfTime = (daysSincePublish > 14) ? `It's been more than two weeks since this article was published, so consider how the context may have changed since then.` : '';
//     // }
//     const userPrompt = ifIntro
//       ? `Here's a list of article titles for today's podcast: ${articles.map(a => a.title).join(', ')}. Start with a greeting either from this list or a variation of it "${openingLines.join('", "')}" and then come up with the rest of the sentence for 'today we'll be talking about:...'`
//       : previousComment
//       ? `For your knowledge and conversational context, here is what has been said so far in this dialog with your cohost: "${dialogString}". Respond to your co-host's comment: "${previousComment}". Keep it short, thoughtful, and avoid repeating their points.`
//       : `For your knowledge and conversational context, here is what has been said so far in this dialog with your cohost: "${dialogString}". Here's an article summary: "${article.content}". Summarize and reflect on it briefly, keeping your commentary engaging and relevant. ${signifcanceOfThePassageOfTime}`;
  
//     const response = await axios.post('https://api.x.ai/v1/chat/completions', {
//       model: 'grok-beta',
//       messages: [
//         { role: 'system', content: generateSystemPrompt(host, dialogue, articles) },
//         { role: 'user', content: userPrompt },
//       ],
//       temperature: 0.7,
//     }, {
//       headers: {
//         Authorization: `Bearer ${process.env.XAI_BEARER_TOKEN}`,
//         'Content-Type': 'application/json',
//       },
//     });
  
//     return response.data.choices[0].message.content.trim();
//   }

// // working great but trying an upgrade
// async function generateBanter(commentA, commentB, aliasA = 'Socrates', aliasB = 'Hypatia', dialogue) {
//     const dialogString = JSON.stringify(dialogue);

//     // Randomize the number of lines between 3 and 7 (inclusive)
//     const numLines = Math.floor(Math.random() * 5) + 3;
//     console.log('Generating banter between', aliasA, 'and', aliasB, 'with', numLines, 'lines...');

//     const response = await axios.post('https://api.x.ai/v1/chat/completions', {
//         model: 'grok-beta',
//         messages: [
//             {
//                 role: 'system',
//                 content: `You are creating a witty, engaging banter between two podcast hosts: ${aliasA} and ${aliasB}. 
//                 They do not mention each other's names directly in the dialogue. Alternate lines between ${aliasA} making a philosophical or humorous remark and ${aliasB} responding in kind. 
//                 Use conversational, natural language. Build on the context provided: ${dialogString}. Do not include artifacts such as "said" or speaker names in the output.`,
//             },
//             {
//                 role: 'user',
//                 content: `${aliasA} remarked: "${commentA}". ${aliasB} replied: "${commentB}". Create an exchange of exactly ${numLines} alternating lines.`,
//             },
//         ],
//         temperature: 0.8,
//     }, {
//         headers: {
//             Authorization: `Bearer ${process.env.XAI_BEARER_TOKEN}`,
//             'Content-Type': 'application/json',
//         },
//     });

//     const banter = response.data.choices[0]?.message?.content?.trim() || '';
//     if (!banter) {
//         console.error('Error: Banter generation failed or returned empty.');
//         return [];
//     }

//     // Process the banter text
//     const banterLines = splitBanter(banter, aliasA, aliasB);

//     return banterLines;
// }


// Helper to split long text into smaller chunks
