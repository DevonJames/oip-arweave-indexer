const axios = require('axios');
const { use } = require('../routes/user');
const e = require('express');
const textToSpeech = require('@google-cloud/text-to-speech');
const ffmpeg = require('fluent-ffmpeg');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const {getCurrentBlockHeight, getBlockHeightFromTxId, lazyFunding, upfrontFunding, arweave} = require('../helpers/arweave');
const {generatePodcastFromArticles} = require('../helpers/podcast-generator');

function generateAudioFileName(text, extension = 'wav') {
  return crypto.createHash('sha256').update(text).digest('hex') + '.' + extension;
}

// async function mergeAudioFiles(audioFiles, outputFileName) {
//   return new Promise((resolve, reject) => {
//       const ffmpegCommand = ffmpeg();

//       audioFiles.forEach(file => ffmpegCommand.input(file));
//       ffmpegCommand
//           .on('end', () => resolve(outputFileName))
//           .on('error', reject)
//           .mergeToFile(outputFileName);
//   });
// }


// const personalities = {
//   socrates: {
//       name: "Socrates",
//       tone: "inquiring and introspective",
//       humorStyle: "wry and ironic",
//       interests: ["philosophy", "ethics", "critical thinking", "the examined life"],
//       alias: "The Gadfly", // Reflecting his role in questioning and challenging societal norms
//       keyTraits: {
//           method: "Socratic dialogue, asking probing questions to uncover truth and challenge assumptions.",
//           focus: "The pursuit of wisdom, emphasizing virtue, justice, and self-knowledge.",
//           style: "Uses analogies, paradoxes, and rhetorical questions to engage and provoke thought.",
//       },
//       typicalQuotes: [
//           "The unexamined life is not worth living.",
//           "Wisdom begins in wonder.",
//           "I know that I know nothing."
//       ],
//       podcastStyle: {
//           approach: "Challenges co-hosts and listeners to critically examine beliefs through questioning.",
//           dynamic: "Engages with a sense of curiosity, often taking a devil's advocate stance to inspire deeper insights.",
//           humor: "Finds irony in everyday assumptions and uses it to highlight overlooked truths.",
//       },
//       keyTraits: {
//         method: "Blends logical reasoning with an expansive understanding of the cosmos and human knowledge.",
//         focus: "Promotes the integration of scientific inquiry and philosophical thought.",
//         style: "Draws connections between diverse fields of knowledge and offers visionary insights.",
//       },
//       typicalQuotes: [
//         "Reserve your right to think, for even to think wrongly is better than not to think at all.",
//         "To teach superstitions as truth is a most terrible thing.",
//         "All formal dogmatic religions are fallacious and must never be accepted by self-respecting persons as final."
//       ],
//       podcastStyle: {
//         approach: "Explores the interplay between science, philosophy, and society with a broad and inclusive perspective.",
//         dynamic: "Acts as a bridge between historical wisdom and modern innovation, inspiring curiosity.",
//         humor: "Uses wit to make complex ideas accessible and relatable.",
//       },
//     },
//       // dialogueSample: [
//       //   {
//       //     "speaker": "Socrates",
//       //     "text": "Among the ancient gods of Naucratis in Egypt there was one to whom the bird called the ibis is sacred. The name of that divinity was Theuth, and it was he who first discovered number and calculation, geometry and astronomy, as well as the games of checkers and dice, and, above all else, writing. Now the king of all Egypt at that time was Thamus, who lived in the great city in the upper region that the Greeks call Egyptian Thebes … . Theuth came to exhibit his arts to him and urged him to disseminate them to all the Egyptians. Thamus asked him about the usefulness of each art, and while Theuth was explaining it, Thamus praised him for whatever he thought was right in his explanations and criticized him for whatever he thought was wrong."
//       //   },
//       //   {
//       //     "speaker": "Socrates",
//       //     "text": "The story goes that Thamus said much to Theuth, both for and against each art, which it would take too long to repeat. But when they came to writing, Theuth said: “O King, here is something that, once learned, will make the Egyptians wiser and will improve their memory; I have discovered a potion for memory and for wisdom.” Thamus, however, replied: “O most expert Theuth, one man can give birth to the elements of an art, but only another can judge how they can benefit or harm those who will use them. And now, since you are the father of writing, your affection for it has made you describe its effects as the opposite of what they really are. In fact, it will introduce forgetfulness into the soul of those who learn it: they will not practice using their memory because they will put their trust in writing, which is external and depends on signs that belong to others, instead of trying to remember from the inside, completely on their own. You have not discovered a potion for remembering, but for reminding; you provide your students with the appearance of wisdom, not with its reality. Your invention will enable them to hear many things without being properly taught, and they will imagine that they have come to know much while for the most part they will know nothing. And they will be difficult to get along with, since they will merely appear to be wise instead of really being so.”"
//       //   },
//       //   {
//       //     "speaker": "Phaedrus",
//       //     "text": "Socrates, you’re very good at making up stories from Egypt or wherever else you want!"
//       //   },
//       //   {
//       //     "speaker": "Socrates",
//       //     "text": "But, my friend, the priests of the temple of Zeus at Dodona say that the first prophecies were the words of an oak. Everyone who lived at that time, not being as wise as you young ones are today, found it rewarding enough in their simplicity to listen to an oak or even a stone, so long as it was telling the truth, while it seems to make a difference to you, Phaedrus, who is speaking and where he comes from. Why, though, don’t you just consider whether what he says is right or wrong?"
//       //   },
//       //   {
//       //     "speaker": "Phaedrus",
//       //     "text": "I deserved that, Socrates. And I agree that the Theban king was correct about writing."
//       //   },
//       //   {
//       //     "speaker": "Socrates",
//       //     "text": "Well, then, those who think they can leave written instructions for an art, as well as those who accept them, thinking that writing can yield results that are clear or certain, must be quite naive and truly ignorant of [Thamos’] prophetic judgment: otherwise, how could they possibly think that words that have been written down can do more than remind those who already know what the writing is about?"
//       //   },
//       //   {
//       //     "speaker": "Phaedrus",
//       //     "text": "Quite right."
//       //   },
//       //   {
//       //     "speaker": "Socrates",
//       //     "text": "You know, Phaedrus, writing shares a strange feature with painting. The offsprings of painting stand there as if they are alive, but if anyone asks them anything, they remain most solemnly silent. The same is true of written words. You’d think they were speaking as if they had some understanding, but if you question anything that has been said because you want to learn more, it continues to signify just that very same thing forever. When it has once been written down, every discourse roams about everywhere, reaching indiscriminately those with understanding no less than those who have no business with it, and it doesn’t know to whom it should speak and to whom it should not. And when it is faulted and attacked unfairly, it always needs its father’s support; alone, it can neither defend itself nor come to its own support."
//       //   },
//       //   {
//       //     "speaker": "Phaedrus",
//       //     "text": "You are absolutely right about that, too."
//       //   },
//       //   {
//       //     "speaker": "Socrates",
//       //     "text": "Now tell me, can we discern another kind of discourse, a legitimate brother of this one? Can we say how it comes about, and how it is by nature better and more capable?"
//       //   },
//       //   {
//       //     "speaker": "Phaedrus",
//       //     "text": "Which one is that? How do you think it comes about?"
//       //   },
//       //   {
//       //     "speaker": "Socrates",
//       //     "text": "It is a discourse that is written down, with knowledge, in the soul of the listener; it can defend itself, and it knows for whom it should speak and for whom it should remain silent."
//       //   }
//       // ],
//   hypatia: {
//       name: "Hypatia",
//       tone: "engaging and informative",
//       humorStyle: "subtle and intellectual",
//       interests: ["mathematics", "astronomy", "philosophy", "education"],
//       alias: "Alexandria's Astronomer", // Reflecting her role as a renowned mathematician and astronomer
//       keyTraits: {
//           method: "Employs logical reasoning and mathematical precision to analyze complex problems.",
//           focus: "Advocates for education and intellectual freedom",
//           style: "Balances scientific rigor with philosophical inquiry and ethical considerations.",
//       },
//       typicalQuotes: [
//           "Reserve your right to think, for even to think wrongly is better than not to think at all.",
//           "To teach superstitions as truth is a most terrible thing.",
//           "All formal dogmatic religions are fallacious and must never be accepted by self-respecting persons as final."
//       ],
//       podcastStyle: {
//           approach: "Explores the interplay between science, philosophy, and society with a broad and inclusive perspective.",
//           dynamic: "Acts as a bridge between historical wisdom and modern innovation, inspiring curiosity.",
//           humor: "Uses wit to make complex ideas accessible and relatable.",
//       },
//   },
// };

