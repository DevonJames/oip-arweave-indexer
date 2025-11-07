const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
// const { crypto } = require('crypto');
const base64url = require('base64url');
// Optional canvas dependency - gracefully handle if not installed
let canvasModule = null;
try {
  canvasModule = require('canvas');
} catch (error) {
  console.warn('Canvas module not available - image stitching will be disabled');
}
const nodeHtmlToImage = require('node-html-to-image');
const router = express.Router();
const path = require('path');
const cheerio = require('cheerio');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');  // For generating a unique hash
// const progress = require('progress-stream');
const ProgressBar = require('progress');
const Parser = require('@postlight/parser');
// const { video_basic_info } = require('play-dl');
const sharp = require('sharp');
const { timeout } = require('../config/arweave.config');
const { getRecords, indexRecord, searchCreatorByAddress } = require('../helpers/elasticsearch');
const { publishNewRecord } = require('../helpers/templateHelper');
const { authenticateToken, getWalletFilePath } = require('../helpers/utils'); // Import the authentication middleware
const { ongoingScrapes, cleanupScrape } = require('../helpers/sharedState.js'); // Adjust the path to store.js
// const { retryAsync } = require('../helpers/utils');
const { uploadToArFleet, publishVideoFiles, publishArticleText, publishImage } = require('../helpers/templateHelper');

// Optional puppeteer dependency - gracefully handle if not installed
let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch (error) {
  console.warn('Puppeteer not available - web article archiving will be disabled');
}

// const { FirecrawlApp } = require('@mendable/firecrawl-js');
// const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

// const cheerio = require('cheerio');

// Initialize FirecrawlApp with your API key

const {
  replaceAcronyms,
  identifyAuthorNameFromContent, 
  identifyPublishDateFromContent, 
  generateSummaryFromContent,
  analyzeImageForRecipe,
  analyzeImageForAuthor,
  synthesizeSpeech
} = require('../helpers/generators');
const {getCurrentBlockHeight, getBlockHeightFromTxId, lazyFunding, upfrontFunding, arweave} = require('../helpers/arweave');
const { exec } = require('child_process');
const { text } = require('body-parser');
const { send } = require('process');

console.log('authenticateToken:', authenticateToken);

require('dotenv').config();

// Import URL helper for consistent URL generation
const { getBaseUrl, getMediaUrl } = require('../helpers/urlHelper');

// Add this line near the top of your file, after your imports
// const ongoingScrapes = new Map();

// Create a directory to store the audio files if it doesn't exist
const audioDirectory = path.join(__dirname, '../media');
if (!fs.existsSync(audioDirectory)) {
    fs.mkdirSync(audioDirectory);
}

// Use the same directory for downloaded files
const downloadsDirectory = path.join(__dirname, '../media');
if (!fs.existsSync(downloadsDirectory)) {
    fs.mkdirSync(downloadsDirectory);
}

// LLM-based recipe parser for when traditional parsing fails
async function parseRecipeWithLLM(htmlContent, url, metadata) {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  
  if (!openaiApiKey) {
    console.error('OpenAI API key not configured - cannot use LLM fallback');
    throw new Error('OpenAI API key not configured');
  }

  try {
    console.log('🤖 Using OpenAI to extract recipe from HTML...');
    
    // Extract text content from HTML (remove scripts, styles, etc.)
    const $ = cheerio.load(htmlContent);
    $('script, style, nav, header, footer, .ad, .advertisement').remove();
    const textContent = $('body').text().replace(/\s+/g, ' ').trim();
    
    // Limit text size to avoid token limits (keep first 8000 chars)
    const limitedText = textContent.substring(0, 8000);
    
    console.log(`Sending ${limitedText.length} characters to OpenAI for recipe extraction`);
    
    // Use OpenAI's Chat Completions API with structured outputs
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
              {
                role: 'system',
                content: 'You are a recipe extraction expert. Extract complete recipe information from the provided text. Parse ingredient strings to separate amounts, units, names, and comments. Comments include preparation notes like "minced", "chopped", "sliced", "diced", "optional", "to taste", etc. - these typically appear after commas or in parentheses. For timing, convert to minutes.'
              },
              {
                role: 'user',
                content: `Extract the recipe from this webpage text. Return complete recipe data including title, description, ingredients (with amount, unit, name, and comment separated), instructions, timing, servings, etc.\n\nFor ingredients, separate any preparation notes or modifiers into the "comment" field. Examples:\n- "2 cloves garlic, minced" → amount: 2, unit: "cloves", name: "garlic", comment: "minced"\n- "1 cup onion (diced)" → amount: 1, unit: "cup", name: "onion", comment: "diced"\n- "Salt to taste" → amount: null, unit: "", name: "salt", comment: "to taste"\n- "1 cup olive oil" → amount: 1, unit: "cup", name: "olive oil", comment: ""\n\nWebpage URL: ${url}\n\nText:\n${limitedText}`
              }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'recipe_data',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              imageUrl: { type: 'string' },
              prepTime: { type: ['number', 'null'] },
              cookTime: { type: ['number', 'null'] },
              totalTime: { type: ['number', 'null'] },
              servings: { type: ['number', 'null'] },
              cuisine: { type: ['string', 'null'] },
              course: { type: ['string', 'null'] },
                    ingredients: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          amount: { type: ['number', 'null'] },
                          unit: { type: 'string' },
                          name: { type: 'string' },
                          comment: { type: 'string' }
                        },
                        required: ['amount', 'unit', 'name', 'comment'],
                        additionalProperties: false
                      }
                    },
              instructions: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['title', 'description', 'imageUrl', 'prepTime', 'cookTime', 'totalTime', 'servings', 'cuisine', 'course', 'ingredients', 'instructions'],
            additionalProperties: false
          }
        }
      },
      temperature: 0.3 // Lower temperature for more consistent extraction
    }, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    });

    if (!response.data || !response.data.choices || !response.data.choices[0]) {
      throw new Error('No response from OpenAI');
    }

    const result = response.data.choices[0].message.content;
    console.log('✓ OpenAI response received');
    
    // Parse the JSON response
    let recipeData;
    try {
      recipeData = JSON.parse(result);
    } catch (parseError) {
      console.error('Error parsing OpenAI response:', parseError);
      throw new Error('Failed to parse OpenAI response');
    }
    
    console.log(`✓ Extracted recipe: "${recipeData.title}" with ${recipeData.ingredients.length} ingredients`);
    
    // Use metadata imageUrl as fallback if LLM didn't find one
    if (!recipeData.imageUrl && metadata.ogImage) {
      recipeData.imageUrl = metadata.ogImage;
    }
    
    return recipeData;

  } catch (error) {
    console.error('❌ Error in LLM recipe extraction:', error.message);
    if (error.response) {
      console.error('OpenAI API error:', error.response.data);
    }
    throw error;
  }
}

// Generic retry function
async function retryAsync(asyncFunction, args = [], options = { maxRetries: 5, delay: 3000, fallbackValue: null }) {
  console.log('retrying async function');
  const { maxRetries, delay, fallbackValue } = options;
  let attempts = 0;

  while (attempts < maxRetries) {
      try {
          // Attempt to execute the provided async function with the arguments
          // console.log('attempting async function', asyncFunction.name);
          console.log("asyncFunction:", asyncFunction.name, "args:", args);
          const result = await asyncFunction(...args);
          if (result !== undefined) return result;
          
          // console.log('result', result);
          // return result; // Return the result if successful
      } catch (error) {
          // Log the error
          console.error(`Error in ${asyncFunction.name}:`, error.response ? error.response.data : error.message);

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
  }
}

// Utility function to create a unique hash based on the URL or text
function generateAudioFileName(text, fileType = 'mp3') {
  return crypto.createHash('sha256').update(text).digest('hex') + '.' + fileType;
}

// Utility function to create a unique hash based on the URL or text for a text file
function generateTextFileName(text) {
  return crypto.createHash('sha256').update(text).digest('hex') + '.txt';
}

function generateImageFileName(imageUrl, fileType) {
  return crypto.createHash('sha256').update(imageUrl).digest('hex');
}

async function downloadFile(url, outputPath) {
  console.log('Downloading file to:', outputPath);
  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
    });

    const totalBytes = parseInt(response.headers['content-length'], 10);
    let progressBar;

    // Set up the progress bar only if content-length is available
    if (!isNaN(totalBytes) && totalBytes > 0) {
      progressBar = new ProgressBar('Downloading [:bar] :percent :etas', {
        complete: '=',
        incomplete: ' ',
        width: 20,
        total: totalBytes,
      });
    }

    return new Promise((resolve, reject) => {
      response.data
        .on('data', (chunk) => {
          if (progressBar) progressBar.tick(chunk.length);
        })
        .pipe(fs.createWriteStream(outputPath))
        .on('finish', resolve)
        .on('error', reject);
    });
  } catch (error) {
    console.error('Error downloading file:', error);
    throw error;
  }
}

async function downloadTextFile(content, url) {
  try {
    const textFileName = generateTextFileName(url);
    const outputPath = path.resolve(downloadsDirectory, `../media/${textFileName}`);
    // const outputPath = path.resolve(__dirname, `../media/text_file.txt`);
    // console.log('Downloading text file to:', outputPath);
    if (fs.existsSync(outputPath)) {
      console.log('Text file already exists:', textFileName);
      return textFileName;
    } else {
      console.log('Writing text file:', textFileName);
      fs.writeFileSync(outputPath, Buffer.from(content));
      return textFileName;
    }
  } catch (error) {
    console.error('Error downloading text file:', error);
    throw error;
  }
}

async function downloadImageFile(imageUrl, url) {
  try {
    // extract the file extension from the URL
    const parsedPath = path.parse(imageUrl);
    const cleanFileName = encodeURIComponent(parsedPath.base.split('?')[0] || "none");
    const fileType = parsedPath.ext;
    // let imageFileName = generateImageFileName(imageUrl);
    let articleUrlHash = crypto.createHash('sha256').update(url).digest('hex');
    let imageFileName = `${articleUrlHash}-${generateImageFileName(imageUrl)}-${cleanFileName}`
    // let outputPath;
    // const imageDir = path.resolve(__dirname, `../media/${id}`);
    const outputPath = path.resolve(downloadsDirectory, `../media/${imageFileName}`);
    // fs.writeFileSync(outputPath, imageFileName);
    
    // const outputPath = path.join(imageDir, `${imageFileName}.jpg`);
    // if (!fs.existsSync(imageDir)) {
      //   fs.mkdirSync(imageDir, { recursive: true });
      //   console.log(`Created directory: ${imageDir}`);
      // }
      
      // const parsedPath = path.parse(imageUrl);
      // const cleanFileName = parsedPath.base.split('?')[0];
      // outputPath = path.join(imageDir, cleanFileName);
      // console.log('Cleaned file name:', cleanFileName);
      
      await downloadFile(imageUrl, outputPath);
        console.log('Image Download complete:', outputPath);

        return imageFileName;
  } catch (error) {
    console.error('Error downloading image:', error);
    throw error;
  }
}

async function getYouTubeMetadata(videoUrl) {
  const ytdlpPath = '/opt/homebrew/bin/yt-dlp'; // Update to your actual yt-dlp path
  const ytdlpCommand = `${ytdlpPath} -j ${videoUrl}`;  // "-j" option returns video metadata in JSON format

  return new Promise((resolve, reject) => {
    exec(ytdlpCommand, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error fetching YouTube metadata: ${stderr}`);
        reject(error);
      } else {
        const metadata = JSON.parse(stdout);  // Parse the JSON output from yt-dlp
        // console.log('YouTube metadata:', {metadata});
        resolve(metadata);
      }
    });
  });
}

async function downloadMedia(mediaUrl, id) {
  // download images and video from twitter
  try {
    let outputPath;
    const mediaDir = path.resolve(__dirname, `../media/${id}`);
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
      console.log(`Created directory: ${mediaDir}`);
    }

    const parsedPath = path.parse(mediaUrl);
    const cleanFileName = parsedPath.base.split('?')[0];
    outputPath = path.join(mediaDir, cleanFileName);
    console.log('Cleaned file name:', cleanFileName);

    await downloadFile(mediaUrl, outputPath);
    console.log('Media Download complete:', outputPath);

    return outputPath;
  } catch (error) {
    console.error('Error downloading media:', error);
    throw error;
  }
}

async function downloadVideo(videoUrl, id) {
  try {
    let outputPath;

    // Create a unique directory for the video based on its ID
    const videoDir = path.resolve(__dirname, `../media/${id}`);
    if (!fs.existsSync(videoDir)) {
      fs.mkdirSync(videoDir, { recursive: true });
      console.log(`Created directory: ${videoDir}`);
    }

    // Check if it's a YouTube video
    if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
      console.log('Downloading YouTube video:', videoUrl);

      // Use full path to yt-dlp
      const ytdlpPath = '/opt/homebrew/bin/yt-dlp'; // Replace this with your actual yt-dlp path

      // Extract the video ID
      const match = videoUrl.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
      const fileName = match ? match[1] : `video_${id}`;
      outputPath = path.join(videoDir, `${fileName}.mp4`);

      await new Promise((resolve, reject) => {
        const ytdlpCommand = `${ytdlpPath} -o "${outputPath}" ${videoUrl}`;
        exec(ytdlpCommand, (error, stdout, stderr) => {
          if (error) {
            console.error(`Error downloading YouTube video: ${stderr}`);
            reject(error);
          } else {
            // console.log(`YouTube Video Download complete: ${outputPath}`);
            resolve();
          }
        });
      });
    }
    // Check if it's a Twitter video
    else if (videoUrl.includes('twitter.com') || videoUrl.includes('twimg.com')) {
      console.log('Downloading Twitter video:', videoUrl);

      // Get the base file name and remove any query parameters
      const parsedPath = path.parse(videoUrl);
      const cleanFileName = parsedPath.base.split('?')[0]; // Remove query string after "?"

      outputPath = path.join(videoDir, cleanFileName);
      console.log('Cleaned file name:', cleanFileName);

      // Download the video using the downloadFile function
      await downloadFile(videoUrl, outputPath);
      console.log('Twitter Video Download complete:', outputPath);
    } else {
      throw new Error('Unsupported video URL.');
    }

    // Return the path to the downloaded video
    return outputPath;

  } catch (error) {
    console.error('Error downloading video:', error);
    throw error; // Rethrow the error to be handled by the caller
  }
}

// deprecated by getTwitterMediaUrls
async function getTwitterVideoUrls(tweetUrls) {
  try {
    const twitterBearerToken = process.env.TWITTER_BEARER_TOKEN;

    // Extract tweet IDs from the URLs
    const tweetIds = tweetUrls.map((tweetUrl) => {
      const tweetIdMatch = tweetUrl.match(/status\/(\d+)/);
      return tweetIdMatch ? tweetIdMatch[1] : null; // Filter out any null or invalid IDs
    }).filter(Boolean); // Filter out any null or invalid IDs

    if (tweetIds.length === 0) {
      throw new Error('No valid Twitter URLs provided.');
    }

    console.log('Tweet IDs:', tweetIds);

    // Fetch tweet details from Twitter API
    const response = await axios.get(`https://api.twitter.com/2/tweets`, {
      headers: {
        Authorization: `Bearer ${twitterBearerToken}`,
      },
      params: {
        ids: tweetIds.join(','), // Join the tweet IDs into a comma-separated string
        'tweet.fields': 'attachments',
        'expansions': 'attachments.media_keys',
        'media.fields': 'media_key,type,variants',
      },
    });

    // Extract media information from the response
    const mediaArray = response.data.includes?.media;

    if (!mediaArray || mediaArray.length === 0) {
      throw new Error('No media found in the tweets.');
    }

    // Initialize an array to hold the video URLs
    const videoUrls = [];

    // Loop through media and find video with 'video' type
    mediaArray.forEach(media => {
      if (media.type === 'video' && media.variants) {
        // Sort the variants by bitrate to get the highest quality video
        const highestQualityVariant = media.variants
          .filter(variant => variant.content_type === 'video/mp4')
          .sort((a, b) => b.bitrate - a.bitrate)[0];

        if (highestQualityVariant) {
          videoUrls.push(highestQualityVariant.url); // Push the highest quality video URL
        }
      }
    });

    if (videoUrls.length === 0) {
      throw new Error('No videos found in the tweets.');
    }

    console.log('Video URLs:', videoUrls);
    return videoUrls; // Return an array of video URLs
  } catch (error) {
    console.error('Error fetching Twitter video URLs:', error);
    throw error;
  }
}