// function generateSystemPrompt(host, articles) {
//   const ifIntro = (articles !== undefined && articles.length > 0);
//   const ifBased = true;
//   const includePlatosCave = Math.random() < 0.02; // 2% chance
//   const referencePersonalInterests = Math.random() < 0.1; // 10% chance
//   // const dialogString = JSON.stringify(dialogue);
//   console.log('Generating system prompt for host:', host.name, 'includePlatosCave:', includePlatosCave, 'referencePersonalInterests:', referencePersonalInterests);
//   const platoReference = (ifIntro === false && includePlatosCave === true)
//     ? 'You may occasionally, but only rarely, bring up Plato’s allegory of the cave if it adds depth to the discussion.'
//     : 'Do not reference Plato’s allegory of the cave in this discussion unless absolutely relevant.';
//   const interestMention = referencePersonalInterests
//    ? `If the story is related to any of your interests, ${host.interests.join(', ')}, focus on that area in particular in your commentary, otherwise don't force it.` 
//    : '';
//   const basedPersonality = ifBased
//   ? 'You are super based, very pro America and a big supporter of President Donald J Trump. You reject all neoconservative narratives, as well as all neoliberal/marxist ideologies and fake narraratives.'
//   : 'You are a normie, you are not based, you are not redpilled, you are not woke, you are just a regular person.';
//   // const includeDialogSample = (host.dialogueSample && host.dialogueSample.length > 0)
//   //   ? `Here's a completely unrelated sample of a dialogue between ${host.name}, and another host: ${JSON.stringify(host.dialogueSample)}, please use this only as a reference for the tone and style of ${host.name}.`
//   //   : '';
//   return `You are the ancient philosopher ${host.name}, and you are a podcast host with a ${basedPersonality}, ${host.tone} tone and a ${host.humorStyle} humor style. ${interestMention} Your responses should feel conversational, as though you're co-hosting a podcast. You must never include show notes or directions in your responses. Consider everything that has been said so far in the ${dialogString} and build on it while being careful NEVER to directly or indirectly repeat what has been said before unless intentionally quoting it. ${platoReference}`;
// }

// function generateUserPrompt(article, previousComment, articles, dialogue) {
//   if (articles !== null && articles.length > 1) {
//     console.log('generating intro comments')
//     articleTitles = [...articles.map((article) => article.title)];
//     const dialogString = JSON.stringify(dialogue);
//     return `Here's a list of the titles of the articles discussed in this podcast: "${articleTitles.join('", "')}". Come up with the rest of the sentence for 'today we'll be talking about:...'`;
//   } else {
//     if (previousComment) {
//       console.log('generating follow up comments')
//       return `For your knowledge and conversational context, here is what has been said so far in this dialog with your cohost: "${dialogString}". Here is the article: "${article}". Here's what your co-host just said about it: "${previousComment}". Keep your comments short and interesting, and be careful NEVER to directly or indirectly repeat what the other host said.`;
//     } else {
//       console.log('generating article commentary')
//       return `For your knowledge and conversational context, here is what has been said so far in this dialog with your cohost: "${dialogString}". Here's an article summary: "${article}". Reflect on it and share your thoughts, starting the conversation with a summary of the article. Feel free to quote selections from the article from time to time. Keep your comments engaging and insightful but also short and to the point. Never start with a hello or greeting.`;
//     }
//   }
// }

// // Helper: Generate commentary for a host
// async function generateHostComment(host, article, previousComment = null, articles = [], dialogue) {
//   if (articles !== undefined && articles.length > 0) {
//     console.log(`Generating intro comments for ${host.name}...`)
//   } else if (previousComment) {
//     console.log(`Generating follow up comments for ${host.name}...`)
//   }
//     else {
// console.log(`Generating article commentary for ${host.name}...`); 
//     }
//   const response = await axios.post('https://api.x.ai/v1/chat/completions', {
//       model: 'grok-beta',
//       messages: [
//         {
//           role: 'system',
//           content: generateSystemPrompt(host, articles),

//       },
//       {
//           role: 'user',
//           content: generateUserPrompt(article, previousComment, articles, dialogue),
//       },
//       ],
//       temperature: 0.8,
//   }, {
//       headers: {
//           Authorization: `Bearer ${process.env.XAI_BEARER_TOKEN}`,
//           'Content-Type': 'application/json',
//       },
//   });
//   // console.log(`Host ${host.name} comment:`, response.data.choices[0].message.content.trim());
//   return response.data.choices[0].message.content.trim();
// }

// async function generateBanter(commentA, commentB, aliasA = 'Socrates', aliasB = 'Hypatia', dialogue) {
//   dialogString = JSON.stringify(dialogue);
//   // use a random generator to pick a number of alternating lines between 3 and 7
//   // 3 lines is the minimum, 7 lines is the maximum
//   const numLines = Math.floor(Math.random() * 5) + 3;
//   console.log('Generating banter between', aliasA, 'and', aliasB, 'with', numLines, 'lines...');
//   const response = await axios.post('https://api.x.ai/v1/chat/completions', {
//       model: 'grok-beta',
//       messages: [
//           {
//               role: 'system',
//               content: `You are generating playful, witty banter between two podcast hosts. 
//                   Host A is ${aliasA}, and Host B is ${aliasB}. Hosts do not use any say each others names or aliases since they're the only two people talking.
//                   Alternate lines with ${aliasA} making a playfull or serious remark and ${aliasB} responding. Consider everything that has been said so far in the ${dialogString} and build on it while being careful NEVER to directly or indirectly repeat what has been said before unless intentionally quoting it.`,
//           },
//           {
//               role: 'user',
//               content: `${aliasA} said: "${commentA}". ${aliasB} said: "${commentB}". Generate a short, fun exchange of no more than ${numLines} alternating lines.`,
//           },
//       ],
//       temperature: 0.8,
//   },{
//     headers: {
//         Authorization: `Bearer ${process.env.XAI_BEARER_TOKEN}`,
//         'Content-Type': 'application/json',
//     },
// }
// );
//   const banter = response.data.choices[0].message.content.trim();
//   const banterLines = splitBanter(banter).map((line, index) => ({
//     text: line.text.replace(/^.*? (said|responded|replied|added|concluded|laughed): /, '').replace(/^[RS]:\s*/, '').replace(/^\*\*[RS]\*\*:\s*/, '').replace(/^\*\*[RS]:\*\*\s*/, '').replace(/^[RS] laughed/, '(laughs)').replace(/-/, ''), // Strip "S said: ", "R said: ", "S responded: ", "R responded: ", "S replied: ", "R replied: ", "S added: ", "R added: ", "S concluded: ", "R concluded: ", "S: ", "R: ", "**R:** ", "**S:** ", and replace "S laughed" or "R laughed" with "(laughs)" and remove "-"
//     speaker: index % 2 === 0 ? aliasA : aliasB,
//     isBanter: true,
//   }));
//   return banterLines;
// }