async function getTwitterMediaUrls(tweetIds) {
  try {
    const twitterBearerToken = process.env.TWITTER_BEARER_TOKEN;

    if (tweetIds.length === 0) {
      throw new Error('No valid Twitter URLs provided.');
    }

    console.log('Tweet IDs:', tweetIds);

    // Fetch tweet details from Twitter API
    const response = await axios.get(`https://api.twitter.com/2/tweets`, {
      headers: {
        Authorization: `Bearer ${twitterBearerToken}`,
      },
      params: {
        ids: tweetIds.join(','), // Join the tweet IDs into a comma-separated string
        'tweet.fields': 'attachments',
        'expansions': 'attachments.media_keys',
        'media.fields': 'media_key,type,url,variants',
      },
    });

    // Extract media information from the response
    const mediaArray = response.data.includes?.media;

    if (!mediaArray || mediaArray.length === 0) {
      throw new Error('No media found in the tweets.');
    }

    // Initialize an array to hold media URLs
    const mediaUrls = [];

    // Loop through media and first check for video, then fall back to image
    mediaArray.forEach(media => {
      if (media.type === 'video' && media.variants) {
        // Sort the variants by bitrate to get the highest quality video
        const highestQualityVariant = media.variants
          .filter(variant => variant.content_type === 'video/mp4')
          .sort((a, b) => b.bitrate - a.bitrate)[0];

        if (highestQualityVariant) {
          mediaUrls.push(highestQualityVariant.url); // Push the highest quality video URL
        }
      } else if (media.type === 'photo' && media.url) {
        // If it's an image, push the image URL
        mediaUrls.push(media.url);
      }
    });

    if (mediaUrls.length === 0) {
      throw new Error('No media found in the tweets.');
    }

    console.log('Media URLs:', mediaUrls);
    return mediaUrls; // Return an array of media URLs (video or image)
  } catch (error) {
    console.error('Error fetching Twitter media URLs:', error);
    throw error;
  }
}

const cleanUrl = (url) => {
  const urlObj = new URL(url);
  return urlObj.origin + urlObj.pathname;
};

async function publishArticleAndAttachedMedia(articleData, $, url, html, res, blockchain = 'arweave') {
  // Ensure the downloads directory exists
  const downloadsDir = path.resolve(__dirname, '../media');
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }
  
  let imageWidth, imageHeight, imageSize, imageFileType;
  
  // Determine the MIME content type based on the file extension
  const mimeTypes = {
    // Image MIME types
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.tiff': 'image/tiff',
    '.svg': 'image/svg+xml',
    // Video MIME types
    '.mp4': 'video/mp4',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.flv': 'video/x-flv',
    '.webm': 'video/webm',
    '.wmv': 'video/x-ms-wmv',
    '.3gp': 'video/3gpp',
    '.m4v': 'video/x-m4v',
    '.mpeg': 'video/mpeg'
  };

  textFile = await downloadTextFile(articleData.content, url);

  console.log('textFile', textFile);

  articleTextURL = `${getBaseUrl(req)}/api/media?id=${textFile}`;

  // Process embedded image if it exists
  if (articleData.embeddedImage) {
    const imageUrl = articleData.embeddedImage;
    console.log('imageUrl', imageUrl);

    // Extract the filename and file type from the URL
    let parsedPath = path.parse(new URL(imageUrl).pathname);
    let fileName = parsedPath.base;
    let fileType = parsedPath.ext;

    // Check if the URL contains a query parameter that points to a filename
    const urlObj = new URL(imageUrl);
    if (urlObj.searchParams.has('url')) {
      const queryUrl = urlObj.searchParams.get('url');
      parsedPath = path.parse(new URL(queryUrl).pathname);
      fileName = parsedPath.base;
      fileType = parsedPath.ext;
    }

    const imageFileName = await downloadImageFile(imageUrl, url);
    const mediaDownloadsDir = path.resolve(__dirname, '../media');
    console.log('mediaDownloadsDir', mediaDownloadsDir, 'fileName', imageFileName);
    const imagePath = path.join(mediaDownloadsDir, imageFileName);

    const hostedImageUrl = `${getBaseUrl(req)}/api/media?id=${imageFileName}`;
    articleData.embeddedImageUrl = hostedImageUrl;
    
    // Get image info for the record
    try {
      const imageStats = fs.statSync(imagePath);
      imageSize = imageStats.size;
      imageFileType = mimeTypes[fileType.toLowerCase()] || 'image/jpeg';

      const imageMetadata = await sharp(imagePath).metadata();
      imageWidth = imageMetadata.width;
      imageHeight = imageMetadata.height;
      console.log('Image dimensions:', imageWidth, imageHeight);
    } catch (error) {
      console.error('Error processing image:', error);
      imageWidth = null;
      imageHeight = null;
      imageSize = null;
      imageFileType = 'image/jpeg';
    }
  }

  if (articleData.summaryTTS) {
    const fullUrl = getBaseUrl(req) + articleData.summaryTTS;
    articleData.summaryTTS = fullUrl;
  }

  // Validate required fields for post publishing
  if (!articleData.title || !articleTextURL) {
    console.error('Missing required fields for post publishing:', {
      title: !!articleData.title,
      articleTextURL: !!articleTextURL
    });
    throw new Error('Missing required fields: title and articleTextURL are required for post publishing');
  }

  // Build the main record structure - don't initialize empty arrays that will be processed incorrectly
  const recordToPublish = {
    "basic": {
      "name": articleData.title,
      "language": "en",
      "date": articleData.publishDate || Math.floor(Date.now() / 1000),
      "description": articleData.description || "",
      "nsfw": false,
      "tagItems": articleData.tags || []
    },
    "post": {
      "bylineWriter": articleData.byline || "",
      "articleText": {
        "text": {
          "webUrl": articleTextURL,
          "contentType": "text/text"
        }
      },
      "webUrl": cleanUrl(articleData.url),
      // Don't initialize these as empty arrays - only add them if they have content
      "imageItems": [],
      "imageCaptionItems": [],
      "videoItems": [],
      "audioItems": [],
      "audioCaptionItems": [],
      "replyTo": ""
    },
    "blockchain": blockchain
  };
  
  // Handle featured image if it exists
  if (articleData.embeddedImage && articleData.embeddedImageUrl) {
    recordToPublish.post.featuredImage = {
      "image": {
        "webUrl": articleData.embeddedImageUrl,
        "contentType": imageFileType || "image/jpeg",
        "height": imageHeight || null,
        "width": imageWidth || null,
        "size": imageSize || null
      }
    };
  }

  // Handle summary TTS audio if it exists
  if (articleData.summaryTTS) {
    recordToPublish.post.audioItems = [{
      "audio": {
        "webUrl": articleData.summaryTTS,
        "contentType": "audio/mpeg"
      }
    }];
  }

  console.log('this is whats getting published:', recordToPublish)

  // Publish the main record
  const record = await publishNewRecord(recordToPublish, "post", false, false, false, null, blockchain);
  console.log('Record published XYZ:', record);
  return record;
}

function cleanArticleContent(content) {
  // Step 1: Replace common HTML entities with equivalent characters
    const htmlEntities = {
      '&apos;': "'",
      '&quot;': '"',
      '&amp;': '&',
      '&#xA0;': ' ',      // Non-breaking space
      '&#x2026;': '…',    // Ellipsis
      '&#39;': "'"        // Apostrophe sometimes encoded differently
  };

  // Replace HTML entities using the mapping
  content = content.replace(/&[a-zA-Z#0-9]+;/g, (entity) => htmlEntities[entity] || '');

  // Step 2: Remove extra symbols and unwanted characters
  // This regex will remove isolated special characters and preserve words and numbers
  content = content.replace(/[*\xA0]+/g, ' ');     // Removing unnecessary symbols
  content = content.replace(/\s{2,}/g, ' ');       // Reducing multiple spaces to a single space

  // Step 3: Trim leading/trailing whitespace and punctuation
  content = content.trim();

  return content;
}

async function scrapeZeroHedgeByline($) {
  // Define selectors based on the page structure
  const authorSelectors = [
      '.ArticleFull_headerFooter__author__pC2tR', // Primary class for byline
      '.byline', '.author', '.by-author', '.author-name' // Fallbacks
  ];

  // Attempt to find the byline using defined selectors
  for (const selector of authorSelectors) {
      const element = $(selector);
      if (element.length && element.text().trim()) {
          const bylineText = element.text().trim();
          // Clean and standardize the byline text
          return bylineText.replace(/^by\s*/i, '').trim();
      }
  }

  // Return default byline for ZeroHedge if no byline is found
  return 'Tyler Durden';
}

async function convertBase64ToImage(base64String, scrapeId) {
  try {
    const outputPath = path.resolve(downloadsDirectory, `../media/screenshot-${scrapeId}.png`);
    const base64Data = base64String.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(outputPath, base64Data, 'base64');
    return outputPath;
  } catch (error) {
    console.error('Error converting base64 to image:', error);
    throw error;
  }
}

async function stitchImages(screenshots, totalHeight, scrapeId) {
  console.log('converting screenshot base64 to files before stitching');

  try {
    if (!canvasModule) {
      console.warn('Canvas module not available - cannot stitch images. Consider using minimal-with-scrape profile for full scraping functionality.');
      // Return a fallback - just save the first screenshot
      if (screenshots && screenshots.length > 0) {
        const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
        const mediaId = `fullscreenshot-${scrapeId}-${today}.png`;
        const outputPath = path.resolve(downloadsDirectory, mediaId);
        console.log('outputPath', outputPath);
        const firstScreenshot = screenshots[0];
        const buffer = Buffer.from(firstScreenshot.screenshot.replace(/^data:image\/png;base64,/, ''), 'base64');
        fs.writeFileSync(outputPath, buffer);
        console.log('Using first screenshot as fallback since canvas is not available');
        return mediaId;
      }
      throw new Error('Canvas module not available and no screenshots provided');
    }

    const { createCanvas, loadImage, Image } = canvasModule;
    const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
    const mediaId = `fullscreenshot-${scrapeId}-${today}.png`;
    const outputPath = path.resolve(downloadsDirectory, mediaId);
    console.log('outputPath', outputPath);
    const images = await Promise.all(screenshots.map(screenshot => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = Buffer.from(screenshot.screenshot.replace(/^data:image\/png;base64,/, ''), 'base64');
      });
    }));

    if (images.length === 0 || !images[0].width || !totalHeight) {
      throw new Error('Invalid image dimensions or total height');
    }

    const canvas = createCanvas(images[0].width, totalHeight);
    const ctx = canvas.getContext('2d');
    let y = 0;

    for (const img of images) {
      ctx.drawImage(img, 0, y, canvas.width, img.height); // Stretch to fit each section
      y += img.height;
    }

    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);
    return mediaId;
    
  } catch (error) {
    console.error('Error stitching images:', error);
    throw error;
  }
}

// async function fetchParsedArticleData(url, html, scrapeId, res) {
//   console.log('Scrape ID:', scrapeId, 'Fetching parsed article data from', url);

//   if (ongoingScrapes.has(scrapeId)) {
//     console.log(`Scrape already in progress for ${url}. Reconnecting to existing stream.`);
//     const existingStream = ongoingScrapes.get(scrapeId);
//     existingStream.clients.push(res);
//     existingStream.data.forEach(chunk => res.write(chunk));
//     return;
//   }

//   const streamData = { clients: [res], data: [] };
//   ongoingScrapes.set(scrapeId, streamData);

//   try {
//     console.log('Scrape ID:', scrapeId, 'Checking for articles in archive with URL:', url);

//     const queryParams = { resolveDepth: 2, url: cleanUrl(url), sortBy: 'inArweaveBlock:desc', limit: 1 };
//     const records = await getRecords(queryParams);

//     if (records.searchResults > 0) {
//       console.log('Found article in archive:', records.records[0]);

//       // Existing Article Logic (No Screenshot Needed Here)
//       res.write(`event: dataFromIndex\n`);
//       res.write(`data: ${JSON.stringify(records.records[0])}\n\n`);
//       res.end();
//       cleanupScrape(scrapeId);
//     } else {
//       console.log('Not found in Archive, fetching as a new article...');
//       const parsedData = await Parser.parse(url, { html });

//       console.log('Parsed article:', parsedData);

//       // Generate a Screenshot from HTML
//       const screenshotPath = await generateScreenshotFromHTML(html, scrapeId);
//       console.log('Screenshot saved at:', screenshotPath);

//       const articleData = {
//         title: parsedData.title || null,
//         byline: parsedData.author || null,
//         publishDate: parsedData.date_published || null,
//         description: parsedData.excerpt || null,
//         screenshot: screenshotPath, // Add Screenshot Path
//         content: parsedData.content || null,
//         url,
//       };

//       console.log('Article Data:', articleData);

//       // Stream Data
//       res.write(`event: initialData\n`);
//       res.write(`data: ${JSON.stringify(articleData)}\n\n`);
//       res.end();

//       cleanupScrape(scrapeId);
//     }
//   } catch (error) {
//     console.error('Error fetching parsed article data:', error);
//     res.write(`event: error\n`);
//     res.write(`data: ${JSON.stringify({ error: 'Failed to fetch article data.' })}\n\n`);
//     res.end();
//   }
// }

// // Helper function to generate a screenshot
// async function generateScreenshotFromHTML(html, scrapeId) {
//   const outputPath = `media/screenshot-${scrapeId}.png`;

//   try {
//     await nodeHtmlToImage({
//       output: outputPath,
//       html,
//       puppeteerArgs: { headless: true }, // Ensure this runs in a server-friendly environment
//       type: 'png',
//       quality: 100,
//       width: 1200, // Set desired width
//       height: 800, // Set desired height
//     });
//     return outputPath;
//   } catch (error) {
//     console.error('Error generating screenshot:', error);
//     throw new Error('Screenshot generation failed');
//   }
// }

// works perfectly - trying a version that adds screenshot download
async function fetchParsedArticleData(url, html, scrapeId, screenshotBase64, screenshots, totalHeight, options) {
  console.log('Scrape ID:', scrapeId, 'Fetching parsed article data from', url);
  const { sendUpdate, res, blockchain = 'arweave' } = options; // Destructure res and blockchain from options

    // Ensure scrapeId is initialized
  if (!ongoingScrapes.has(scrapeId)) {
    ongoingScrapes.set(scrapeId, { clients: [res], data: [] });
  }

  const streamData = ongoingScrapes.get(scrapeId);

//   const sendUpdate = (event, data) => {
//     const streamData = ongoingScrapes.get(scrapeId);
//     if (streamData) {
//         streamData.data.push({ event, data }); // Store for reconnecting clients
//         streamData.clients.forEach(client => {
//             if (typeof client.write === 'function') {
//                 client.write(`event: ${event}\n`);
//                 client.write(`data: ${JSON.stringify(data)}\n\n`);
//                 client.flush && client.flush(); // Ensure data is flushed to the client
//             }
//         });
//     }
// };

  // const sendUpdate = (event, data) => {
  //   const clients = streamData.clients || [];
  //   clients.forEach(client => {
  //       if (typeof client.write === 'function') {
  //           client.write(`event: ${event}\n`);
  //           client.write(`data: ${JSON.stringify(data)}\n\n`);
  //       } else {
  //           console.warn('client.write is not a function');
  //       }
  //   });
  // };


  console.log('converting screenshot to file');
  console.log('stitching images together using totalHeight:', totalHeight); 
  const screenshotMediaId = await stitchImages(screenshots, totalHeight, scrapeId);
  console.log('Full Screenshot saved at:', screenshotMediaId);

// // Handle reconnection for ongoing scrapes
//     if (ongoingScrapes.has(scrapeId)) {
//         console.log(`Scrape already in progress for ${url}. Reconnecting to existing stream. Scrape ID: ${scrapeId}, ongoing scrapes`, ongoingScrapes);
//         const existingStream = ongoingScrapes.get(scrapeId);
//         // console.log({existingStream});
//         existingStream.clients = existingStream.clients || [];
//         existingStream.data = existingStream.data || [];
//         existingStream.clients.push(res);
//         existingStream.data.forEach(chunk => sendUpdate(chunk.event, chunk.data));
//         return;
//     }

    // Initialize new scrape entry
    // const streamData = { clients: [res], data: [] };
    // ongoingScrapes.set(scrapeId, streamData);

  try {
    console.log('Checking for articles in archive with URL:', url);
    // Attempt to retrieve existing records based on the URL
    // const cleanUrl = (url) => {
    //   const urlObj = new URL(url);
    //   return urlObj.origin + urlObj.pathname;
    // };
    const sortBy = 'inArweaveBlock:desc';
    const queryParams = { resolveDepth: 2, url: cleanUrl(url), sortBy: 'inArweaveBlock:desc', limit:1 };
    const records = await getRecords(queryParams);
    const latestArweaveBlockInDB = records.latestArweaveBlockInDB;
    console.log('919 searchResults:', records.searchResults);

    if (records.searchResults > 0) {

      console.log('OIP data from first record found in archive:', records.records[0]);
      const didTx = records.records[0].oip.did || records.records[0].oip.didTx;

      txId = didTx.split(':')[2];

      const domain = (new URL(url)).hostname.split('.').slice(-2, -1)[0];

      let summaryTTS
      console.log('First Record in response:', records.records[0].data);
      if (records.records[0].data.post !== undefined) {
        console.log('00', records.records[0].data.post);
        if (records.records[0].data.post.audioItems[0] !== undefined) {
          console.log('0', records.records[0].data.post.audioItems[0]);
          if (records.records[0].data.post.audioItems[0].data.associatedUrlOnWeb !== undefined) {
            console.log('1', records.records[0].data.post.audioItems[0].data.associatedUrlOnWeb.url);
            summaryTTS = records.records[0].data.post.audioItems[0].data.associatedUrlOnWeb.url
            console.log('1 summaryTTS', summaryTTS);

          }
          else if (records.records[0].data.post.audioItems[0].data.audio !== undefined) {
            console.log('2', records.records[0].data.post.audioItems[0].data.audio.webUrl);
            summaryTTS = records.records[0].data.post.audioItems[0].data.audio.webUrl
            console.log('2 summaryTTS', summaryTTS);
          }
          else {
            console.log('3');
            summaryTTS = null
            console.log('3 summaryTTS', summaryTTS);

          }
        }
      }
      if (summaryTTS === undefined && records.records[0] !== undefined && records.records[0].data !== undefined) {
        console.log('a00', records.records[0].data.post);
        if (records.records[0].data.post !== undefined) {
          if(records.records[0].data.post.audioItems[0] !== undefined) {
            console.log('a0', records.records[0].data.post.audioItems[0]);
            if (records.records[0].data.post.audioItems[0].data.associatedUrlOnWeb !== undefined) {
              console.log('a1', records.records[0].data.post.audioItems[0].data.associatedUrlOnWeb.url);
              summaryTTS = records.records[0].data.post.audioItems[0].data.associatedUrlOnWeb.url
              console.log('a1 summaryTTS', summaryTTS);

            }
            else if (records.records[0].data.post.audioItems[0].data.audio !== undefined) {
              console.log('a2', records.records[0].data.post.audioItems[0].data.audio.webUrl);
              summaryTTS = records.records[0].data.post.audioItems[0].data.audio.webUrl
              console.log('a2 summaryTTS', summaryTTS);

            }
            else {
              console.log('a3');
              summaryTTS = null
              console.log('a3 summaryTTS', summaryTTS);
            }
          }
        }
      }
      console.log('SummaryTTS:', summaryTTS);
      const screenshotURL = `${getBaseUrl(req)}/api/media?id=${screenshotMediaId}`;
      let articleData = {
        title: records.records[0].data.basic !== undefined ? records.records[0].data.basic.name : null,
        byline: records.records[0].data.post !== undefined ? records.records[0].data.post.bylineWriter : null,
        publishDate: records.records[0].data.basic !== undefined ? records.records[0].data.basic.date : null,
        description: records.records[0].data.basic !== undefined ? records.records[0].data.basic.description : null,
        tags: records.records[0].data.basic !== undefined ? records.records[0].data.basic.tagItems : '',
        screenshotURL: screenshotURL,
        domain: domain || null,
        url: url,
        summaryTTS: summaryTTS,
        didTx: didTx,
        txId: txId,
        recordStatus: records.records[0].oip.recordStatus || null
      };

      console.log('Article data found in archive:', articleData);
      sendUpdate('dataFromIndex', articleData);
      // res.write(`event: dataFromIndex\n`);
      // res.write(`data: ${JSON.stringify(articleData)}\n\n`);
      // res.end();
      // cleanupScrape(scrapeId); // Clear completed scrape


    } else {
      // Handle new article scraping if no archived data is found
      console.log('Not found in Archive, fetching as a new article...');
      const data = await Parser.parse(url, { html: html });
      // console.log('Parsed data:', data);

      let content = data.content
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .replace(/\s+/g, ' ') // Remove multiple spaces
        .trim() || null;

      content = cleanArticleContent(content);

      let publishDate = data.date_published
        ? Math.floor(new Date(data.date_published.replace(/\s+/g, ' ').trim().replace(/^PUBLISHED:\s*/, '')).getTime() / 1000)
        : null;

      const domain = (new URL(url)).hostname.split('.').slice(-2, -1)[0];

      const screenshotURL = `${getBaseUrl(req)}/api/media?id=${screenshotMediaId}`;

      // Initial parsed article data
      let articleData = {
        title: data.title || null,
        byline: data.author || null,
        publishDate: publishDate || null,
        description: data.excerpt || null,
        content: content || null,
        embeddedImage: data.lead_image_url || null,
        domain: domain || null,
        url: url || null,
        screenshotURL 
      };


      // Stream initial article data
      sendUpdate('initialData', articleData);
      // res.write(`event: initialData\n`);
      // res.write(`data: ${articleData}\n\n`);
      // res.flush(); // Ensures data is flushed to the client immediately
      // console.log('Sending initialData:', articleData);

      // Optional: Refine with manual scraping of additional fields using Cheerio
      const $ = cheerio.load(html);

      // **TITLE**
      if (!articleData.title) {
        const titleSelector = ['h1', '.headline', '.article-title', '.entry-title', '.post-title', '.title', '.entry-title'];
        const title = await manualScrapeWithSelectors($, titleSelector);
        articleData.title = title ? title.trim() : articleData.title;
        console.log('Title:', articleData.title);
        res.write(`event: title\n`);
        res.write(`data: ${JSON.stringify({ title: articleData.title })}\n\n`); // Send only the title
      }

      // **BYLINE**
      if (!articleData.byline) {
          const authorSelector = [
            '.ArticleFull_headerFooter__author__pC2tR',
            '.author', '.author-name', '.byline', '.by-author', '.byline__name', '.post-author', '.auth-name', '.ArticleFull_headerFooter__author',
            '.entry-author', '.post-author-name', '.post-meta-author', '.article__author', '.author-link', '.article__byline', '.content-author',
            '.meta-author', '.contributor', '.by', '.opinion-author', '.author-block', '.author-wrapper', '.news-author', '.header-byline',
            '.byline-name', '.post-byline', '.metadata__byline', '.author-box', '.bio-name', '.auth-link'
          ];
          const byline = await manualScrapeWithSelectors($, authorSelector);
          console.log('Byline1:', articleData.byline);
          articleData.byline = byline ? byline.trim().replace(/^by\s*/i, '').replace(/\s+/g, ' ').replace(/\n|\t/g, '').split('by').map(name => name.trim()).filter(Boolean).join(', ') : articleData.byline;
          console.log('Byline2:', articleData.byline);
          const repeatedWordsPattern = /\b(\w+)\b\s*\1\b/i; // Check for repeated words
          if (repeatedWordsPattern.test(articleData.byline)) {
            console.log('Repeated words found in byline:', articleData.byline);
            // Fix for repeated words with commas between them
            // First, we'll clean up the pattern to handle words separated by commas
            articleData.byline = articleData.byline
              .replace(/\b(\w+)[,\s]+(?:\1[,\s]+)+/gi, '$1, ')
              .replace(/,\s*,/g, ',')
              .replace(/,\s*$/,'');
            console.log('Fixed byline:', articleData.byline);
            
            // If we've removed too much and the byline is too short, set to null
            if (articleData.byline.length < 2) {
              articleData.byline = null;
            }
          }
          const excessiveSpacesPattern = /\s{2,}/; // Matches two or more spaces
            if (!articleData.byline || articleData.byline === null || excessiveSpacesPattern.test(byline)) {
              const bylineFound = await identifyAuthorNameFromContent(articleData.content);
              articleData.byline = bylineFound
            }
              if (!articleData.byline) {
                console.log('Byline not found in content. Attempting to extract from screenshot...', screenshotURL);
                const extractedByline = await analyzeImageForAuthor(screenshotURL);
                console.log('analyzed image for author name:', extractedByline);
                articleData.byline = extractedByline || null; // Fallback to any previously found byline
              }
                if (articleData.domain === 'zerohedge' && !articleData.byline || articleData.byline === "John Smith" ) {
                  const bylineFound = await scrapeZeroHedgeByline($);
                  articleData.byline = bylineFound
                }
      
                sendUpdate('byline', { byline: articleData.byline });
      }

      // **PUBLISH DATE**
      if (!articleData.publishDate) {
        const dateSelector = [
          '.ArticleFull_headerFooter__date__UFCbS', 'time', '.publish-date', '.post-date', '.entry-date', '.article-date',
          '.published-date', '.t-txt', '.t-txt\\:sm', '.t-txt\\:u', '.t-display\\:inline-block'
        ];
        const publishDate = await manualScrapeWithSelectors($, dateSelector);
        console.log('Publish Date after manual scrape:', publishDate);
        if (publishDate){
        articleData.publishDate = 
            Math.floor(new Date(
          publishDate.replace(/\s+/g, ' ').trim().replace(/^Published:\s*/i, '').split('|')[0].trim().split(' - ')[0].trim()
            ).getTime() / 1000)
          }
        console.log('Publish Date:', articleData.publishDate);
        if (!articleData.publishDate || articleData.publishDate === null || isNaN(articleData.publishDate) || articleData.publishDate <= 0) {
          const dateFound = await identifyPublishDateFromContent(articleData.content);
          articleData.publishDate = dateFound
        }
        sendUpdate('publishDate', { publishDate: articleData.publishDate });
        // res.write(`event: publishDate\n`);
        // res.write(`data: ${JSON.stringify({ publishDate: articleData.publishDate })}\n\n`); // Send only the publish date
      }

      // **CONTENT**
      if (!articleData.content) {
        const contentFileName = generateTextFileName(url);
        const filePath = path.join(downloadsDirectory, contentFileName);
        if (fs.existsSync(filePath)) {
          // If the file already exists, return the URL
          // return res.json({ url: `/api/generate/media?id=${contentFileName}` });
          articleData.articleTextUrl = `${getBaseUrl(req)}/api/generate/media?id=${contentFileName}`;
          articleData.articleTextId = contentFileName; 
        } else {
        const textSelector = [
          '.article-content', '.entry-content', '.post-content', '.content', '.article-body', '.article-text', '.article-content',
          '.article-body', '.article-text', '.article-copy', '.article-content', '.article-main', '.article-contents', '.article-content-body'
        ];
        const content = await manualScrapeWithSelectors($, textSelector);
        articleData.content = content ? content.trim() : articleData.content;
        console.log('Content:', articleData.content);
        fs.writeFileSync(filePath, Buffer.from(articleData.content, 'utf-8'));
        articleData.articleTextUrl = `${getBaseUrl(req)}/api/generate/media?id=${contentFileName}`;
        articleData.articleTextId = contentFileName; 

      }
        // res.write(`event: content\n`);
        // res.write(`data: ${JSON.stringify({ content: articleData.articleTextUrl })}\n\n`); // Send only the content
      }

      let generatedText = await generateSummaryFromContent(articleData.title, articleData.content);
      if (!generatedText || generatedText === null || generatedText === 'no summary') {
        console.log('No summary generated, trying again');
         generatedText = await generateSummaryFromContent(articleData.title, articleData.content);
      }
      console.log('Generated Text:', generatedText);
      const summary = generatedText.summary;
      const text = replaceAcronyms(summary);
      // **create audio of summary**
      const audioFileName = generateAudioFileName(url);
      const filePath = path.join(audioDirectory, audioFileName);
      const defaultVoiceConfig = {
        google: { languageCode: 'en-GB', name: 'en-GB-Journey-D', ssmlGender: 'MALE' },
        elevenLabs: {
            voice_id: 'TWOFxz3HmcZPjoBTPVjd',
            model_id: 'eleven_monolingual_v1',
            stability: 0.5,
            similarity_boost: 0.75,
        },
    };
    // const chunkFileName = path.join(outputDir, `${outputFileName}.mp3`);
    const response = await synthesizeSpeech(text, defaultVoiceConfig, audioFileName, api = 'elevenLabs');
      // synthesizeSpeech(text, defaultVoiceConfig, audioFileName, api = 'elevenLabs').then(response => {
        console.log('synthesized speech response:', response);
              format = response.format;
              articleData.summaryTTS = response.url;
              console.log('Synthesized speech:', articleData.summaryTTS, format);
              sendUpdate('synthesizedSpeech', { url: articleData.summaryTTS });
      // });
     
      console.log('Tags:', generatedText.tags);
      const generatedTags = generatedText.tags.split(',').map(tag => tag.trim());
      articleData.tags = generatedTags;
      sendUpdate('tags', { tags: generatedTags });
      // res.write(`event: tags\n`);
      // res.write(`data: ${JSON.stringify({ tags: generatedTags })}\n\n`);
      articleData.description = summary;
      console.log('description with Summary:', articleData.description);
      console.log('sending finalData');
      sendUpdate('finalData', articleData);
      // res.write(`event: finalData\n`);
      // res.write(`data: ${JSON.stringify(articleData)}\n\n`);
      console.log('Sent finalData:', articleData);
      let article = await publishArticleAndAttachedMedia(articleData, $, articleData.url, html, res, blockchain);
      let articleDidTx = article.did || article.didTx;
      
      console.log('article archived successfully at didTx', articleDidTx);
            sendUpdate('archived', { archived: articleDidTx });
      res.end();
      cleanupScrape(scrapeId); // Clear completed scrape

    }

  // });
  } catch (error) {
    console.error('Error fetching parsed article data:', error);
    sendUpdate('error', { message: 'Failed to fetch article data.' });
    // res.write(`event: error\n`);
    // res.write(`data: ${JSON.stringify({ error: 'Failed to fetch article data.' })}\n\n`);
    res.end();
    cleanupScrape(scrapeId);

  }
}
async function getEmbeddedTweets(html) {
  // Initialize an empty array for tweet URLs and IDs
  let tweetIds = [];

  // Load the HTML into Cheerio
  const $ = cheerio.load(html);

  console.log('Scraping for embedded tweets...');

  // Try to scrape tweets in blockquotes (if URLs are available)
  try {
      console.log('Trying to scrape tweets using blockquote.twitter-tweet...');
      const tweetsFromBlockquote = $('blockquote.twitter-tweet').map((i, tweet) => {
          const tweetLink = $(tweet).find('a[href*="twitter.com"]').attr('href');
          return tweetLink ? tweetLink.split('/').pop().split('?')[0] : null; // Extract tweet ID from URL
      }).get();  // Get array of results
      tweetIds = tweetIds.concat(tweetsFromBlockquote.filter(Boolean)); // Filter out null values
  } catch (error) {
      console.error('Error scraping tweets in blockquotes:', error);
  }

  // Try to scrape tweets from iframes as a fallback
  try {
      console.log('Trying to scrape tweets using iframes...');
      const tweetsFromIframes = $('iframe[src*="platform.twitter.com"]').map((i, iframe) => {
          const tweetSrc = $(iframe).attr('src');
          if (tweetSrc) {
              // Extract the tweet ID from the iframe src attribute
              const match = tweetSrc.match(/id=([0-9]+)/);
              return match ? match[1] : null;
          }
          return null;
      }).get();  // Get array of results
      tweetIds = tweetIds.concat(tweetsFromIframes.filter(Boolean)); // Filter out null values
  } catch (error) {
      console.error('Error scraping tweets from iframes:', error);
  }

  // Asynchronous loaded tweets via JavaScript
  try {
      console.log('Trying to scrape async loaded tweets...');
      $('script').each((i, script) => {
          const scriptContent = $(script).html();
          if (scriptContent && scriptContent.includes('twitter.com')) {
              const match = scriptContent.match(/https:\/\/twitter\.com\/[a-zA-Z0-9_]+\/status\/([0-9]+)/);
              if (match) {
                  tweetIds.push(match[1]); // Extract the tweet ID
              }
          }
      });
  } catch (error) {
      console.error('Error scraping async loaded tweets from scripts:', error);
  }

  // Remove duplicate IDs
  tweetIds = [...new Set(tweetIds)];

  console.log('Found embedded tweet IDs:', tweetIds);

  return tweetIds;
}