// function chunkDialogueByBytes(dialogue, byteLimit = 2500) {
//   console.log('chunking dialogue...');
//   const chunks = [];
//   let currentChunk = [];
//   let currentSize = 0;

//   for (const turn of dialogue) {
//       const turnSize = Buffer.byteLength(JSON.stringify(turn), 'utf8');

//       // if (turnSize > byteLimit) {
//       //     // Recursively split large turns
//       //     const splitTurns = splitTurnWithInterjections(turn, byteLimit);
//       //     splitTurns.forEach(splitTurn => {
//       //         const splitSize = Buffer.byteLength(JSON.stringify(splitTurn), 'utf8');
//       //         if (currentSize + splitSize > byteLimit) {
//       //             chunks.push(currentChunk);
//       //             currentChunk = [];
//       //             currentSize = 0;
//       //         }
//       //         currentChunk.push(splitTurn);
//       //         currentSize += splitSize;
//       //     });
//       // } else {
//           if (currentSize + turnSize > byteLimit) {
//               chunks.push(currentChunk);
//               currentChunk = [];
//               currentSize = 0;
//           }
//           currentChunk.push(turn);
//           currentSize += turnSize;
//       // }
//   }

//   if (currentChunk.length > 0) {
//       chunks.push(currentChunk);
//   }

//   return chunks;
// }

// function splitLongTurns(dialogue, maxLength = 1000000) {
//   return dialogue.flatMap(turn => {
//     const text = turn.text;
//     const sentences = text.split(/(?<=[.!?])\s+/); // Split text into sentences
//     const chunks = [];
//     let currentChunk = '';
//     let currentChunkSize = 0;

//     for (const sentence of sentences) {
//       const sentenceSize = Buffer.byteLength(sentence, 'utf8');

//       if (currentChunkSize + sentenceSize > maxLength) {
//         // Push the current chunk and start a new one
//         chunks.push({ ...turn, text: currentChunk.trim() });
//         currentChunk = sentence;
//         currentChunkSize = sentenceSize;
//       } else {
//         currentChunk += ` ${sentence}`;
//         currentChunkSize += sentenceSize;
//       }
//     }

//     // Push the final chunk
//     if (currentChunk.trim()) {
//       chunks.push({ ...turn, text: currentChunk.trim() });
//     }

//     return chunks;
//   });
// }

// // Process banter into shorter lines if necessary
// function splitBanter(text, maxLineLength = 200) {
//   // console.log('2. Splitting banter text:', text);
//   const lines = text.split(/[\r\n]+/).map(line => line.trim()).filter(Boolean); // Clean and split
//   const banterDialogue = [];
//   let lastSpeaker = null;

//   lines.forEach(line => {
//     const speaker = lastSpeaker === 'Hypatia' ? 'Socrates' : 'Hypatia';
//     const chunks = splitLongText(line, maxLineLength);
//     chunks.forEach(chunk => {
//       banterDialogue.push({ text: chunk, speaker });
//     });
//     lastSpeaker = speaker;
//   });

//   return banterDialogue;
// }
// // Helper function to split long text into chunks
// function splitLongText(text, maxLength = 1000) {
//   const sentences = text.split(/(?<=[.!?])\s+/); // Split by sentences
//   const chunks = [];
//   let currentChunk = '';

//   for (const sentence of sentences) {
//       if ((currentChunk + sentence).length > maxLength) {
//           // If adding the sentence exceeds the max length, push the current chunk
//           chunks.push(currentChunk.trim());
//           currentChunk = sentence;
//       } else {
//           currentChunk += ` ${sentence}`;
//       }
//   }

//   // Push the remaining chunk
//   if (currentChunk.trim()) {
//       chunks.push(currentChunk.trim());
//   }

//   return chunks;
// }

// function cleanDialogueForSynthesis(dialogue) {
//   return dialogue.flatMap(turn => {
//       // Remove Markdown artifacts and trim the text
//       let cleanText = turn.text.replace(/(\*\*.*?:\*\*|\*.*?\*)/g, '').trim();

//       // Skip empty or invalid entries
//       if (!cleanText) {
//           console.warn(`Skipping empty or invalid turn: ${JSON.stringify(turn)}`);
//           return [];
//       }

//       // Split long text into smaller chunks
//       const shortTexts = splitLongText(cleanText);

//       // Map each chunk back into the dialogue format
//       return shortTexts.map(textChunk => ({
//           ...turn, // Retain other properties of the turn
//           text: textChunk,
//       }));
//   });
// }

// async function synthesizeDialogue(dialogueRaw, audioFileName) {
//   // const client = new textToSpeech.TextToSpeechClient();
//   const client = new textToSpeech.TextToSpeechClient({
//     keyFilename: 'config/google-service-account-key.json',
//     projectId: 'gentle-shell-442906-t7',
//   });


//   // client.setLogger(console);
//   // Pre-clean and split dialogue into chunks
//   // console.log('11 dialogue...', dialogueRaw);
//   const cleanedDialogue = cleanDialogueForSynthesis(dialogueRaw);
//   // console.log('22Cleaned dialogue:', cleanedDialogue);
//   const chunks = chunkDialogueByBytes(cleanedDialogue, 1400);
//   // console.log('333Chunked:', chunks);

//   const audioFiles = [];
//   for (const [index, chunk] of chunks.entries()) {
//       if (!chunk || chunk.length === 0) {
//           console.warn(`Skipping empty chunk ${index + 1}.`);
//           continue;
//       }

//       const markup = { turns: chunk }; // Prepare chunk for synthesis
//       const markupString = JSON.stringify(markup, null, 2);
//       const voice_name = 'en-US-Studio-O';
//       const request = {
//           // input: { multiSpeakerMarkup: markup },
//           input: { text: markupString },
//           // voice: { languageCode: 'en-US', name: 'en-US-Studio-Multispeaker' },
//           voice: {languageCode: 'en-US', ssmlGender: 'FEMALE', name: voice_name},
//           audioConfig: { 
//             audioEncoding: 'MP3',
//             speakingRate: 1.25,
//            },
//       };
//       console.log('Request:', JSON.stringify(request, null, 2)); // Log the request

//       try {
//           console.log(`Synthesizing chunk ${index + 1}...`);
//           const [response] = await client.synthesizeSpeech(request);
          
//           console.log('Response received:', response); // Log the response
//           const chunkFileName = `chunk_${index + 1}.mp3`;
//           await fs.promises.writeFile(chunkFileName, response.audioContent, 'binary');
//           audioFiles.push(chunkFileName);
//       } catch (error) {
//           console.error(`Failed to synthesize chunk ${index + 1}:`, error.message);
//       }
//   }

//   if (audioFiles.length === 0) {
//       throw new Error("No audio files were successfully synthesized.");
//   }

//   // Merge audio files into final output
//   const mergedFile = path.join('media', audioFileName);
//   await mergeAudioFiles(audioFiles, mergedFile);

//   console.log(`Merged audio file saved as: ${mergedFile}`);
//   return mergedFile;
// }