async function createNewNutritionalInfoRecord(ingredientName, blockchain = 'arweave') {
  try {
    console.log(`Fetching nutritional info for missing ingredient: ${ingredientName}`);

    // Construct a Nutritionix search URL
    const formattedIngredient = ingredientName.replace(/,/g, '').replace(/\s+/g, '-').toLowerCase();
    const nutritionixUrl = `https://www.nutritionix.com/food/${formattedIngredient}`;

    // Scrape the Nutritionix page using FireCrawl
    const response = await axios.post(
      'https://api.firecrawl.dev/v1/scrape',
      {
        url: nutritionixUrl,
        formats: ['html'],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.FIRECRAWL}`,
        },
      }
    );

    if (!response.data.success) {
      throw new Error(`Scrape failed for ${ingredientName}: ${response.data.error}`);
    }

    // console.log('Scrape successful:', response.data);
    const html = response.data.data.html;
    const $ = cheerio.load(html);

    // Extract basic information
    const name = $('h1.food-item-name').text().trim() || ingredientName;
    const date = Math.floor(Date.now() / 1000); // Current timestamp
    const webUrl = nutritionixUrl;
    const language = 'en';

    // Initialize nutritional data object
    const nutritionTable = {
      calories: 0,
      protein_g: 0,
      fat_g: 0,
      carbohydrates_g: 0,
      cholesterol_mg: 0,
      sodium_mg: 0,
    };

    // Parse nutritional facts using the HTML structure
    $('.nf-line').each((_, element) => {
      const label = $(element).find('span:first-child').text().trim().toLowerCase();
      const valueRaw = $(element).find('span[itemprop]').text().trim();
      const value = parseFloat(valueRaw.replace(/[^\d.]/g, '')) || 0;

      // console.log(`Label: ${label}, Raw Value: ${valueRaw}, Parsed Value: ${value}`);

      if (label.includes('calories')) {
        nutritionTable.calories = value;
      } else if (label.includes('protein')) {
        nutritionTable.protein_g = value;
      } else if (label.includes('fat')) {
        nutritionTable.fat_g = value;
      } else if (label.includes('cholesterol')) {
        nutritionTable.cholesterol_mg = value;
      } else if (label.includes('sodium')) {
        nutritionTable.sodium_mg = value;
      } else if (label.includes('carbohydrates')) {
        nutritionTable.carbohydrates_g = value;
      }
    });

    // Get serving size
    const servingSizeText = $('.nf-serving-unit-name').text().trim();
    const servingSizeMatch = servingSizeText.match(/(\d+)\s*(\w+)/);
    const standardAmount = servingSizeMatch ? parseInt(servingSizeMatch[1], 10) : 1;
    const standardUnit = servingSizeMatch ? servingSizeMatch[2].toLowerCase() : 'g';

    // Format the extracted data into the required structure
    const formattedNutritionalInfo = {
      basic: {
        name,
        date,
        language,
        nsfw: false,
        webUrl,
      },
      nutritionalInfo: {
        standard_amount: standardAmount,
        standard_unit: standardUnit,
        calories: nutritionTable.calories,
        protein_g: nutritionTable.protein_g,
        fat_g: nutritionTable.fat_g,
        carbohydrates_g: nutritionTable.carbohydrates_g,
        cholesterol_mg: nutritionTable.cholesterol_mg,
        sodium_mg: nutritionTable.sodium_mg,
      },
    };

    ingredientTx = await publishNewRecord(formattedNutritionalInfo, "nutritionalInfo", false, false, false, null, blockchain)
    // formattedNutritionalInfo.oip = formattedNutritionalInfo.oip || {};
    // formattedNutritionalInfo.oip.didTx = ingredientTx.didTx;
    console.log(`Successfully retrieved and published nutritional info for ${ingredientName}:`, formattedNutritionalInfo, ingredientTx);
    // console.log('formattedNutritionalInfo:', formattedNutritionalInfo);
    return ingredientTx.recordToIndex;
  } catch (error) {
    console.error(`Error fetching nutritional info for ${ingredientName}:`, error);
    return null; // Return null if fetching fails
  }
}

// async function createNewNutritionalInfoRecord(ingredientName) {
//   try {
//       console.log(`Fetching nutritional info for missing ingredient: ${ingredientName}`);

//       // Construct a Nutritionix search URL
//       const formattedIngredient = ingredientName.replace(/,/g, '').replace(/\s+/g, '-').toLowerCase();
//       const nutritionixUrl = `https://www.nutritionix.com/food/${formattedIngredient}`;

//       // Scrape the Nutritionix page using FireCrawl
//       const response = await axios.post('https://api.firecrawl.dev/v1/scrape', {
//           url: nutritionixUrl,
//           formats: ['html'],
//       }, {
//           headers: {
//               Authorization: `Bearer ${process.env.FIRECRAWL}`,
//           },
//       });

//       if (!response.data.success) {
//           throw new Error(`Scrape failed for ${ingredientName}: ${response.data.error}`);
//       }

//       console.log('Scrape successful:', response.data);
//       const html = response.data.data.html;
//       const $ = cheerio.load(html);

//       // Extract basic information
//       const name = $('h1').text().trim() || ingredientName;
//       const date = Math.floor(Date.now() / 1000); // Current timestamp
//       const webUrl = nutritionixUrl;
//       const language = "en";

//       // Initialize nutritional data object
//       const nutritionTable = {
//         calories: 0,
//         protein_g: 0,
//         fat_g: 0,
//         carbohydrates_g: 0,
//         cholesterol_mg: 0,
//         sodium_mg: 0
//       };

//       // Parse nutritional facts table
//       $('.nutrition-facts__table .nf-calories, .nutrition-facts__table .nf-pr').each((_, element) => {
//       const label = $(element).find('span').first().text().trim().toLowerCase();
//       const valueRaw = $(element).find('span.nf-pr').text().trim();
//       const value = parseFloat(valueRaw.replace(/[^\d.]/g, '')) || 0;

//       console.log(`Label: ${label}, Raw Value: ${valueRaw}, Parsed Value: ${value}`);

//       if (label.includes("calories")) {
//         nutritionTable.calories = value;
//       } else if (label.includes("protein")) {
//         nutritionTable.protein_g = value;
//       } else if (label.includes("fat")) {
//         nutritionTable.fat_g = value;
//       } else if (label.includes("cholesterol")) {
//         nutritionTable.cholesterol_mg = value;
//       } else if (label.includes("sodium")) {
//         nutritionTable.sodium_mg = value;
//       } else if (label.includes("carbohydrates")) {
//         nutritionTable.carbohydrates_g = value;
//       }
//     });


//       // Get serving size
//       const servingSizeText = $('.nutrition-facts__table thead th').text().trim();
//       const servingSizeMatch = servingSizeText.match(/(\d+)\s*(\w+)/);
//       const standardAmount = servingSizeMatch ? parseInt(servingSizeMatch[1], 10) : 1;
//       const standardUnit = servingSizeMatch ? servingSizeMatch[2].toLowerCase() : "g";

//       // Format the extracted data into the required structure
//       const formattedNutritionalInfo = {
//         "basic": {
//           "name": name,
//           "date": date,
//           "language": language,
//           "nsfw": false,
//           "webUrl": webUrl
//         },
//         "nutritionalInfo": {
//           "standard_amount": standardAmount,
//           "standard_unit": standardUnit,
//           "calories": nutritionTable.calories,
//           "protein_g": nutritionTable.protein_g,
//           "fat_g": nutritionTable.fat_g,
//           "carbohydrates_g": nutritionTable.carbohydrates_g,
//           "cholesterol_mg": nutritionTable.cholesterol_mg,
//           "sodium_mg": nutritionTable.sodium_mg
//         }
//       };

//       console.log(`Successfully retrieved nutritional info for ${ingredientName}:`, formattedNutritionalInfo);

//       return formattedNutritionalInfo;
//   } catch (error) {
//       console.error(`Error fetching nutritional info for ${ingredientName}:`, error);
//       return null; // Return null if fetching fails
//   }
// }

// async function createNewNutritionalInfoRecord(ingredientName) {
//   try {
//       console.log(`Fetching nutritional info for missing ingredient: ${ingredientName}`);

//       // Construct a Nutritionix search URL
//       const formattedIngredient = ingredientName.replace(/,/g, '').replace(/\s+/g, '-').toLowerCase();
//       const nutritionixUrl = `https://www.nutritionix.com/food/${formattedIngredient}`;

//       // Scrape the Nutritionix page using FireCrawl
//       const response = await axios.post('https://api.firecrawl.dev/v1/scrape', {
//           url: nutritionixUrl,
//           formats: ['html'],
//       }, {
//           headers: {
//               Authorization: `Bearer ${process.env.FIRECRAWL}`,
//           },
//       });

//       if (!response.data.success) {
//           throw new Error(`Scrape failed for ${ingredientName}: ${response.data.error}`);
//       }

//       const html = response.data.data.html;
//       const $ = cheerio.load(html);

//       // Extract basic information
//       const name = $('h1').text().trim() || ingredientName;
//       const date = Math.floor(Date.now() / 1000); // Current timestamp
//       const webUrl = nutritionixUrl;
//       const language = "en";
//       // Extract nutritional data
//       const nutritionTable = {
//         calories: 0,
//         protein_g: 0,
//         fat_g: 0,
//         carbohydrates_g: 0,
//         cholesterol_mg: 0,
//         sodium_mg: 0
//       };

//       $('.nutrition-facts__table tbody tr').each((_, row) => {
//         const label = $(row).find('td:first-child').text().trim().toLowerCase();
//         const value = $(row).find('td:nth-child(2)').text().trim();
        
//         // Add console logs to inspect label and value
//         console.log(`Label: ${label}, Value: ${value}`);

//         if (label.includes("calories")) {
//           nutritionTable.calories = parseFloat(value) || 0;
//         } else if (label.includes("protein")) {
//           nutritionTable.protein_g = parseFloat(value) || 0;
//         } else if (label.includes("fat")) {
//           nutritionTable.fat_g = parseFloat(value) || 0;
//         } else if (label.includes("cholesterol")) {
//           nutritionTable.cholesterol_mg = parseFloat(value) || 0;
//         } else if (label.includes("sodium")) {
//           nutritionTable.sodium_mg = parseFloat(value) || 0;
//         } else if (label.includes("carbohydrates")) {
//           nutritionTable.carbohydrates_g = parseFloat(value) || 0;
//         }
//       });

//       // Get serving size
//       const servingSizeText = $('.nutrition-facts__table thead th').text().trim();
//       const servingSizeMatch = servingSizeText.match(/(\d+)\s*(\w+)/);
//       const standardAmount = servingSizeMatch ? parseInt(servingSizeMatch[1], 10) : 1;
//       const standardUnit = servingSizeMatch ? servingSizeMatch[2].toLowerCase() : "tbsp";

//       // Format the extracted data into the required structure
//       const formattedNutritionalInfo = {
//         "basic": {
//           "name": name,
//           "date": date,
//           "language": language,
//           "nsfw": false,
//           "webUrl": webUrl
//         },
//         "nutritionalInfo": {
//           "standard_amount": standardAmount,
//           "standard_unit": standardUnit,
//           "calories": nutritionTable.calories,
//           "protein_g": nutritionTable.protein_g,
//           "fat_g": nutritionTable.fat_g,
//           "carbohydrates_g": nutritionTable.carbohydrates_g,
//           "cholesterol_mg": nutritionTable.cholesterol_mg,
//           "sodium_mg": nutritionTable.sodium_mg
//         }
//       };

//       console.log(`Successfully retrieved nutritional info for ${ingredientName}:`, formattedNutritionalInfo);


//       return formattedNutritionalInfo;
//   } catch (error) {
//       console.error(`Error fetching nutritional info for ${ingredientName}:`, error);
//       return null; // Return null if fetching fails
//   }
// }

// try at generalized for all sites BUT HAS NO PUBLISHING CAPABILITY
// DEPRECATED: This first version of fetchParsedRecipeData is not used (overridden by the version below)
// Keeping for reference only - can be removed in future refactoring
// The active implementation is below at line ~1761

// works well for mediteranean site, trying another version that might generalize to all sites
async function fetchParsedRecipeData(url, html, scrapeId, screenshots, totalHeight, options) {
  const { sendUpdate, res, blockchain = 'arweave' } = options; // Destructure res and blockchain from options
    // Ensure scrapeId is initialized
    if (!ongoingScrapes.has(scrapeId)) {
      ongoingScrapes.set(scrapeId, { clients: [res], data: [] });
    }
    const streamData = ongoingScrapes.get(scrapeId);
    sendUpdate('scrapeId', { scrapeId });

  try {
    console.log('Scrape ID:', scrapeId, 'Fetching parsed recipe data from', url);


    const sortBy = 'inArweaveBlock:desc';
    const queryParams = { resolveDepth: 1, url, sortBy: 'inArweaveBlock:desc', limit:1 };
    const records = await getRecords(queryParams);
    // const latestArweaveBlockInDB = records.latestArweaveBlockInDB;
    console.log('919 searchResults:', records);
if (records.searchResults > 0) {
 
    const recipeInDB = records
    console.log('Recipe found in DB:', recipeInDB.records[0]);
    // { ingredientDidRefs, nutritionalInfo }

   } else {

    // Parse the recipe data from the HTML
    console.log('Parsing recipe data from URL:', url);

    let htmlContent = html;
    let metadata = {};

    if (!htmlContent) {
      // Fetch HTML using FireCrawl if not provided
      console.log('HTML not provided, fetching from URL using FireCrawl...');
      sendUpdate('processing', { message: 'Fetching recipe page...' });
      
    const response = await axios.post('https://api.firecrawl.dev/v1/scrape', {
      url: url,
      formats: ['html'], // You can request 'markdown' too
    }, {
        headers: {
            Authorization: `Bearer ${process.env.FIRECRAWL}`,
        },
    });

    if (response.data.success) {
        console.log('Scraped Data type:', typeof response.data.data.html);
        // return response.data.html; // Process the HTML as needed
    } else {
        throw new Error(`Scrape failed: ${response.data.error}`);
    }

    console.log('Scrape result:', response.data.data);
      metadata = response.data.data.metadata || {};
    // console.log('Metadata:', metadata);
      htmlContent = response.data.data.html;
      console.log('HTML fetched successfully from FireCrawl');
    } else {
      console.log('Using HTML provided in request');
      // When HTML is provided, extract metadata from the HTML itself
      const tempDom = cheerio.load(htmlContent);
      metadata = {
        title: tempDom('title').text() || tempDom('meta[property="og:title"]').attr('content') || '',
        ogTitle: tempDom('meta[property="og:title"]').attr('content') || '',
        ogDescription: tempDom('meta[property="og:description"]').attr('content') || tempDom('meta[name="description"]').attr('content') || '',
        ogImage: tempDom('meta[property="og:image"]').attr('content') || '',
        author: tempDom('meta[name="author"]').attr('content') || '',
        publishedTime: tempDom('meta[property="article:published_time"]').attr('content') || new Date().toISOString()
      };
    }
    
    const $ = cheerio.load(htmlContent);  

    console.log('Scraping recipe data from URL:', url);

    // Check for JSON-LD schema data (common on many recipe sites including Allrecipes)
    let jsonLdRecipe = null;
    console.log('Searching for JSON-LD schema...');
    $('script[type="application/ld+json"]').each((i, elem) => {
      try {
        const jsonText = $(elem).html();
        const jsonData = JSON.parse(jsonText);
        console.log(`Found JSON-LD script ${i}:`, jsonData['@type'] || 'No @type');
        
        // Check if it's a Recipe schema - handle both direct Recipe and @graph array
        if (jsonData['@type'] === 'Recipe') {
          jsonLdRecipe = jsonData;
          console.log('✓ Found JSON-LD Recipe schema (direct)');
        } else if (Array.isArray(jsonData['@graph'])) {
          const recipe = jsonData['@graph'].find(item => item['@type'] === 'Recipe');
          if (recipe) {
            jsonLdRecipe = recipe;
            console.log('✓ Found JSON-LD Recipe schema (in @graph)');
          }
        } else if (Array.isArray(jsonData)) {
          // Sometimes it's just an array at the top level
          const recipe = jsonData.find(item => item['@type'] === 'Recipe');
          if (recipe) {
            jsonLdRecipe = recipe;
            console.log('✓ Found JSON-LD Recipe schema (in array)');
          }
        }
      } catch (e) {
        console.error('Error parsing JSON-LD:', e.message);
      }
    });
    
    if (!jsonLdRecipe) {
      console.log('No JSON-LD Recipe schema found, will try HTML parsing');
    }

    // Parse title, description, and metadata (declare with let so LLM can update them later)
    let title = jsonLdRecipe?.name || $('h1.entry-title').text().trim() || $('h1.recipe-title').text().trim() || metadata.ogTitle || null;
    let description = jsonLdRecipe?.description || metadata.ogDescription || $('p').first().text().trim() || null;
    let imageUrl = jsonLdRecipe?.image?.url || jsonLdRecipe?.image || metadata.ogImage || $('img.wp-image').first().attr('src') || null;
    // const date = Date.now() / 1000;

    // Declare arrays and variables that LLM might need to update
    let instructions = [];
    let prep_time_mins = null;
    let cook_time_mins = null;
    let total_time_mins = null;
    let servings = null;
    let cuisine = null;
    let course = null;

    // Parse ingredient sections
    const ingredientSections = [];
    
    // Helper function to parse fractions safely
    function parseFraction(str) {
      if (!str) return null;
      // Handle mixed numbers like "1 1/2" or fractions like "1/2" or decimals like "1.5"
      const mixedMatch = str.match(/^(\d+)\s+(\d+)\/(\d+)$/);
      if (mixedMatch) {
        const whole = parseInt(mixedMatch[1], 10);
        const numerator = parseInt(mixedMatch[2], 10);
        const denominator = parseInt(mixedMatch[3], 10);
        return whole + (numerator / denominator);
      }
      
      const fractionMatch = str.match(/^(\d+)\/(\d+)$/);
      if (fractionMatch) {
        return parseInt(fractionMatch[1], 10) / parseInt(fractionMatch[2], 10);
      }
      
      return parseFloat(str) || null;
    }

    // Helper function to extract comments from ingredient strings
    function extractIngredientComment(nameString) {
      if (!nameString) return { name: '', comment: '' };
      
      // Check for comma-separated comment (e.g., "garlic, minced")
      const commaMatch = nameString.match(/^([^,]+),\s*(.+)$/);
      if (commaMatch) {
        return {
          name: commaMatch[1].trim(),
          comment: commaMatch[2].trim()
        };
      }
      
      // Check for parentheses comment (e.g., "onion (diced)")
      const parenMatch = nameString.match(/^([^(]+)\(([^)]+)\)(.*)$/);
      if (parenMatch) {
        return {
          name: (parenMatch[1].trim() + ' ' + parenMatch[3].trim()).trim(),
          comment: parenMatch[2].trim()
        };
      }
      
      // No comment found
      return {
        name: nameString.trim(),
        comment: ''
      };
    }
    
    // Try JSON-LD first if available
    if (jsonLdRecipe && jsonLdRecipe.recipeIngredient && jsonLdRecipe.recipeIngredient.length > 0) {
      console.log(`Parsing ${jsonLdRecipe.recipeIngredient.length} ingredients from JSON-LD schema`);
      const ingredients = jsonLdRecipe.recipeIngredient.map(ingredientString => {
        // Parse ingredient string like "2 cups flour" or "1 1/2 tablespoons olive oil, minced"
        const match = ingredientString.match(/^([\d\s\/\.]+)?\s*([a-zA-Z]+)?\s*(.+)$/);
        if (match) {
          const { name, comment } = extractIngredientComment(match[3] || ingredientString);
          return {
            amount: match[1] ? parseFraction(match[1].trim()) : null,
            unit: match[2] || '',
            name: name,
            comment: comment
          };
        }
        // Fallback if regex doesn't match
        const { name, comment } = extractIngredientComment(ingredientString);
        return {
          amount: null,
          unit: '',
          name: name,
          comment: comment
        };
      });
      
      ingredientSections.push({
        section: 'Main',
        ingredients: ingredients
      });
      console.log(`Added ${ingredients.length} ingredients from JSON-LD`);
    }
    
    // If JSON-LD didn't work, try HTML parsing
    if (ingredientSections.length === 0) {
      console.log('Trying HTML parsing for ingredients...');
      $('[class*="ingredient-group"], [class*="ingredients-group"]').each((i, section) => {
      const sectionName = $(section).find('[class*="group-name"], [class*="section-title"]').text().trim() || `Section ${i + 1}`;
      const ingredients = [];

      $(section)
        .find('[class*="ingredient"]')
        .each((j, elem) => {
          const amount = $(elem).find('[class*="amount"]').text().trim() || null;
          const unit = $(elem).find('[class*="unit"]').text().trim() || null;
          const nameRaw = $(elem).find('[class*="name"]').text().trim() || null;

          // Ensure that at least `name` is present and valid to include the ingredient
          if (nameRaw && (amount || unit || nameRaw)) {
            const { name, comment } = extractIngredientComment(nameRaw);
            ingredients.push({
              amount: parseFloat(amount) || null,
              unit: unit || '',
              name: name || '',
              comment: comment
            });
          }
        });

      if (ingredients.length > 0) {
        ingredientSections.push({
          section: sectionName,
          ingredients,
        });
      }
    });
      console.log(`HTML parsing found ${ingredientSections.length} ingredient sections`);
    } // End of HTML parsing fallback

    // Primary ingredient section logic
    let primaryIngredientSection = ingredientSections[0];
    if (ingredientSections.length > 1) {
      primaryIngredientSection = ingredientSections.reduce((prev, current) =>
        prev.ingredients.length > current.ingredients.length ? prev : current
      );
    }

    console.log('Ingredient sections count:', ingredientSections.length, ingredientSections);
    console.log('Primary ingredient section:', primaryIngredientSection);

    // Check if we found any ingredients - if not, try LLM fallback before giving up
    if (!primaryIngredientSection || !primaryIngredientSection.ingredients || primaryIngredientSection.ingredients.length === 0) {
      console.error('No ingredients found on page - trying LLM fallback...');
      
      if (sendUpdate) {
        sendUpdate('processing', {
          message: 'Traditional parsing failed, using AI to extract recipe...'
        });
      }
      
      try {
        // Try LLM-based recipe extraction as fallback
        const llmRecipe = await parseRecipeWithLLM(htmlContent, url, metadata);
        
        if (llmRecipe && llmRecipe.ingredients && llmRecipe.ingredients.length > 0) {
          console.log('✓ LLM successfully extracted recipe data');
          
          // Convert LLM response to our ingredient section format
          ingredientSections.push({
            section: 'Main',
            ingredients: llmRecipe.ingredients
          });
          
          primaryIngredientSection = ingredientSections[0];
          
          // Also update other fields from LLM if they're not already set
          if (!title && llmRecipe.title) title = llmRecipe.title;
          if (!description && llmRecipe.description) description = llmRecipe.description;
          if (!imageUrl && llmRecipe.imageUrl) imageUrl = llmRecipe.imageUrl;
          if (instructions.length === 0 && llmRecipe.instructions) {
            instructions.push(...llmRecipe.instructions);
          }
          if (!prep_time_mins && llmRecipe.prepTime) prep_time_mins = llmRecipe.prepTime;
          if (!cook_time_mins && llmRecipe.cookTime) cook_time_mins = llmRecipe.cookTime;
          if (!total_time_mins && llmRecipe.totalTime) total_time_mins = llmRecipe.totalTime;
          if (!servings && llmRecipe.servings) servings = llmRecipe.servings;
          if (!cuisine && llmRecipe.cuisine) cuisine = llmRecipe.cuisine;
          if (!course && llmRecipe.course) course = llmRecipe.course;
          
          console.log('Continuing with LLM-extracted data');
        } else {
          throw new Error('LLM extraction failed to find ingredients');
        }
      } catch (llmError) {
        console.error('LLM fallback failed:', llmError.message);
        
        if (sendUpdate) {
          sendUpdate('error', {
            message: 'Could not parse recipe',
            details: `Failed to extract recipe from ${new URL(url).hostname} using both traditional parsing and AI extraction. Please try a different recipe site or provide the HTML directly.`
          });
        }
        
        cleanupScrape(scrapeId);
        return;
      }
    }

    // works well for two sections but breaks with one section - trying test above for both cases
    // // Parse ingredient sections
    // const ingredientSections = [];
    // $('[class*="ingredient-group"], [class*="ingredients-group"]').each((i, section) => {
    //   const sectionName = $(section).find('[class*="group-name"], [class*="section-title"]').text().trim() || `Section ${i + 1}`;
    //   const ingredients = [];

    //   $(section)
    //     .find('[class*="ingredient"]')
    //     .each((j, elem) => {
    //       const amount = $(elem).find('[class*="amount"]').text().trim() || null;
    //       const unit = $(elem).find('[class*="unit"]').text().trim() || null;
    //       const name = $(elem).find('[class*="name"]').text().trim() || null;

    //       if (amount || unit || name) {
    //         ingredients.push({
    //           amount: parseFloat(amount) || null,
    //           unit: unit || '',
    //           name: name || '',
    //         });
    //       }
    //     });

    //   if (ingredients.length > 0) {
    //     ingredientSections.push({
    //       section: sectionName,
    //       ingredients,
    //     });
    //   }
    // });

    // // Primary ingredient section logic
    // let primaryIngredientSection = ingredientSections[0];
    // if (ingredientSections.length > 1) {
    //   primaryIngredientSection = ingredientSections.reduce((prev, current) =>
    //     prev.ingredients.length > current.ingredients.length ? prev : current
    //   );
    // }

    // console.log('Ingredient sections count:', ingredientSections.length, ingredientSections);
    // console.log('Primary ingredient section:', primaryIngredientSection);

    // const ingredientSections = [];
    // $('.wprm-recipe-ingredient-group').each((i, section) => {
    //     const sectionName = $(section).find('.wprm-recipe-group-name').text().trim() || `Section ${i + 1}`;
    //     const ingredients = [];

    //     $(section)
    //         .find('.wprm-recipe-ingredient')
    //         .each((j, elem) => {
    //             const amount = $(elem).find('.wprm-recipe-ingredient-amount').text().trim() || null;
    //             const unit = $(elem).find('.wprm-recipe-ingredient-unit').text().trim() || null;
    //             const name = $(elem).find('.wprm-recipe-ingredient-name').text().trim() || null;

    //             if (amount || unit || name) {
    //                 ingredients.push({
    //                     amount: parseFloat(amount) || null,
    //                     unit: unit || '',
    //                     name: name || '',
    //                 });
    //             }
    //         });

    //     if (ingredients.length > 0) {
    //         ingredientSections.push({
    //             section: sectionName,
    //             ingredients,
    //         });
    //     }
    // });

    // console.log('Ingredient sections count:', ingredientSections.length, ingredientSections);

    // // if there are more than one ingredient sections, identify the primary one - the one with the most ingredients
    // let primaryIngredientSection = ingredientSections[0];
    // if (ingredientSections.length > 1) {
    //     primaryIngredientSection = ingredientSections.reduce((prev, current) => {
    //         return prev.ingredients.length > current.ingredients.length ? prev : current;
    //     });
    // }
    // console.log('Primary ingredient section:', primaryIngredientSection);
    // sort remaining ingredients sections by the number of ingredients
    const remainingIngredientSections = ingredientSections.filter(section => section !== primaryIngredientSection);
    remainingIngredientSections.sort((a, b) => b.ingredients.length - a.ingredients.length);    

  // Extract instructions (already declared above, just populate)
  // Try JSON-LD first
  if (jsonLdRecipe && jsonLdRecipe.recipeInstructions) {
    if (Array.isArray(jsonLdRecipe.recipeInstructions)) {
      jsonLdRecipe.recipeInstructions.forEach(step => {
        if (typeof step === 'string') {
          instructions.push(step);
        } else if (step.text) {
          instructions.push(step.text);
        } else if (step['@type'] === 'HowToStep' && step.text) {
          instructions.push(step.text);
        }
      });
    } else if (typeof jsonLdRecipe.recipeInstructions === 'string') {
      // Split by newlines or numbered steps
      const steps = jsonLdRecipe.recipeInstructions.split(/\n+|(?=\d+\.)/);
      steps.forEach(step => {
        const cleanStep = step.trim().replace(/^\d+\.\s*/, '');
        if (cleanStep) instructions.push(cleanStep);
      });
    }
  }

  // Fallback to HTML parsing if no instructions found
  if (instructions.length === 0) {
  $('.wprm-recipe-instruction').each((i, elem) => {
    const instruction = $(elem).text().replace(/\s+/g, ' ').trim();
    if (instruction) instructions.push(instruction);
  });
  }

  console.log('Instructions:', instructions);

  // Build ingredient arrays directly from parsed data (no matching needed - endpoint will handle that)
  const ingredientNames = primaryIngredientSection.ingredients.map(ing => ing.name.trim());
  const ingredientAmounts = primaryIngredientSection.ingredients.map(ing => ing.amount ?? null);
  const ingredientUnits = primaryIngredientSection.ingredients.map(ing => (ing.unit && ing.unit.trim()) || '');
  const ingredientComments = primaryIngredientSection.ingredients.map(ing => (ing.comment && ing.comment.trim()) || '');

  console.log('Ingredient names:', ingredientNames);
  console.log('Ingredient amounts:', ingredientAmounts);
  console.log('Ingredient units:', ingredientUnits);
  console.log('Ingredient comments:', ingredientComments);

  // Note: We no longer do ingredient matching in scrape.js
  // The /api/publish/newRecipe endpoint handles all ingredient lookup, matching, and creation

    // console.log('Ingredient DID References:', ingredientDidRefs);
    // now we want to look up the record.oip.didTx value from the top ranked record for each ingredient and assign it to ingredientDidRef, we may need to add pagination (there are 20 records limit per page by default) to check all returned records
    
    
    


    // now filter each one by the ingredientName matching against this json structure: data: { basic: { name: ,and get the nutritional info
    // for each ingredient, if it exists
    // const nutritionalInfo = records.map(record => {
    //   const ingredientName = record.data.basic.name;
    //   const nutritionalInfo = record.data.nutritionalInfo || {}; // Ensure it's an object, not undefined
    //   const ingredientSource = record.data.basic.webUrl;
    //   const ingredientDidRef = ingredientDidRefs[ingredientName.toLowerCase()] || null; // Ensure case-insensitive lookup
    //   return {
    //     ingredientName,
    //     nutritionalInfo,
    //     ingredientSource,
    //     ingredientDidRef
    //   };
    // });

    // console.log('Nutritional info:', nutritionalInfo);


    // Helper function to convert ISO 8601 duration to minutes
    function parseDurationToMinutes(duration) {
      if (!duration) return null;
      // Handle ISO 8601 format like "PT15M", "PT1H30M", "P1DT2H"
      const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
      if (match) {
        const hours = parseInt(match[1] || 0, 10);
        const minutes = parseInt(match[2] || 0, 10);
        return hours * 60 + minutes;
      }
      return null;
    }

    // Extract prep time, cook time, total time, cuisine, and course (already declared above)
    // Try JSON-LD first
    if (jsonLdRecipe) {
      prep_time_mins = parseDurationToMinutes(jsonLdRecipe.prepTime);
      cook_time_mins = parseDurationToMinutes(jsonLdRecipe.cookTime);
      total_time_mins = parseDurationToMinutes(jsonLdRecipe.totalTime);
    }

    // Fallback to HTML parsing if not found in JSON-LD
    if (!prep_time_mins) {
    const prepTimeMatch = $('.wprm-recipe-prep_time').text().trim().match(/(\d+)\s*mins?/i);
      prep_time_mins = prepTimeMatch ? parseInt(prepTimeMatch[1], 10) : null;
    }

    if (!cook_time_mins) {
    const cookTimeMatch = $('.wprm-recipe-cook_time').text().trim().match(/(\d+)\s*mins?/i);
      cook_time_mins = cookTimeMatch ? parseInt(cookTimeMatch[1], 10) : null;
    }

    if (!total_time_mins) {
    const totalTimeMatch = $('.wprm-recipe-total_time').text().trim().match(/(\d+)\s*mins?/i);
      total_time_mins = totalTimeMatch ? parseInt(totalTimeMatch[1], 10) : null;
    }

    // Parse servings (already declared above)
    // Try JSON-LD first
    if (jsonLdRecipe && jsonLdRecipe.recipeYield) {
      if (typeof jsonLdRecipe.recipeYield === 'number') {
        servings = jsonLdRecipe.recipeYield;
      } else if (typeof jsonLdRecipe.recipeYield === 'string') {
        const match = jsonLdRecipe.recipeYield.match(/\d+/);
        servings = match ? parseInt(match[0], 10) : null;
      }
    }
    
    // Fallback to HTML parsing
    if (!servings) {
    let servingsStr = $('#wprm-recipe-container-10480').attr('data-servings');
    // Fallback if data-servings is not found
    if (!servingsStr) {
      servingsStr = $('[class*="wprm-recipe-servings"]').text().trim() || null;
    }
    // Extract numerical value from servingsStr if possible
      servings = servingsStr ? parseInt(servingsStr.match(/\d+/)?.[0], 10) : null;
    }

    // Parse cuisine and course (already declared above)
    cuisine = jsonLdRecipe?.recipeCuisine || $('.wprm-recipe-cuisine').text().trim() || null;
    course = jsonLdRecipe?.recipeCategory || $('.wprm-recipe-course').text().trim() || null;


    // Extract notes
    const notes = $('.wprm-recipe-notes').text().trim() || null;

    console.log('Missing Ingredients:', missingIngredientNames);
    // console.log('Nutritional Info Array:', nutritionalInfoArray);
 
    console.log('Original Ingredient Names:', ingredientNames);
console.log('Units Before Assignment:', ingredientUnits);
console.log('Amounts Before Assignment:', ingredientAmounts);
console.log('Ingredient Did Refs:', ingredientRecords);

  // Normalize all ingredient names in `ingredientNames` upfront
  const normalizedIngredientNames = ingredientNames.map(name => name.trim().replace(/,$/, '').toLowerCase());


  console.log('Normalized Ingredient Names:', normalizedIngredientNames);
  console.log('Missing Ingredient Names:', missingIngredientNames.map(name => name.trim().replace(/,$/, '').toLowerCase()));

  // Normalize missing ingredients and process them
  missingIngredientNames.forEach((name, index) => {
    const normalizedName = name.trim().replace(/,$/, '').toLowerCase();
    console.log(`Normalized Missing Ingredient Name: ${normalizedName}`);
    
    // Find the matching ingredient in the normalized array
    const unitIndex = normalizedIngredientNames.findIndex(
      ingredientName => ingredientName === normalizedName
    );

    console.log(`Processing ingredient: ${normalizedName}, Index in ingredientNames: ${unitIndex}`);
    
    if (unitIndex !== -1 && !ingredientUnits[unitIndex]) {
      const nutritionalInfo = nutritionalInfoArray[index];
      console.log(`Found nutritional info for: ${normalizedName}`, nutritionalInfo);
      
      if (nutritionalInfo && nutritionalInfo.nutritionalInfo) {
        ingredientUnits[unitIndex] = nutritionalInfo.nutritionalInfo.standard_unit || 'unit';
        ingredientAmounts[unitIndex] *= nutritionalInfo.nutritionalInfo.standard_amount || 1;
      } else {
        console.log(`No nutritional info found for: ${normalizedName}`);
        ingredientUnits[unitIndex] = 'unit'; // Fallback unit
      }
    } else {
      console.log(`Ingredient not found or already has unit: ${normalizedName}`);
    }
  });

let ingredientDRefs = [];
ingredientNames.forEach((name, index) => {
  // get the ingredientDidRef for each ingredient and put it in an array so that we can use it in the recipeData object
  const ingredientDidRef = ingredientRecords.ingredientDidRefs[name] || null;
  ingredientDRefs.push(ingredientDidRef);
  console.log(`Ingredient DID Ref for ${name}:`, ingredientDidRef);
});

console.log('Final Units:', ingredientUnits);
console.log('Final Amounts:', ingredientAmounts);


console.log('Units After Assignment:', ingredientUnits);
console.log('Amounts After Assignment:', ingredientAmounts);

const recipeDate = Math.floor(new Date(metadata.publishedTime).getTime() / 1000) || Math.floor(Date.now() / 1000);
     
    // Process and upload recipe image to get BitTorrent and IPFS addresses
    let imageData = null;
    if (imageUrl) {
      try {
        console.log('Downloading recipe image from:', imageUrl);
        const imageFileName = await downloadImageFile(imageUrl, url);
        const mediaDownloadsDir = path.resolve(__dirname, '../media');
        const imagePath = path.join(mediaDownloadsDir, imageFileName);

        // Upload to media system to get BitTorrent magnet URI
        const FormData = require('form-data');
        const fs = require('fs');
        const form = new FormData();
        form.append('file', fs.createReadStream(imagePath));
        form.append('name', `${metadata.ogTitle || metadata.title} - Recipe Image`);
        form.append('access_level', 'public');

        // Upload to get mediaId and BitTorrent addresses
        const uploadResponse = await axios.post(`${getBaseUrl(req)}/api/media/upload`, form, {
          headers: {
            ...form.getHeaders(),
            'Authorization': req.headers.authorization || ''
          }
        });

        if (uploadResponse.data.success) {
          console.log('Image uploaded successfully, mediaId:', uploadResponse.data.mediaId);
          
          // Upload to IPFS
          const ipfsResponse = await axios.post(`${getBaseUrl(req)}/api/media/ipfs-upload`, {
            mediaId: uploadResponse.data.mediaId
          });

          // Setup web access
          const webResponse = await axios.post(`${getBaseUrl(req)}/api/media/web-setup`, {
            mediaId: uploadResponse.data.mediaId,
            filename: imageFileName
          });

          // Get image dimensions and size
          const sharp = require('sharp');
          const imageMetadata = await sharp(imagePath).metadata();

          imageData = {
            webUrl: webResponse.data.webUrl || uploadResponse.data.httpUrl,
            bittorrentAddress: uploadResponse.data.magnetURI || '',
            ipfsAddress: ipfsResponse.data.ipfsHash || '',
            arweaveAddress: '',
            filename: imageFileName,
            size: uploadResponse.data.size || 0,
            contentType: uploadResponse.data.mime || 'image/jpeg',
            width: imageMetadata.width || 0,
            height: imageMetadata.height || 0
          };
        }
      } catch (error) {
        console.error('Error processing recipe image:', error);
        // Fallback to just web URL if upload fails
        imageData = {
          webUrl: imageUrl,
          bittorrentAddress: '',
          ipfsAddress: '',
          arweaveAddress: '',
          filename: '',
          size: 0,
          contentType: 'image/jpeg',
          width: 0,
          height: 0
        };
      }
    }

    // Assign to recipeData - format for /api/publish/newRecipe endpoint
    // Ingredient comments are already separated during parsing
    const recipeData = {
      basic: {
        name: title || metadata.ogTitle || metadata.title || null,
        language: "En",
        date: recipeDate,
        description: description || null,
        webUrl: url || null,
        nsfw: false,
        tagItems: []
      },
      recipe: {
        prep_time_mins: prep_time_mins || null,
        cook_time_mins: cook_time_mins || null,
        total_time_mins: total_time_mins || null,
        servings: servings || null,
        ingredient_amount: ingredientAmounts.length ? ingredientAmounts : [],
        ingredient_unit: ingredientUnits.length ? ingredientUnits : [],
        ingredient: ingredientNames.length ? ingredientNames : [], // Send raw names - endpoint will handle lookup/matching
        ingredient_comment: ingredientComments.length ? ingredientComments : [],
        instructions: instructions.length ? instructions.join('\n') : '', // Join array to string
        notes: notes || '',
        cuisine: cuisine || null,
        course: course || null,
        author: metadata.author || null
      },
      blockchain: blockchain
    };

    // Add image object if we have image data
    if (imageData) {
      recipeData.image = imageData;
    }

    // TO DO, use this so that it doesnt break if there is no image included
    // if (articleData.embeddedImage) {
    //   recordToPublish.post.featuredImage = 
    //     {
    //       "basic": {
    //         "name": articleData.title,
    //         "language": "en",
    //         "nsfw": false,
    //         // "urlItems": [
    //         //   {
    //         //     "associatedUrlOnWeb": {
    //         //       "url": articleData.embeddedImage
    //         //     }
    //         //   }
    //         // ]
    //       },
    //       // "associatedUrlOnWeb": {
    //       //   "url": articleData.embeddedImageUrl
    //       // },
    //       "image": {
    //         "webUrl": articleData.embeddedImageUrl,
    //         // "bittorrentAddress": imageBittorrentAddress,
    //         "height": imageHeight,
    //         "width": imageWidth,
    //         "size": imageSize,
    //         "contentType": imageFileType
    //       }
    //     }
      
    // }



    // Log the recipe data being sent
    console.log('Recipe data to be published:', JSON.stringify(recipeData, null, 2));

    // Send to /api/publish/newRecipe endpoint
    try {
      const publishResponse = await axios.post(`${getBaseUrl(req)}/api/publish/newRecipe`, recipeData, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': req.headers.authorization || ''
        }
      });

      console.log('Recipe publishing initiated via /api/publish/newRecipe');
      console.log('Response:', publishResponse.data);
      
      const jobId = publishResponse.data.jobId;
      
      // Send initial job info through stream
      if (sendUpdate) {
        sendUpdate('recipePublished', {
          jobId: jobId,
          status: publishResponse.data.status,
          message: publishResponse.data.message,
          recipeData: recipeData, // Include the full recipe JSON that was sent
          progress: 0
        });
      }
      
      // Poll job status until completion
      let jobCompleted = false;
      let pollAttempts = 0;
      const maxPollAttempts = 120; // 10 minutes max (5 seconds * 120 = 600 seconds)
      
      while (!jobCompleted && pollAttempts < maxPollAttempts) {
        // Wait 5 seconds before polling
        await new Promise(resolve => setTimeout(resolve, 5000));
        pollAttempts++;
        
        try {
          console.log(`Polling job status (attempt ${pollAttempts})...`);
          const statusResponse = await axios.get(
            `${getBaseUrl(req)}/api/publish-status/${jobId}`,
            {
              headers: {
                'Authorization': req.headers.authorization || ''
              }
            }
          );
          
          const jobStatus = statusResponse.data;
          console.log('Job status:', jobStatus);
          
          // Send status update through stream
          if (sendUpdate) {
            sendUpdate('publishProgress', {
              jobId: jobStatus.jobId,
              status: jobStatus.status,
              progress: jobStatus.progress || 0,
              message: jobStatus.message,
              transactionId: jobStatus.transactionId || null
            });
          }
          
          // Check if job is completed
          if (jobStatus.status === 'completed') {
            jobCompleted = true;
            recipeRecord = {
              transactionId: jobStatus.transactionId,
              recordToIndex: jobStatus.recordToIndex,
              blockchain: jobStatus.blockchain || blockchain
            };
            
            // Send final completion event
            if (sendUpdate) {
              sendUpdate('recipeCompleted', {
                jobId: jobStatus.jobId,
                status: 'completed',
                progress: 100,
                message: 'Recipe published successfully',
                transactionId: jobStatus.transactionId,
                did: jobStatus.transactionId,
                blockchain: jobStatus.blockchain || blockchain,
                recordToIndex: jobStatus.recordToIndex
              });
            }
            
            console.log('Recipe publishing completed:', jobStatus.transactionId);
          } else if (jobStatus.status === 'failed') {
            // Job failed
            if (sendUpdate) {
              sendUpdate('error', {
                message: 'Recipe publishing failed',
                details: jobStatus.message,
                jobId: jobId
              });
            }
            throw new Error(`Job failed: ${jobStatus.message}`);
          }
          
        } catch (pollError) {
          console.error('Error polling job status:', pollError.response?.data || pollError.message);
          
          // If this is the last attempt, send error
          if (pollAttempts >= maxPollAttempts) {
            if (sendUpdate) {
              sendUpdate('error', {
                message: 'Job status polling timed out',
                details: 'Maximum polling attempts reached',
                jobId: jobId
              });
            }
            throw new Error('Job status polling timed out');
          }
          
          // For other errors, continue polling (might be temporary network issue)
          console.log('Continuing to poll despite error...');
        }
      }
      
      if (!jobCompleted) {
        throw new Error('Recipe publishing did not complete within the expected time');
      }
      
    } catch (error) {
      console.error('Error publishing recipe to /api/publish/newRecipe:', error.response?.data || error.message);
      
      // Send error update through stream if available
      if (sendUpdate) {
        sendUpdate('error', {
          message: 'Failed to publish recipe',
          details: error.response?.data || error.message
        });
      }
      
      throw error;
    }

    cleanupScrape(scrapeId); // Clear completed scrape


  }
  } catch (error) {
    console.error('Error fetching parsed recipe data:', error);

    cleanupScrape(scrapeId);
  }
}

// X API v2 tweet extraction using official API
async function fetchTweetWithAPI(tweetUrl) {
    try {
        // Extract tweet ID from URL
        const tweetId = extractTweetId(tweetUrl);
        if (!tweetId) {
            throw new Error('Could not extract tweet ID from URL');
        }

        console.log(`Extracting tweet ID: ${tweetId} using X API v2`);

        // Check if we have X API credentials
        const bearerToken = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;
        if (!bearerToken) {
            throw new Error('X API Bearer Token not configured. Please set X_BEARER_TOKEN environment variable.');
        }

        // Call X API v2 to get tweet data
        const apiUrl = `https://api.twitter.com/2/tweets/${tweetId}`;
        const params = new URLSearchParams({
            'expansions': 'author_id,attachments.media_keys',
            'tweet.fields': 'created_at,public_metrics,author_id,text',
            'user.fields': 'username,name',
            'media.fields': 'url,preview_image_url,type'
        });

        console.log(`Calling X API: ${apiUrl}?${params}`);

        const response = await axios.get(`${apiUrl}?${params}`, {
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        if (response.status !== 200) {
            throw new Error(`X API request failed with status ${response.status}`);
        }

        const data = response.data;
        console.log('X API Response:', JSON.stringify(data, null, 2));

        // Extract tweet data from API response
        const tweet = data.data;
        if (!tweet) {
            throw new Error('No tweet data found in API response');
        }

        // Get author information
        const author = data.includes?.users?.find(user => user.id === tweet.author_id);
        const authorName = author ? (author.name || author.username) : 'Unknown';

        // Get media attachments
        const images = [];
        if (tweet.attachments?.media_keys && data.includes?.media) {
            data.includes.media.forEach(media => {
                if (media.type === 'photo' && media.url) {
                    images.push(media.url);
                }
            });
        }

        const result = {
            text: tweet.text || '',
            author: authorName,
            username: author?.username || '',
            date: tweet.created_at || '',
            url: tweetUrl,
            images: images,
            metrics: tweet.public_metrics || {},
            // Add fields that the frontend expects for compatibility
            user: author ? {
                name: author.name,
                screen_name: author.username,
                username: author.username
            } : null
        };

        console.log('X API extraction successful:', result);
        return result;

    } catch (error) {
        console.error('X API extraction failed:', error.message);
        
        if (error.response) {
            console.error('X API Error Response:', error.response.status, error.response.data);
            
            if (error.response.status === 401) {
                throw new Error('X API authentication failed. Please check your Bearer Token.');
            } else if (error.response.status === 429) {
                throw new Error('X API rate limit exceeded. Please try again later.');
            } else if (error.response.status === 404) {
                throw new Error('Tweet not found. It may have been deleted or is from a protected account.');
            }
        }
        
        throw error;
    }
}

// Extract tweet ID from various X/Twitter URL formats
function extractTweetId(url) {
    const patterns = [
        /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/,
        /status\/(\d+)/,
        /\/(\d+)$/
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return match[1];
        }
    }
    
    return null;
}

async function fetchTweetDetails(tweetUrl) {
    try {
        // Update URL format for X.com if needed
        if (tweetUrl.includes('twitter.com')) {
            tweetUrl = tweetUrl.replace('twitter.com', 'x.com');
        }
        
        console.log(`Fetching tweet from: ${tweetUrl}`);
        
        // First, try using the official X API v2 if configured
        const bearerToken = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;
        if (bearerToken) {
            console.log('Using X API v2 for tweet extraction...');
            try {
                const apiResult = await fetchTweetWithAPI(tweetUrl);
                console.log('X API extraction successful, returning API data');
                return apiResult;
            } catch (apiError) {
                console.log('X API failed, falling back to web scraping:', apiError.message);
                // Continue to scraping fallback below
            }
        } else {
            console.log('X API not configured (no X_BEARER_TOKEN), using web scraping...');
        }
        
        // Fallback: Use web scraping (though this will likely fail due to X.com restrictions)
        console.log('⚠️  Warning: Web scraping X.com is unreliable and may fail. Consider setting up X API access.');
        
        // Use a browser-like user agent to avoid detection
        const response = await axios.get(tweetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: 15000,
            maxRedirects: 5
        });
        
        if (response.status !== 200) {
            throw new Error(`Failed to fetch tweet. Status: ${response.status}`);
        }
        
        const $ = cheerio.load(response.data);
        
        // Debug: Log page title to verify we got the right page
        const pageTitle = $('title').text();
        console.log(`Page title: ${pageTitle}`);
        
        // Enhanced selectors with multiple fallbacks for X.com structure changes
        let tweetText = '';
        let tweetAuthor = '';
        let tweetDate = '';
        
        // Try multiple selectors for tweet text
        const textSelectors = [
            'article[data-testid="tweet"] div[data-testid="tweetText"]',
            'article[data-testid="tweet"] div[lang]',
            'article div[data-testid="tweetText"]',
            'div[data-testid="tweetText"]',
            'article[role="article"] div[lang]',
            'article div[lang]:not([data-testid])',
            '[data-testid="tweetText"] span',
            'article span[lang]'
        ];
        
        for (const selector of textSelectors) {
            const element = $(selector);
            if (element.length > 0 && element.text().trim()) {
                tweetText = element.text().trim();
                console.log(`Found tweet text using selector: ${selector}`);
                break;
            }
        }
        
        // Try multiple selectors for author
        const authorSelectors = [
            'article[data-testid="tweet"] div[data-testid="User-Name"] a span',
            'article[data-testid="tweet"] div[data-testid="User-Name"] span',
            'article div[data-testid="User-Name"] span',
            'div[data-testid="User-Name"] span',
            'article[role="article"] div[data-testid="User-Name"] span',
            'article a[role="link"] span',
            'article div:contains("@") span'
        ];
        
        for (const selector of authorSelectors) {
            const element = $(selector);
            if (element.length > 0 && element.text().trim() && !element.text().startsWith('@')) {
                tweetAuthor = element.text().trim();
                console.log(`Found tweet author using selector: ${selector}`);
                break;
            }
        }
        
        // Try multiple selectors for date
        const dateSelectors = [
            'article[data-testid="tweet"] time',
            'article time',
            'time',
            'article[role="article"] time'
        ];
        
        for (const selector of dateSelectors) {
            const element = $(selector);
            if (element.length > 0 && element.attr('datetime')) {
                tweetDate = element.attr('datetime');
                console.log(`Found tweet date using selector: ${selector}`);
                break;
            }
        }
        
        // Alternative approach: extract from page data/scripts
        if (!tweetText || !tweetAuthor) {
            console.log('Primary selectors failed, trying script extraction...');
            
            // Look for JSON data in script tags
            $('script').each((i, script) => {
                const scriptContent = $(script).html();
                if (scriptContent && scriptContent.includes('full_text')) {
                    try {
                        // Try to extract tweet data from embedded JSON
                        const jsonMatch = scriptContent.match(/"full_text":"([^"]+)"/);
                        if (jsonMatch && !tweetText) {
                            tweetText = jsonMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                            console.log('Extracted text from script JSON');
                        }
                        
                        const authorMatch = scriptContent.match(/"screen_name":"([^"]+)"/);
                        if (authorMatch && !tweetAuthor) {
                            tweetAuthor = authorMatch[1];
                            console.log('Extracted author from script JSON');
                        }
                    } catch (e) {
                        // Continue if JSON parsing fails
                    }
                }
            });
        }
        
        // Extract meta tags as fallback
        if (!tweetText && !tweetAuthor) {
            console.log('Script extraction failed, trying meta tags...');
            
            const ogTitle = $('meta[property="og:title"]').attr('content');
            const ogDescription = $('meta[property="og:description"]').attr('content');
            const twitterTitle = $('meta[name="twitter:title"]').attr('content');
            const twitterDescription = $('meta[name="twitter:description"]').attr('content');
            
            if (ogDescription && ogDescription.length > 10) {
                tweetText = ogDescription;
                console.log('Using og:description as tweet text');
            } else if (twitterDescription && twitterDescription.length > 10) {
                tweetText = twitterDescription;
                console.log('Using twitter:description as tweet text');
            }
            
            if (ogTitle && ogTitle.includes(' on X:')) {
                tweetAuthor = ogTitle.split(' on X:')[0];
                console.log('Extracted author from og:title');
            } else if (twitterTitle && twitterTitle.includes(' on X:')) {
                tweetAuthor = twitterTitle.split(' on X:')[0];
                console.log('Extracted author from twitter:title');
            }
        }
        
        // Try to get images from the tweet
        const imageUrls = [];
        const imageSelectors = [
            'article[data-testid="tweet"] img[alt="Image"]',
            'article img[alt="Image"]',
            'img[alt="Image"]',
            'article img[src*="media"]',
            'img[src*="pbs.twimg.com"]'
        ];
        
        for (const selector of imageSelectors) {
            $(selector).each((i, img) => {
                const imgSrc = $(img).attr('src');
                if (imgSrc && !imgSrc.includes('profile') && !imgSrc.includes('avatar') && !imageUrls.includes(imgSrc)) {
                    imageUrls.push(imgSrc);
                }
            });
            if (imageUrls.length > 0) {
                console.log(`Found ${imageUrls.length} images using selector: ${selector}`);
                break;
            }
        }
        
        console.log(`Scraping results: text="${tweetText.substring(0, 50)}...", author="${tweetAuthor}", date="${tweetDate}", images=${imageUrls.length}`);
        
        // If we still don't have text, this might be a protected account or login required
        if (!tweetText && !tweetAuthor) {
            // Check if page indicates login required
            const bodyText = $('body').text().toLowerCase();
            if (bodyText.includes('sign up') || bodyText.includes('log in') || bodyText.includes('create account')) {
                throw new Error('X.com requires login to view this content. To fix this, set up X API access by adding X_BEARER_TOKEN to your environment variables.');
            }
        }
        
        return {
            text: tweetText || '',
            author: tweetAuthor || '',
            date: tweetDate || '',
            url: tweetUrl,
            images: imageUrls
        };
    } catch (error) {
        console.error(`Error fetching tweet: ${error.message}`);
        
        // Check for rate limiting
        if (error.response && error.response.status === 429) {
            console.log('Rate limited by Twitter. Adding delay before retrying...');
            await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
            return fetchTweetDetails(tweetUrl); // Retry
        }
        
        throw new Error(`Failed to retrieve tweet details: ${error.message}`);
    }
}

async function manualScrapeWithSelectors($, selectors) {
  for (const selector of selectors) {
    const element = $(selector);

    if (element.length && element.text().trim()) {
      // Checking for <a> tag specifically to ensure proper handling
      if (element.is('a')) {
        console.log('Found <a> tag:', element.text().trim());
      }

      return element.text().trim();  // Return the first valid text found
    }
  }
  return null;  // Return null if nothing is found
}

function generateScrapeId(url, userId) {
  // Concatenate URL and userId
  const data = `${url}-${userId}`;
  
  // Create a SHA-256 hash of the concatenated string
  return crypto.createHash('sha256').update(data).digest('hex');
}

router.post('/article', async (req, res) => {
  const { html, url, userId, screenshotBase64, screenshots, totalHeight, blockchain = 'arweave' } = req.body;

  if (!html || !url || !userId) {
    return res.status(400).json({ error: 'HTML, URL, and User ID are required' });
  }

  const scrapeId = generateScrapeId(url, userId);
  console.log('Scrape ID:', scrapeId);

  // Respond immediately with the scrapeId
  res.status(200).json({ scrapeId, blockchain });

  // Initialize the stream if not already present
  if (!ongoingScrapes.has(scrapeId)) {
    ongoingScrapes.set(scrapeId, { clients: [], data: [] });
  }

  try {
    // Begin fetching and storing the results to stream later
    const streamUpdates = (event, data) => {
      console.log('sending event over stream', event, data);
      const streamData = ongoingScrapes.get(scrapeId);
      if (streamData) {
        streamData.data.push({ event, data });
        console.log('streamData', streamData);
          streamData.clients.forEach(client => {
              if (typeof client.write === 'function') {
                console.log('writing event to client', event, data);
                  client.write(`event: ${event}\n`);
                  client.write(`data: ${JSON.stringify({ type: event, data })}\n\n`);
                  client.flush && client.flush(); // Ensure data is flushed to the client
                  console.log('Sent event:', event, data);
              } else {
                  console.warn('client.write is not a function');
              }
          });
      }
  };

    // Fetch article data and stream updates
    await fetchParsedArticleData(
      url, 
      html, 
      scrapeId, 
      screenshotBase64, 
      screenshots, 
      totalHeight, 
      { sendUpdate: streamUpdates, res, blockchain }
    );

  } catch (error) {
    console.error('Error starting scrape:', error);
    const streamData = ongoingScrapes.get(scrapeId);
    if (streamData) {
      streamData.clients.forEach(client => {
        client.write(`event: error\n`);
        client.write(`data: ${JSON.stringify({ message: 'Failed to fetch article data.' })}\n\n`);
        client.end(); // Close SSE stream
      });
      cleanupScrape(scrapeId); // Clean up
    }
  }
});