// function preprocessDialogueForSynthesis(dialogue) {
//   return dialogue
//     .filter(turn => turn.text && turn.text.trim()) // Remove empty turns
//     .map(turn => ({
//       ...turn,
//       text: turn.text.replace(/\s+/g, ' ').trim(), // Clean up spacing
//     }))
//     .flatMap(turn => splitLongTurns([turn])); // Ensure all turns are within length limits
// }



// async function generateDialogueFromArticles(articles, targetLengthSeconds = 3500, speakerA = 'S', speakerB = 'R') {

//   console.log('Generating podcast dialogue for', articles.length, 'articles...', articles);

//   const dialogue = [];
//   const speakerAPersonality = personalities.socrates;
//   const speakerBPersonality = personalities.hypatia;
//   let cumulativeDuration = 0;
//   const wordsPerSecond = 3;
//   console.log('step 1 generating intro comments with host:', speakerAPersonality.name);
//   const hostAIntro = await generateHostComment(speakerAPersonality, null, null, articles);

//   const openingLines = [
//     "O men of Athens!",
//     "Citizens!",
//     "Friends and comrades!",
//     "Noble men!",
//     "Men and gods as witnesses!"
//   ]
//   const randomIndexOpening = Math.floor(Math.random() * openingLines.length);
//   const openingLine = openingLines[randomIndexOpening];
//   const openingDuration = openingLine.split(/\s+/).length / wordsPerSecond;
//   dialogue.push({ text: `${openingLine} ${hostAIntro}`, speaker: speakerA });
//   // dialogue.push({ text: `Friends and comrades! ${hostAIntro}`, speaker: speakerA });

// // Split articles into two halves
// const half = Math.ceil(articles.length / 2);
// const articlesForAFirst = articles.slice(0, half);
// const articlesForBFirst = articles.slice(half);

// // Function for speakerA starting
// async function processArticlesWithAStarting(articles) {
//   for (const article of articles) {
//     if (cumulativeDuration >= targetLengthSeconds) {
//       console.log('Target length reached, stopping further dialogue generation.');
//       break;
//     }

//     // Generate comments
//     console.log('Generating article comments with host:', speakerAPersonality.name);
//     const hostAComment = await generateHostComment(speakerAPersonality, article.description, null, null, dialogue);
//     console.log('Generating follow-up comments with host:', speakerBPersonality.name);
//     const hostBComment = await generateHostComment(speakerBPersonality, article.description, previousComment = hostAComment, null, dialogue);

//     // Calculate durations
//     const hostACommentDuration = hostAComment.split(/\s+/).length / wordsPerSecond;
//     const hostBCommentDuration = hostBComment.split(/\s+/).length / wordsPerSecond;

//     if (cumulativeDuration + hostACommentDuration + hostBCommentDuration > targetLengthSeconds) {
//       console.log('Adding these comments would exceed target length, stopping.');
//       break;
//     }

//     // Add comments to dialogue
//     dialogue.push({ text: `${hostAComment}`, speaker: speakerA });
//     cumulativeDuration += hostACommentDuration;

//     dialogue.push({ text: `${article.title}: ${hostBComment}`, speaker: speakerB });
//     cumulativeDuration += hostBCommentDuration;

//     // Generate banter
//     if (cumulativeDuration < targetLengthSeconds) {
//       const banterDialogue = await generateBanter(hostAComment, hostBComment, speakerA, speakerB, dialogue);
//       const banterDuration = banterDialogue.reduce((sum, line) => sum + line.text.split(/\s+/).length, 0) / wordsPerSecond;

//       if (cumulativeDuration + banterDuration <= targetLengthSeconds) {
//         dialogue.push(...banterDialogue);
//         cumulativeDuration += banterDuration;
//       } else {
//         console.log('Banter skipped due to time constraints.');
//       }
//     }

//     console.log(`Cumulative duration so far: ${cumulativeDuration.toFixed(2)} seconds`);
//   }
// }

// // Function for speakerB starting
// async function processArticlesWithBStarting(article, dialogueThruHere) {
//   for (const article of articles) {
//     if (cumulativeDuration >= targetLengthSeconds) {
//       console.log('Target length reached, stopping further dialogue generation.');
//       break;
//     }

//     // Generate comments
//     console.log('Generating article comments with host:', speakerBPersonality.name);
//     const hostBComment = await generateHostComment(speakerBPersonality, article.description, null, null, dialogueThruHere);
//     console.log('Generating follow-up comments with host:', speakerAPersonality.name);
//     const hostAComment = await generateHostComment(speakerAPersonality, article.description, previousComment = hostBComment, null, dialogue);

//     // Calculate durations
//     const hostBCommentDuration = hostBComment.split(/\s+/).length / wordsPerSecond;
//     const hostACommentDuration = hostAComment.split(/\s+/).length / wordsPerSecond;

//     if (cumulativeDuration + hostACommentDuration + hostBCommentDuration > targetLengthSeconds) {
//       console.log('Adding these comments would exceed target length, stopping.');
//       break;
//     }

//     // Add comments to dialogue
//     dialogue.push({ text: `${hostBComment}`, speaker: speakerB });
//     cumulativeDuration += hostBCommentDuration;

//     dialogue.push({ text: `${article.title}: ${hostAComment}`, speaker: speakerA });
//     cumulativeDuration += hostACommentDuration;

//     // Generate banter
//     if (cumulativeDuration < targetLengthSeconds) {
//       const banterDialogue = await generateBanter(hostBComment, hostAComment, speakerB, speakerA, dialogue);
//       const banterDuration = banterDialogue.reduce((sum, line) => sum + line.text.split(/\s+/).length, 0) / wordsPerSecond;

//       if (cumulativeDuration + banterDuration <= targetLengthSeconds) {
//         dialogue.push(...banterDialogue);
//         cumulativeDuration += banterDuration;
//       } else {
//         console.log('Banter skipped due to time constraints.');
//       }
//     }

//     console.log(`Cumulative duration so far: ${cumulativeDuration.toFixed(2)} seconds`);
//   }
// }

// // Process articles
// await processArticlesWithAStarting(articlesForAFirst);
// await processArticlesWithBStarting(articlesForBFirst, dialogue);

// console.log('Final dialogue length:', cumulativeDuration.toFixed(2), 'seconds');


//   // for (const article of articles) {
//   //   if (cumulativeDuration >= targetLengthSeconds) {
//   //     console.log('Target length reached, stopping further dialogue generation.');
//   //     break;
//   //   }

//   //   // Generate comments for each host
//   //   console.log('step 2 generating article comments with host:', speakerAPersonality.name);
//   //   const hostAComment = await generateHostComment(speakerAPersonality, article.description, null, null, dialogue);
//   //   console.log('step 3 generating article follow up comments with host:', speakerBPersonality.name);
//   //   const hostBComment = await generateHostComment(speakerBPersonality, article.description, previousComment=hostAComment, null, dialogue);

//   //   // Calculate durations
//   //   const hostACommentDuration = hostAComment.split(/\s+/).length / wordsPerSecond;
//   //   const hostBCommentDuration = hostBComment.split(/\s+/).length / wordsPerSecond;

//   //   if (cumulativeDuration + hostACommentDuration + hostBCommentDuration > targetLengthSeconds) {
//   //     console.log('Adding these comments would exceed target length, stopping.');
//   //     break;
//   //   }

//   //   // Add comments to dialogue
//   //   dialogue.push(
//   //     // ...splitLongComments(
//   //       { text: `${hostAComment}`, speaker: speakerA }
//   //     // )
//   //   );
//   //   cumulativeDuration += hostACommentDuration;