router.post('/recipe', async (req, res) => {
  const { html, url, screenshots, totalHeight, userId, blockchain = 'arweave' } = req.body;

  if (!url || !userId) {
    return res.status(400).json({ error: 'URL and User ID are required' });
  }

  const scrapeId = generateScrapeId(url, userId);
  console.log('Scrape ID:', scrapeId);

  // Respond immediately with the scrapeId
  res.status(200).json({ scrapeId, blockchain });

  // Initialize the stream if not already present
  if (!ongoingScrapes.has(scrapeId)) {
    ongoingScrapes.set(scrapeId, { clients: [], data: [] });
  }
      const streamData = ongoingScrapes.get(scrapeId);


  const sendUpdate = (event, data) => {
    console.log('sendUpdate', event, data);
    if (streamData) {
        streamData.data.push({ event, data });
        streamData.clients.forEach((client) => {
            client.write(`event: ${event}\n`);
            client.write(`data: ${JSON.stringify(data)}\n\n`);
            client.flush && client.flush();
        });
    }
};

  try {
    // Begin fetching and storing the results to stream later
  //   const streamUpdates = (event, data) => {
  //     const streamData = ongoingScrapes.get(scrapeId);
  //     if (streamData) {
  //         streamData.data.push({ event, data });
  //         streamData.clients.forEach(client => {
  //             if (typeof client.write === 'function') {
  //                 client.write(`event: ${event}\n`);
  //                 client.write(`data: ${JSON.stringify({ type: event, data })}\n\n`);
  //                 client.flush && client.flush();
  //                 console.log('Sent event:', event, data);
  //             } else {
  //                 console.warn('client.write is not a function');
  //             }
  //         }
  //         );
  //     }
  // }

    // Fetch recipe data and stream updates
    await fetchParsedRecipeData(
      url, 
      html,
      scrapeId, 
      screenshots, 
      totalHeight,
      { sendUpdate, res, blockchain }
    );

  } catch (error) {
    console.error('Error starting scrape:', error);
    const streamData = ongoingScrapes.get(scrapeId);
    if (streamData) {
      streamData.clients.forEach(client => {
        client.write(`event: error\n`);
        client.write(`data: ${JSON.stringify({ message: 'Failed to fetch recipe data.' })}\n\n`);
        client.end(); // Close SSE stream
      });
      cleanupScrape(scrapeId); // Clean up
    }
  }
})