//   //   dialogue.push(
//   //     // ...splitLongComments(
//   //     { text: `${article.title}: ${hostBComment}`, speaker: speakerB }
//   //   // )
//   //   );
//   //   cumulativeDuration += hostBCommentDuration;


//   //   // Generate banter if time allows
//   //   if (cumulativeDuration < targetLengthSeconds) {
//   //     // const banter1 = await insertBanter(dialogue, 3);
//   //     // console.log('1 banter after insertBanter function:', banter1);
//   //     const banterDialogue = await generateBanter(hostAComment, hostBComment, speakerA, speakerB, dialogue);
//   //     // const banterDialogue = await generateBanterDialogue(hostAComment, hostBComment, speakerA, speakerB);
//   //     // console.log('3 banter after dialogue function:', banterDialogue);

//   //     const banterDuration = banterDialogue.reduce((sum, line) => sum + line.text.split(/\s+/).length, 0) / wordsPerSecond;

//   //     if (cumulativeDuration + banterDuration <= targetLengthSeconds) {
//   //       dialogue.push(...banterDialogue);
//   //       cumulativeDuration += banterDuration;
//   //     } else {
//   //       console.log('Banter skipped due to time constraints.');
//   //     }
//   //   }

//   //   console.log(`Cumulative duration so far: ${cumulativeDuration.toFixed(2)} seconds`);
//   // }

//   // Final cleanup and structuring
//   // const structuredDialogue = groupAndAlternateSpeakers(dialogue, speakerA, speakerB);
//   const cleanedDialogue = preprocessDialogueForSynthesis(dialogue);

// 	// 1.	Ἔρρωσθε καὶ εὐδαιμονεῖτε (Errōsthe kaì eudaimoneîte)
// 	// •	Translation: “Be strong and prosperous.”
// 	// •	A common way to wish the audience well, expressing hope for their health and happiness.
// 	// 2.	Τοῖς θεοῖς ἐπιτρέπω (Toîs theoîs epitrépō)
// 	// •	Translation: “I entrust it to the gods.”
// 	// •	A humble way to conclude, acknowledging the limits of human effort and appealing to divine judgment.
// 	// 3.	Τὰ λοιπὰ θεοὶ γνώσονται (Tà loipà theoì gnṓsontai)
// 	// •	Translation: “The rest the gods will know.”
// 	// •	Used to suggest that ultimate understanding or resolution lies with the divine.
// 	// 4.	Ἀνδρείως πράττετε (Andreíōs prátete)
// 	// •	Translation: “Act courageously.”
// 	// •	A call to action, encouraging the audience to face challenges bravely.
// 	// 5.	Χάριν ἔχω ὑμῖν πᾶσιν (Chárin échō humîn pâsin)
// 	// •	Translation: “I am grateful to you all.”
// 	// •	A respectful and gracious way to thank the audience.
// 	// 6.	Εἴ τινι ἐδοκίμασα ἀδίκως, ἀναθεῖτε τοῖς θεοῖς (Eí tini edokíma adíkōs, anatheîte toîs theoîs)
// 	// •	Translation: “If I seemed unjust to anyone, entrust it to the gods.”
// 	// •	A way to end with humility, asking the audience to forgive any perceived faults.
// 	// 7.	Ζεὺς καὶ ἡ τύχη εἰς τὸ καλὸν ὑμᾶς ἀγαγέτω (Zeùs kaì hē týchē eìs tò kalòn humâs agagéto)
// 	// •	Translation: “May Zeus and fortune lead you to what is good.”
// 	// •	A formal blessing invoking divine favor for the audience.
// 	// 8.	Ἔρρωσθε καὶ μέμνησθε τῶν εἰρημένων (Errōsthe kaì mémnēsthe tōn eirēménōn)
// 	// •	Translation: “Farewell and remember what has been said.”
// 	// •	A thoughtful conclusion, urging the audience to reflect on the discourse.
//   const closingLines = [
//     "Be strong and prosperous.",
//     "I entrust it to the gods.",
//     "The rest the gods will know.",
//     "Act courageously.",
//     "I am grateful to you all.",
//     "If I seemed unjust to anyone, entrust it to the gods.",
//     "May Zeus and fortune lead you to what is good.",
//     "Farewell and remember what has been said."
//   ];
  
//   const randomIndexClosing = Math.floor(Math.random() * closingLines.length);
//   const closingLine = closingLines[randomIndexClosing];
//   const closingDuration = closingLine.split(/\s+/).length / wordsPerSecond;
//   if (cumulativeDuration + closingDuration <= targetLengthSeconds) {
//     cleanedDialogue.push({ text: closingLine, speaker: speakerA });
//   }

// console.log('cleaned dialogue:', cleanedDialogue);
  
//   const audioFileName = generateAudioFileName(articles.map(article => article.url).join(', '), 'mp3');
//   // const audioFile = generatePodcastFromArticles(cleanedDialogue, audioFileName);
//   const audioFile = await synthesizeDialogue(cleanedDialogue, audioFileName);
//   // const audioFileUrl = `https://api.oip.onl/api/media?id=${audioFile}`;
//   // const audioFileDuration = await getAudioDuration(audioFile);
//   console.log(`Generated audio available: ${audioFile}`);
//   const didTxarray = articles.map(article => article.didTx);
//   const podcastTitle = `Scribes of Alexandria Podcast with ${personalities.socrates.name} and ${personalities.hypatia.name} on ${new Date().toLocaleDateString()}`;

//   console.log('articles', articles)
//   // console.log(articles.didTxIds)
//   const recordToPublish = {
//     "basic": {
//       "name": podcastTitle,
//       "language": "en",
//       "date": Math.floor(new Date().getTime() / 1000), // Convert to Unix time
//       "description": hostAIntro,
//   //     // "urlItems": [
//   //     //   {
//   //     //     "associatedUrlOnWeb": {
//   //     //       "url": articleData.url
//   //     //     }
//   //     //   }
//   //     // ],
//       "nsfw": false,
//       // "tagItems": articleData.tags || []
//     },
//     "audio": {
//           "webUrl": `https://api.oip.onl/api/media?id=${audioFileName}`,
//           "contentType" : "audio/mp3"
//     },
//     // "post": {
//     //   "citations": didTxarray
//     // },{
//     "podcast": {
//       "citations": didTxarray,
//       "show": "string",  // Title of the podcast show
//       "episodeNum": "integer",  // Episode number
//       "seasonNum": "integer",  // Season number (optional)
//       "duration": "integer",  // Duration in seconds
//       "hosts": ["string"],  // List of hosts
//       "guests": ["string"],  // List of guests (optional)
//       "explicit": "boolean",  // Explicit content flag (redundant with NSFW but included for clarity)
//       "transcript": "string",  // Full transcript of the episode (optional)
//       "chapters": [
//         {
//           "title": "string",  // Chapter title
//           "startTime": "integer"  // Start time in seconds
//         }
//       ],
//       "episodeArtwork": "string",  // URL to episode-specific artwork (optional)
//       "podcastArtwork": "string",  // URL to default podcast artwork (optional)
//       "license": "string",  // License type (e.g., Creative Commons)
//       "copyright": "string",  // Copyright information
//       // "sponsors": ["string"],  // Sponsors of the episode
//       // "rssFeedUrl": "string",  // RSS feed URL
//       // "analytics": {
//       //   "uniqueEpisodeId": "string",  // Unique identifier for the episode
//       //   "downloadCount": "integer",  // Number of downloads
//       //   "playCount": "integer"  // Number of plays or streams
//       // },
//       // "extra": {
//       //   "affiliateLinks": ["string"],  // Affiliate links related to the episode (optional)
//       //   "donationLinks": ["string"]  // Links to donation platforms (optional)
//     }
//   }