// router.post('/article', async (req, res) => {
//   const { html, url, userId, screenshotBase64, screenshots, totalHeight } = req.body;

//   if (!html || !url || !userId) {
//     return res.status(400).json({ error: 'HTML, URL, and User ID are required' });
//   }

//   const scrapeId = generateScrapeId(url, userId);
//   console.log('Scrape ID:', scrapeId);

//   // Respond immediately with the scrapeId
//   res.status(200).json({ scrapeId });

//   // Start the scraping logic
//   if (!ongoingScrapes.has(scrapeId)) {
//     ongoingScrapes.set(scrapeId, []);
//   }

//   try {
//     // Begin fetching and storing the results to stream later
//     const streamUpdates = async (update) => {
//       const clients = ongoingScrapes.get(scrapeId) || [];
//       clients.forEach(client => {
//           client.write(`event: ${update.event}\n`);
//           client.write(`data: ${JSON.stringify(update.data)}\n\n`);
//       });
//   };

//     await fetchParsedArticleData(
//       url, 
//       html, 
//       scrapeId, 
//       screenshotBase64, 
//       screenshots, 
//       totalHeight, 
//       { sendUpdate: streamUpdates }
//     );

//   } catch (error) {
//     console.error('Error starting scrape:', error);
//     if (!res.headersSent) {
//       res.status(500).json({ error: 'Failed to start scrape.' });
//     }
//   }
// });