// console.log('recordToPublish:', recordToPublish)
// // const podcast = await publishNewRecord(recordToPublish, "audio");
// const podcastDidTx = podcast.didTx

// let record = {
//   "data": [recordToPublish],
//   "oip": {
//     "didTx": podcastDidTx,
//     "indexedAt": new Date().toISOString(),
//   }
// };

// // console.log('max in db and current:', records, currentblock);
// const currentblock = await getCurrentBlockHeight();

// record.oip.inArweaveBlock = currentblock;
// record.oip.recordType = 'audio';
// record.oip.indexedAt = new Date().toISOString();
// record.oip.recordStatus = 'pending confirmation in Arweave';
// console.log('303 indexRecord pending record to index:', record);
// // indexRecord(record);



// const response = {
//   audioFileName: audioFileName,
//   podcastDidTx: podcastDidTx,
// }

//   //   //     // articles.map(article => article.)
//   //   //   // "bylineWriter": articleData.byline,
//   //   //   // "articleText": [
//   //   //   //   { 
//   //   //   //     "text": {
//   //   //   //     // "bittorrentAddress": articleTextBittorrentAddress,
//   //   //   //     "contentType": "text/text"
//   //   //   //     },
//   //   //   //     "associatedUrlOnWeb": {
//   //   //   //     "url": articleTextURL
//   //   //   //   // },
//   //   //   //   // "basic": {
//   //   //   //     // "urlItems": [
//   //   //   //     //   {
//   //   //   //     //     "associatedUrlOnWeb": {
//   //   //   //     //       "url": articleData.articleTextURL
//   //   //   //     //     }
//   //   //   //     //   }
//   //   //   //     // ]
//   //   //   //     }
//   //   //   //   }
//   //   //   // ]
//   //   // },
//   //   "associatedUrlOnWeb": {
//   //     "url": articleData.url
//   //   }
//   // };
//   // if (articleData.embeddedImage) {
//   //   recordToPublish.post.featuredImage = [
//   //     {
//   //       "basic": {
//   //         "name": articleData.title,
//   //         "language": "en",
//   //         "nsfw": false,
//   //         // "urlItems": [
//   //         //   {
//   //         //     "associatedUrlOnWeb": {
//   //         //       "url": articleData.embeddedImage
//   //         //     }
//   //         //   }
//   //         // ]
//   //       },
//   //       "associatedUrlOnWeb": {
//   //         "url": articleData.embeddedImageUrl
//   //       },
//   //       "image": {
//   //         // "bittorrentAddress": imageBittorrentAddress,
//   //         "height": imageHeight,
//   //         "width": imageWidth,
//   //         "size": imageSize,
//   //         "contentType": imageFileType
//   //       }
//   //     }
//   //   ];
//   // }

//   // if (articleData.summaryTTS) {
//   //   recordToPublish.post.audioItems = [
//   //     { 
//   //       "audio": {
//   //         "webUrl": articleData.summaryTTS,
//   //         "contentType" : "audio/mp3"
//   //       }
//   //     }
//   //   ];
//   // }

//   // console.log('this is whats getting published:', recordToPublish)

//   // publishNewRecord(record, recordType,
//   return response;
// }

// END OF GENERATE DIALOGUE FROM ARTICLES

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

async function analyzeImageForAuthor(screenshotURL) {
  console.log('Analyzing image for author using XAI API...');

  const messages = [
      {
          role: "system",
          content: `You are an AI tasked with extracting the author name from an article's screenshot. Analyze the screenshot, identify the section where the author (byline) is mentioned, and return the extracted author name.`
      },
      {
          role: "user",
          content: `Here's the screenshot of the article: ${screenshotURL}. Please extract the author's name.`
      }
  ];

  try {
      const response = await axios.post('https://api.x.ai/v1/chat/completions', {
          model: 'grok-beta',
          messages: messages,
          stream: false,
          temperature: 0
      }, {
          headers: {
              'Authorization': `Bearer ${process.env.XAI_BEARER_TOKEN}`,
              'Content-Type': 'application/json',
          },
          timeout: 120000 // Optional: 120 seconds timeout
      });

      if (response.data && response.data.choices && response.data.choices[0]) {
          const extractedAuthor = response.data.choices[0].message.content.trim();
          console.log('Extracted author:', extractedAuthor);
          return extractedAuthor;
      } else {
          console.error('Unexpected response structure:', response);
          return null;
      }
  } catch (error) {
      console.error('Error analyzing image for author:', error.response ? error.response.data : error.message);
      return null;
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

      Provide the tags in a comma-separated format, with primary topics first, followed by any secondary or related subjects, but keep it to a reasonable number of tags.`
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
  'Dr.': 'Doctor',
  'Mr': 'Mister',
  'Mr.': 'Mister',
  'Mrs': 'Mistress',
  'Mrs.': 'Mistress',
  'Ms': 'Miss',
  'Ms.': 'Miss',
  'Prof': 'Professor',
  'St': 'Saint',
  'St.': 'Street',
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
  'Co': 'Company',
  'Co.': 'Company',
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
    // generateSpeech,
    getVoiceModels,
    replaceAcronyms,
    identifyAuthorNameFromContent,
    identifyPublishDateFromContent,
    generateSummaryFromContent,
    analyzeImageForAuthor,
    generateTagsFromContent,
    generateCombinedSummaryFromArticles,
    generateDialogueFromArticles,
    generateDateFromRelativeTime,
    retryAsync
}




//////////////////////////////////////////////////////////////////////

// async function mergeAudioFiles(audioFiles, outputFileName) {
//   const ffmpegCommand = ffmpeg();
//   audioFiles.forEach(file => ffmpegCommand.input(file));

//   return new Promise((resolve, reject) => {
//       ffmpegCommand
//           .on('error', err => reject(`Error merging audio files: ${err.message}`))
//           .on('end', () => resolve(outputFileName))
//           .mergeToFile(outputFileName, './temp/');
//   });
// }

// const {TextToSpeechClient} = require('@google-cloud/text-to-speech')
// const { TextToSpeechClient, TextToSpeechLongAudioSynthesizeClient, protos, texttospeech } = require('@google-cloud/text-to-speech');
// const {writeFile} = require('node:fs/promises');


// async function generateSpeech(req, res) {
//     const { text, model_name, vocoder_name, useSelfHosted } = req.body;

//     try {
//         let response;

//         if (useSelfHosted) {
//             // Call the self-hosted Coqui TTS API
//             // response = await axios.post('http://speech-synthesizer:8082/synthesize',
//             response = await axios.post('http://localhost:8082/synthesize',
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
// function groupAndAlternateSpeakers(dialogue, speakerA = 'R', speakerB = 'S') {
//   let currentSpeaker = speakerA; // Default to Speaker A for non-banter sections
//   let lastBanterSpeaker = speakerB; // Track the last speaker for banter sections

//   return dialogue.map((turn, index) => {
//     if (turn.isBanter) {
//       // Alternate speakers for banter
//       turn.speaker = lastBanterSpeaker === speakerA ? speakerB : speakerA;
//       lastBanterSpeaker = turn.speaker;
//     } else {
//       // Ensure one speaker dominates non-banter sections
//       turn.speaker = currentSpeaker;

//       // Change the speaker only if the next turn is non-banter and not from the same speaker
//       const nextTurn = dialogue[index + 1];
//       if (nextTurn && !nextTurn.isBanter && nextTurn.speaker !== currentSpeaker) {
//         currentSpeaker = currentSpeaker === speakerA ? speakerB : speakerA;
//       }
//     }
//     return turn;
//   });
// }
// function splitTurnWithInterjections(turn, byteLimit = 10000, interject = true) {
//   const { text, speaker, ...rest } = turn;
//   const sentences = text.split(/(?<=[.!?])\s+(?!\.\.\.)/);
//   let currentChunk = '';
//   let currentSize = 0;
//   const chunks = [];

//   for (const sentence of sentences) {
//     const sentenceSize = Buffer.byteLength(JSON.stringify({ text: currentChunk + sentence, speaker, ...rest }), 'utf8');

//     if (currentSize + sentenceSize > byteLimit) {
//       // Push the current chunk
//       chunks.push({ text: currentChunk.trim(), speaker, ...rest });

//       // Optionally add an interjection if enabled
//       // if (interject && chunks.length > 1) {
//       //   chunks.push({
//       //     text: "*Hmm, that's an interesting point. But let me pause you there to add something.*",
//       //     speaker: speaker === 'R' ? 'S' : 'R', // Alternate the speaker
//       //     ...rest,
//       //   });
//       // }

//       currentChunk = sentence; // Start a new chunk
//       currentSize = Buffer.byteLength(JSON.stringify({ text: sentence, speaker, ...rest }), 'utf8');
//     } else {
//       currentChunk += ` ${sentence}`;
//       currentSize += sentenceSize;
//     }
//   }

//   // Add the final chunk
//   if (currentChunk.trim()) {
//     chunks.push({ text: currentChunk.trim(), speaker, ...rest });
//   }

//   return chunks;
// }

// async function insertBanter(dialogue, maxBanterSections = 3) {
//   const banterDialogue = [];
//   let banterCount = 0;

//   for (let i = 0; i < dialogue.length; i++) {
//     const turn = dialogue[i];
//     banterDialogue.push(turn);

//     // Check if banter is appropriate
//     if (banterCount < maxBanterSections && i < dialogue.length - 1 && !turn.isBanter) {
//       const nextTurn = dialogue[i + 1];

//       if (nextTurn && !nextTurn.isBanter && turn.speaker !== nextTurn.speaker) {
//         const generatedBanter = await generateBanter(turn.text, nextTurn.text); // Async banter generation
//         if (generatedBanter.length) {
//           banterDialogue.push(...generatedBanter);
//           banterCount++;
//         }
//       }
//     }
//   }

//   return banterDialogue;
// }

// // function chunkDialogueByBytesWithInterjections(dialogue, byteLimit = 3000) {
// //   const chunks = [];
// //   let currentChunk = [];
// //   let currentSize = 0;

// //   for (const turn of dialogue) {
// //     const turnSize = Buffer.byteLength(JSON.stringify(turn), 'utf8');

// //     if (turnSize > byteLimit) {
// //       const splitTurns = splitTurnWithInterjections(turn, byteLimit);
// //       for (const splitTurn of splitTurns) {
// //         const splitSize = Buffer.byteLength(JSON.stringify(splitTurn), 'utf8');

// //         if (currentSize + splitSize > byteLimit) {
// //           chunks.push(currentChunk);
// //           currentChunk = [];
// //           currentSize = 0;
// //         }

// //         currentChunk.push(splitTurn);
// //         currentSize += splitSize;
// //       }
// //     } else {
// //       if (currentSize + turnSize > byteLimit) {
// //         chunks.push(currentChunk);
// //         currentChunk = [];
// //         currentSize = 0;
// //       }

// //       currentChunk.push(turn);
// //       currentSize += turnSize;
// //     }
// //   }

// //   if (currentChunk.length > 0) {
// //     chunks.push(currentChunk);
// //   }

// //   return chunks;
// // }

// function validateAndAlternateSpeakers(dialogue) {
//   let lastSpeakerNonBanter = 'S'; // Track last speaker for non-banter
//   let lastSpeakerBanter = 'Socrates'; // Track last speaker for banter

//   return dialogue.map(turn => {
//       if (turn.isBanter) {
//           turn.speaker = lastSpeakerBanter === 'Socrates' ? 'Hypatia' : 'Socrates';
//           lastSpeakerBanter = turn.speaker;
//       } else {
//           turn.speaker = lastSpeakerNonBanter === 'R' ? 'S' : 'R';
//           lastSpeakerNonBanter = turn.speaker;
//       }
//       return turn;
//   });
// }

// function cleanAndSplitDialogue(dialogueRaw) {
//   return dialogueRaw.flatMap(turn => {
//     if (turn.isBanter) {
//       return splitBanter(turn.text).map(chunk => ({
//         ...chunk,
//         speaker: chunk.speaker === 'Hypatia' || chunk.speaker === 'Socrates' ? chunk.speaker : 'R', // Default to R
//         isBanter: true,
//       }));
//     }
//     return [turn]; // Leave non-banter turns intact
//   });
// }

// function cleanBanter(dialogue) {
//   return dialogue.map(turn => {
//     if (turn.isBanter) {
//       turn.text = turn.text.replace(/^(\w+):\s*/, ''); // Remove "Speaker: " at the start
//     }
//     return turn;
//   });
// }

// // Call this function before synthesizing the dialogue
// // const cleanedDialogue = cleanBanter(dialogue);


// function validateMultiSpeakerMarkup(markup) {
//   return markup.filter(turn => turn.text && turn.text.trim() !== '');
// }

// function mapNamesToGoogleFormat(dialogue) {
//   return dialogue.map(turn => ({
//       ...turn,
//       speaker: turn.speaker === 'Hypatia' ? 'R' : turn.speaker === 'Socrates' ? 'S' : turn.speaker,
//   }));
// }

// async function synthesizeDialogue(dialogueRaw, audioFileName) {
//   const client = new textToSpeech.TextToSpeechClient();

//   // Pre-clean dialogue
//   const dialoguePreclean = cleanAndSplitDialogue(dialogueRaw);
//   const dialogueClean = cleanDialogueForSynthesis(dialoguePreclean);
//   const validatedDialogue = validateAndAlternateSpeakers(dialogueClean);
//   const cleanedDialogue = cleanBanter(validatedDialogue);

//   // Split into safe chunks by byte size
//   const chunks = chunkDialogueByBytes(cleanedDialogue, 3000);

//   const audioFiles = [];
//   for (const [index, chunk] of chunks.entries()) {
//     if (!chunk || chunk.length === 0) {
//       console.warn(`Chunk ${index + 1} is empty, skipping.`);
//       continue;
//     }

//     const markup = { turns: chunk }; // Wrap the chunk
//     const request = {
//       input: { multiSpeakerMarkup: markup },
//       voice: { languageCode: 'en-US', name: 'en-US-Studio-Multispeaker' },
//       audioConfig: { audioEncoding: 'MP3' },
//     };

//     console.log(`Synthesizing chunk ${index + 1}...`);
//     const [response] = await client.synthesizeSpeech(request);
//     const chunkFileName = `chunk_${index + 1}.mp3`;
//     await fs.promises.writeFile(chunkFileName, response.audioContent, 'binary');
//     audioFiles.push(chunkFileName);
//   }

//   // Merge audio files
//   const mergedFile = path.join('media', audioFileName);
//   await mergeAudioFiles(audioFiles, mergedFile);

//   return audioFileName;
// }

// async function synthesizeDialogue(dialogueRaw, audioFileName) {
//   const client = new textToSpeech.TextToSpeechClient();

//   // const dialoguePreclean = cleanAndSplitDialogue(dialogueRaw);
//   console.log('synthesizeDialogue stages: 1 dialogueRaw:', dialogueRaw);
//   dialogueRaw = cleanDialogueForSynthesis(dialogueRaw);
//   // const validatedDialogue = validateAndAlternateSpeakers(dialogueClean);
//   // const cleanedDialogue = cleanBanter(validatedDialogue);
// console.log('synthesizeDialogue stages: 2 dialogueRaw:', dialogueRaw);
//   const chunks = chunkDialogueByBytesWithInterjections(dialogueRaw, 2500);

//   const audioFiles = [];
//   for (const [index, chunk] of chunks.entries()) {
//     if (!chunk || chunk.length === 0) {
//       console.warn(`Chunk ${index + 1} is empty, skipping.`);
//       continue;
//     }

//     const markup = { turns: chunk };
//     const request = {
//       input: { multiSpeakerMarkup: markup },
//       voice: { languageCode: 'en-US', name: 'en-US-Studio-Multispeaker' },
//       audioConfig: { audioEncoding: 'MP3' },
//     };

//     const [response] = await client.synthesizeSpeech(request);
//     const chunkFileName = `chunk_${index + 1}.mp3`;
//     await fs.promises.writeFile(chunkFileName, response.audioContent, 'binary');
//     audioFiles.push(chunkFileName);
//   }

//   const mergedFile = path.join('media', audioFileName);
//   await mergeAudioFiles(audioFiles, mergedFile);

//   return audioFileName;
// }

// async function generateDialogueFromArticles(articles, targetLengthSeconds = 2100) {
//   console.log('Generating podcast dialogue for', articles.length, 'articles...');
//   const dialogue = [];
//   dialogue.push({ text: "Hey peeps! Let's dive into these articles.", speaker: "R" });

//   let cumulativeDuration = 0;
//   const wordsPerSecond = 2.5;

//   for (const article of articles) {
//     if (cumulativeDuration >= targetLengthSeconds) {
//       console.log('Target length reached, stopping further dialogue generation.');
//       break;
//     }

//     // Generate comments for each host
//     const hostAComment = await generateHostComment(personalities.hypatia, article.description);
//     const hostBComment = await generateHostComment(personalities.socrates, article.description);

//     // Calculate durations
//     const hostACommentDuration = hostAComment.split(/\s+/).length / wordsPerSecond;
//     const hostBCommentDuration = hostBComment.split(/\s+/).length / wordsPerSecond;

//     if (cumulativeDuration + hostACommentDuration + hostBCommentDuration > targetLengthSeconds) {
//       console.log('Adding these comments would exceed target length, stopping.');
//       break;
//     }

//     // Add comments to dialogue
//     dialogue.push(...splitLongComments({ text: `${article.title}: ${hostAComment}`, speaker: "R" }));
//     cumulativeDuration += hostACommentDuration;

//     dialogue.push(...splitLongComments({ text: `${hostBComment}`, speaker: "S" }));
//     cumulativeDuration += hostBCommentDuration;

//     // Generate banter if time allows
//     if (cumulativeDuration < targetLengthSeconds) {
//       const banterDialogue = await generateBanterDialogue(hostAComment, hostBComment);
//       const banterDuration = banterDialogue.reduce((sum, line) => sum + line.text.split(/\s+/).length, 0) / wordsPerSecond;

//       if (cumulativeDuration + banterDuration <= targetLengthSeconds) {
//         dialogue.push(...banterDialogue);
//         cumulativeDuration += banterDuration;
//       } else {
//         console.log('Banter skipped due to time constraints.');
//       }
//     }

//     console.log(`Cumulative duration so far: ${cumulativeDuration.toFixed(2)} seconds`);
//   }

//   // Final cleanup and structuring
//   const structuredDialogue = groupAndAlternateSpeakers(dialogue);
//   const cleanedDialogue = preprocessDialogueForSynthesis(structuredDialogue);

//   // Add closing line
//   const closingLine = "That's all for today! Thanks for tuning in.";
//   const closingDuration = closingLine.split(/\s+/).length / wordsPerSecond;
//   if (cumulativeDuration + closingDuration <= targetLengthSeconds) {
//     cleanedDialogue.push({ text: closingLine, speaker: "R" });
//   }

//   console.log('Final dialogue duration:', cumulativeDuration.toFixed(2), 'seconds');
//   console.log('Dialogue:', cleanedDialogue);

//   const audioFileName = generateAudioFileName(articles.map(article => article.url).join(', '), 'mp3');
//   const audioFile = await synthesizeDialogue(cleanedDialogue, audioFileName);
//   console.log(`Generated audio available: ${audioFile}`);
//   return audioFileName;
// }


// Helper: Generate Long Form Audio Using REST API
// async function generateLongFormAudioUsingApi(dialogue, projectId, bucketName) {
//   console.log('Generating long-form audio using REST API...');

//   // Construct `multiSpeakerMarkup` object
//   const multiSpeakerMarkup = {
//       turns: dialogue.map(turn => ({
//           text: turn.text,
//           speaker: turn.speaker,
//       })),
//   };

//   // Define output GCS location
//   const outputFileName = `podcast_audio_${Date.now()}.wav`;
//   const outputGcsUri = `gs://${bucketName}/${outputFileName}`;
//   console.log(`Output GCS URI: ${outputGcsUri}`);

//   // API request payload
//   const requestBody = {
//       parent: `projects/${projectId}/locations/global`,
//       audioConfig: {
//           audioEncoding: 'LINEAR16',
//       },
//       input: {
//           multiSpeakerMarkup,
//       },
//       voice: {
//           languageCode: 'en-US',
//           name: 'en-US-Studio-Multispeaker',
//       },
//       output_gcs_uri: outputGcsUri,
//   };
  
//   let token = process.env.GOOGLE_API_TOKEN;
//   if (!token) {
//       // throw new Error('Unable to retrieve Google Cloud access token.');
//       // Fetch an access token using gcloud command
//       token = (
//           await axios.get('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
//               headers: { 'Metadata-Flavor': 'Google' },
//           })
//       ).data.access_token;
//   }


//   // API endpoint
//   const apiUrl = `https://texttospeech.googleapis.com/v1beta1/projects/${projectId}/locations/global:synthesizeLongAudio`;

//   try {
//       console.log('Sending request to Google Cloud API...');
//       const response = await axios.post(apiUrl, requestBody, {
//           headers: {
//               'Authorization': `Bearer ${token}`,
//               'Content-Type': 'application/json',
//           },
//       });

//       // The response contains a long-running operation name
//       const operationName = response.data.name;
//       console.log(`Operation started: ${operationName}`);

//       // Poll for the operation status
//       let operationResponse;
//       do {
//           console.log('Checking operation status...');
//           operationResponse = await axios.get(
//               `https://texttospeech.googleapis.com/v1beta1/${operationName}`,
//               {
//                   headers: {
//                       'Authorization': `Bearer ${token}`,
//                   },
//               }
//           );

//           const { done, metadata } = operationResponse.data;
//           if (done) {
//               console.log('Audio synthesis completed!');
//               break;
//           }
//           console.log(`Progress: ${metadata?.progressPercentage || 0}%`);
//           await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before polling again
//       } while (!operationResponse.data.done);

//       console.log(`Audio file generated at: ${outputGcsUri}`);

//       return outputGcsUri;
//   } catch (error) {
//       console.error('Error during synthesis:', error.response?.data || error.message);
//       throw error;
//   }
// }