// X Post Scraping Endpoint
router.post('/x-post', authenticateToken, async (req, res) => {
  const { url } = req.body;

  if (!url || (!url.includes('x.com') && !url.includes('twitter.com'))) {
    return res.status(400).json({ error: 'Valid X/Twitter URL is required' });
  }

  try {
    console.log(`Scraping X post: ${url}`);
    
    // Use the existing fetchTweetDetails function
    const tweetData = await fetchTweetDetails(url);
    
    res.json({
      text: tweetData.text,
      author: tweetData.author,
      date: tweetData.date,
      url: tweetData.url,
      images: tweetData.images || []
    });

  } catch (error) {
    console.error('X post scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape X post: ' + error.message });
  }
});

// Web Article Archiving Endpoint (without requiring screenshots from frontend)
router.post('/web-article', authenticateToken, async (req, res) => {
  const { url, blockchain = 'arweave' } = req.body;
  const userId = req.user.id; // Get userId from authenticated token

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Validate URL format
  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  const scrapeId = generateScrapeId(url, userId);
  console.log('Web Article Scrape ID:', scrapeId);

  // Respond immediately with the scrapeId
  res.status(200).json({ scrapeId, blockchain });

  // Initialize the stream if not already present
  if (!ongoingScrapes.has(scrapeId)) {
    ongoingScrapes.set(scrapeId, { clients: [], data: [] });
  }

  try {
    // Stream updates function
    const streamUpdates = (event, data) => {
      console.log('sending event over stream', event, data);
      const streamData = ongoingScrapes.get(scrapeId);
      if (streamData) {
        streamData.data.push({ event, data });
        console.log('streamData', streamData);
        streamData.clients.forEach(client => {
          if (typeof client.write === 'function') {
            console.log('writing event to client', event, data);
            client.write(`event: ${event}\n`);
            client.write(`data: ${JSON.stringify({ type: event, data })}\n\n`);
            client.flush && client.flush(); // Ensure data is flushed to the client
            console.log('Sent event:', event, data);
          } else {
            console.warn('client.write is not a function');
          }
        });
      }
    };

    // Use Puppeteer to fetch HTML and generate screenshots automatically
    await fetchWebArticleWithPuppeteer(url, scrapeId, { sendUpdate: streamUpdates, res, blockchain });

  } catch (error) {
    console.error('Error starting web article scrape:', error);
    const streamData = ongoingScrapes.get(scrapeId);
    if (streamData) {
      streamData.clients.forEach(client => {
        client.write(`event: error\n`);
        client.write(`data: ${JSON.stringify({ message: 'Failed to fetch article data: ' + error.message })}\n\n`);
        client.end(); // Close SSE stream
      });
      cleanupScrape(scrapeId); // Clean up
    }
  }
});

// YouTube Video Archiving Endpoints
let youtubeTasks = new Map(); // Store ongoing tasks

router.post('/youtube-archive', authenticateToken, async (req, res) => {
  const { url } = req.body;

  if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) {
    return res.status(400).json({ error: 'Valid YouTube URL is required' });
  }

  try {
    const taskId = crypto.createHash('md5').update(url + Date.now()).digest('hex');
    
    // Initialize task
    youtubeTasks.set(taskId, {
      status: 'starting',
      progress: 0,
      message: 'Initializing...'
    });

    // Start background processing
    processYouTubeVideo(url, taskId);

    res.json({ taskId });

  } catch (error) {
    console.error('YouTube archive error:', error);
    res.status(500).json({ error: 'Failed to start YouTube archiving: ' + error.message });
  }
});

router.get('/youtube-progress', authenticateToken, (req, res) => {
  const { taskId } = req.query;
  
  if (!taskId || !youtubeTasks.has(taskId)) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const task = youtubeTasks.get(taskId);
  res.json(task);

  // Clean up completed/failed tasks after sending response
  if (task.status === 'complete' || task.status === 'error') {
    setTimeout(() => youtubeTasks.delete(taskId), 60000); // Clean up after 1 minute
  }
});

async function processYouTubeVideo(url, taskId) {
  try {
    // Update progress
    youtubeTasks.set(taskId, {
      status: 'downloading',
      progress: 20,
      message: 'Extracting video metadata...'
    });

    // Get metadata first
    const metadata = await getYouTubeMetadata(url);
    
    youtubeTasks.set(taskId, {
      status: 'downloading',
      progress: 40,
      message: 'Downloading video...'
    });

    // Download video to our media directory
    const videoId = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/)?.[1];
    if (!videoId) {
      throw new Error('Could not extract video ID from URL');
    }

    const outputPath = await downloadVideo(url, videoId);
    
    youtubeTasks.set(taskId, {
      status: 'downloading',
      progress: 70,
      message: 'Processing thumbnail...'
    });

    // Download and process thumbnail
    let thumbnailUrl = null;
    if (metadata.thumbnail) {
      try {
        const thumbnailFileName = await downloadImageFile(metadata.thumbnail, url);
        thumbnailUrl = `${getBaseUrl(req)}/api/media?id=${thumbnailFileName}`;
      } catch (error) {
        console.warn('Failed to download thumbnail:', error);
      }
    }

    youtubeTasks.set(taskId, {
      status: 'downloading',
      progress: 90,
      message: 'Finalizing...'
    });

    // Create hosted URL for the video
    const videoFileName = path.basename(outputPath);
    const hostedVideoUrl = `${getBaseUrl(req)}/api/media?id=${videoFileName}`;

    const result = {
      title: metadata.title,
      description: metadata.description,
      uploader: metadata.uploader,
      duration: metadata.duration,
      upload_date: metadata.upload_date,
      view_count: metadata.view_count,
      tags: metadata.tags || [],
      thumbnail: thumbnailUrl,
      video_url: hostedVideoUrl,
      original_url: url,
      resolution: metadata.height ? `${metadata.width}x${metadata.height}` : null
    };

    youtubeTasks.set(taskId, {
      status: 'complete',
      progress: 100,
      message: 'Video archived successfully!',
      result
    });

  } catch (error) {
    console.error('YouTube processing error:', error);
    youtubeTasks.set(taskId, {
      status: 'error',
      progress: 0,
      message: error.message,
      error: error.message
    });
  }
}



// In your open-stream endpoint
router.get('/open-stream', (req, res) => {
  const streamId = req.query.streamId;
  
  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Important for nginx proxying
  });
  
  // Send an initial ping to establish the connection
  res.write(`event: ping\n`);
  res.write(`data: ${JSON.stringify({timestamp: Date.now()})}\n\n`);
  
  // Setup periodic pings to keep the connection alive
  const pingInterval = setInterval(() => {
    res.write(`event: ping\n`);
    res.write(`data: ${JSON.stringify({timestamp: Date.now()})}\n\n`);
  }, 30000); // Every 30 seconds
  
  // Store the client connection
  if (!ongoingScrapes.has(streamId)) {
    ongoingScrapes.set(streamId, { clients: [], data: [] });
  }
  const streamData = ongoingScrapes.get(streamId);
  streamData.clients.push(res);
  
  // Send any cached events to this new client
  if (streamData.data && streamData.data.length > 0) {
    streamData.data.forEach(({ event, data }) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
  }
  
  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(pingInterval);
    const streamData = ongoingScrapes.get(streamId);
    if (streamData && streamData.clients) {
      const index = streamData.clients.indexOf(res);
      if (index !== -1) {
        streamData.clients.splice(index, 1);
      }
      
      // If no more clients, clean up resources
      if (streamData.clients.length === 0) {
        cleanupScrape(streamId);
        console.log(`No more clients for streamId: ${streamId}. Cleaning up.`);
      }
    }
  });
});

// Function to fetch web article using Puppeteer (without requiring frontend screenshots)
async function fetchWebArticleWithPuppeteer(url, scrapeId, options) {
  const { sendUpdate, res, blockchain = 'arweave' } = options;

  if (!puppeteer) {
    throw new Error('Puppeteer is not available. Install puppeteer to use web article archiving.');
  }

  let browser = null;

  try {
    sendUpdate('initializing', { message: 'Starting browser...' });

    // Launch Puppeteer with Alpine Linux compatible settings
    const browserArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      '--disable-ipc-flooding-protection',
      '--mute-audio',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-plugins',
      '--run-all-compositor-stages-before-draw',
      '--memory-pressure-off',
      '--max_old_space_size=4096'
    ];

    // Try to use system chromium first (Alpine Linux), fall back to bundled Chrome
    const fs = require('fs');
    const possiblePaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      process.env.CHROME_BIN,
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome'
    ];
    
    let executablePath = undefined;
    for (const path of possiblePaths) {
      if (path && fs.existsSync(path)) {
        executablePath = path;
        console.log(`Using Chrome/Chromium at: ${executablePath}`);
        break;
      }
    }
    
    if (!executablePath) {
      console.log('System chromium not found, using bundled Chrome (may cause compatibility issues in Alpine)');
    }

    try {
      console.log('Launching browser with args:', browserArgs);
      console.log('Executable path:', executablePath || 'default');
      
      browser = await puppeteer.launch({
        headless: true,
        executablePath: executablePath,
        args: browserArgs,
        timeout: 30000, // 30 second timeout
        ignoreDefaultArgs: false,
        dumpio: false // Set to true for debugging
      });
      
      console.log('Browser launched successfully');
    } catch (browserError) {
      console.error('Browser launch failed:', browserError.message);
      
      // If system chromium fails, try without executablePath as fallback
      if (executablePath && browserError.message.includes('Failed to launch')) {
        console.log('Retrying browser launch without custom executable path...');
        browser = await puppeteer.launch({
          headless: true,
          args: browserArgs,
          timeout: 30000,
          ignoreDefaultArgs: false
        });
        console.log('Browser launched successfully with bundled Chrome');
      } else {
        throw browserError;
      }
    }

    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1200, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    sendUpdate('loading', { message: 'Loading page...' });

    // Navigate to the URL
    await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });

    // Wait a bit for any dynamic content to load
    await page.waitForTimeout(2000);

    sendUpdate('processing', { message: 'Processing page content...' });

    // Get the HTML content
    const html = await page.content();

    // Scroll to capture the full page
    await page.evaluate(() => {
      return new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    // Get page dimensions
    const bodyHandle = await page.$('body');
    const { height } = await bodyHandle.boundingBox();
    await bodyHandle.dispose();

    sendUpdate('screenshot', { message: 'Generating screenshot...' });

    // Take a full page screenshot
    const screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: 'png'
    });

    // Convert screenshot to base64 and create screenshots array for compatibility
    const screenshotBase64 = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
    const screenshots = [{
      screenshot: screenshotBase64,
      height: height
    }];

    await browser.close();
    browser = null;

    sendUpdate('parsing', { message: 'Parsing article content...' });

    // Now use the existing fetchParsedArticleData function
    await fetchParsedArticleData(
      url, 
      html, 
      scrapeId, 
      screenshotBase64, 
      screenshots, 
      height,
      { sendUpdate, res, blockchain }
    );

  } catch (error) {
    if (browser) {
      await browser.close();
    }
    throw error;
  }
}

module.exports = router;