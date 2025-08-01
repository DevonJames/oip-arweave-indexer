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

// const backendURL = 'http://localhost:3005';
const backendURL = 'https://api.oip.onl';

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

  articleTextURL = `${backendURL}/api/media?id=${textFile}`;

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

    const hostedImageUrl = `${backendURL}/api/media?id=${imageFileName}`;
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
    const fullUrl = backendURL + articleData.summaryTTS;
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
      const didTx = records.records[0].oip.didTx;

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
      const screenshotURL = `${backendURL}/api/media?id=${screenshotMediaId}`;
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

      const screenshotURL = `${backendURL}/api/media?id=${screenshotMediaId}`;

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
          articleData.articleTextUrl = `${backendURL}/api/generate/media?id=${contentFileName}`;
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
        articleData.articleTextUrl = `${backendURL}/api/generate/media?id=${contentFileName}`;
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
      let articleDidTx = article.didTx;
      
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
async function fetchParsedRecipeData(url, html, scrapeId, screenshots, totalHeight, options) {
  console.log('Scrape ID:', scrapeId, 'Fetching parsed recipe data from', url);
  const { sendUpdate, res, blockchain = 'arweave' } = options; // Destructure blockchain from options

  if (!ongoingScrapes.has(scrapeId)) {
    ongoingScrapes.set(scrapeId, { clients: [res], data: [] });
  }

  const streamData = ongoingScrapes.get(scrapeId);
  sendUpdate('scrapeId', { scrapeId });


  console.log('converting screenshot to file');
  console.log('stitching images together using totalHeight:', totalHeight); 
  const screenshotMediaId = await stitchImages(screenshots, totalHeight, scrapeId);
  const screenshotURL = `${backendURL}/api/media?id=${screenshotMediaId}`;
  console.log('Full Screenshot saved at:', screenshotURL);


  // Site-specific selectors configuration
  const selectors = {
    default: {
      title: ['h1.entry-title', 'h1.recipe-title'],
      description: ['meta[name="description"]', 'p:first-of-type'],
      imageUrl: ['meta[property="og:image"]', 'img.wp-image:first-of-type'],
      ingredientSection: ['[class*="ingredient-group"]', '[class*="ingredients-group"]'],
      ingredientName: ['[class*="name"]'],
      ingredientAmount: ['[class*="amount"]'],
      ingredientUnit: ['[class*="unit"]'],
      instruction: ['.wprm-recipe-instruction'],
      servings: ['[data-servings]', '[class*="wprm-recipe-servings"]'],
      cuisine: ['.wprm-recipe-cuisine'],
      course: ['.wprm-recipe-course'],
      prepTime: ['.wprm-recipe-prep_time'],
      cookTime: ['.wprm-recipe-cook_time'],
      totalTime: ['.wprm-recipe-total_time'],
    },
    'themediterraneandish.com': {
      title: ['h1.entry-title'],
      servings: ['[data-servings]'],
    },
    'wholelifestylenutrition.com': {
      title: ['.tasty-recipes-title'],
      servings: ['.tasty-recipes-yield span'],
      prepTime: ['.tasty-recipes-prep-time span'],
      cookTime: ['.tasty-recipes-cook-time span'],
      totalTime: ['.tasty-recipes-total-time span'],
      ingredientSection: ['.tasty-recipes-ingredients ul'],
      ingredientName: ['li span:last-child'],
      ingredientAmount: ['li span[data-amount]'],
      ingredientUnit: ['li span[data-unit]'], // Adjust if units are encoded differently
      instruction: ['.tasty-recipes-instructions ol li'],
      imageUrl: ['meta[property="og:image"]'],
    },
  };

  // Identify the site and get the specific selectors
  const domain = new URL(url).hostname;

  const siteSelectors = selectors[domain] || selectors.default;

  try {
    console.log('Fetching recipe data from URL:', url);
    let htmlContent = html;

    if (!htmlContent) {
      // Fetch HTML using FireCrawl
      const response = await axios.post(
      'https://api.firecrawl.dev/v1/scrape',
      { url, formats: ['html'] },
      { headers: { Authorization: `Bearer ${process.env.FIRECRAWL}` } }
      );

      if (!response.data.success) throw new Error(`Scrape failed: ${response.data.error}`);

      htmlContent = response.data.data.html;
      const metadata = response.data.data.metadata;
    }
    const $ = cheerio.load(html);

    // Helper function for extracting text using selectors
    function extractText($, selectorList) {
      if (!Array.isArray(selectorList)) {
        throw new TypeError('selectorList must be an array');
      }
      for (const selector of selectorList) {
        const text = $(selector).text().trim();
        if (text) return text; // Return the first non-empty text found
      }
      return null; // Fallback if no text found
    }

    // Parse title, description, and image URL
    const title = extractText($, siteSelectors.title);
const description = extractText($, siteSelectors.description);
const imageUrl = extractText($, siteSelectors.imageUrl);

const cuisine = extractText($, siteSelectors.cuisine) || null;
const course = extractText($, siteSelectors.course) || null;
const prepTime = parseInt(extractText($, siteSelectors.prepTime)?.match(/\d+/)?.[0], 10) || null;
const cookTime = parseInt(extractText($, siteSelectors.cookTime)?.match(/\d+/)?.[0], 10) || null;
const totalTime = parseInt(extractText($, siteSelectors.totalTime)?.match(/\d+/)?.[0], 10) || null;

    // Parse servings
    let servingsStr = $(siteSelectors.servings[0]).attr('data-servings') || extractText($, siteSelectors.servings);
    const servings = servingsStr ? parseInt(servingsStr.match(/\d+/)?.[0], 10) : null;

    // Parse ingredient sections
    const ingredientSections = [];
    $(siteSelectors.ingredientSection.join(',')).each((i, section) => {
      const ingredients = [];
      $(section)
        .find(siteSelectors.ingredientName.join(','))
        .each((j, elem) => {
          const amount = $(elem).find(siteSelectors.ingredientAmount.join(',')).text().trim() || null;
          const unit = $(elem).find(siteSelectors.ingredientUnit.join(',')).text().trim() || null;
          const name = $(elem).text().trim() || null;
          if (name) {
            ingredients.push({
              amount: parseFloat(amount) || null,
              unit: unit || '',
              name: name || '',
            });
          }
        });
      if (ingredients.length) {
        ingredientSections.push({ section: `Section ${i + 1}`, ingredients });
      }
    });

    const primaryIngredientSection = ingredientSections.length > 1
      ? ingredientSections.reduce((prev, current) => (prev.ingredients.length > current.ingredients.length ? prev : current))
      : ingredientSections[0];

    // Parse instructions
    const instructions = [];
    $(siteSelectors.instruction.join(',')).each((i, elem) => {
      const instruction = $(elem).text().trim();
      if (instruction) instructions.push(instruction);
    });


    // Build the recipe data object
    const recipeData = {
      basic: {
        name: title,
        language: 'en',
        description,
        webUrl: url,
      },
      recipe: {
        servings,
        prep_time_mins: prepTime,
        cook_time_mins: cookTime,
        total_time_mins: totalTime,
        instructions,
        cuisine,
        course,
        ingredients: primaryIngredientSection?.ingredients || [],
      },
      image: {
        webUrl: imageUrl,
      },
    };

    console.log('Parsed Recipe Data:', recipeData);

    // if basic.name is null or empty or ingredients is empty, run analyzeImageForRecipe()
    const extractedRecipeData = await analyzeImageForRecipe(screenshotURL);
    console.log('extractedRecipeData:', extractedRecipeData);

    cleanupScrape(scrapeId);
    return recipeData;
  } catch (error) {
    console.error('Error parsing recipe data:', error);
    cleanupScrape(scrapeId);
  }
}


// works well for mediteranean site, trying another version that might generalize to all sites DO NOT DELETE TILL MOST OF ITS FUNCTIONALITY IS MIGRATED OVER
async function fetchParsedRecipeData(url, scrapeId, options) {
  const { sendUpdate, res } = options; // Destructure res from options
    // Ensure scrapeId is initialized
    if (!ongoingScrapes.has(scrapeId)) {
      ongoingScrapes.set(scrapeId, { clients: [res], data: [] });
    }
    const streamData = ongoingScrapes.get(scrapeId);
    sendUpdate('scrapeId', { scrapeId });

  try {
    console.log('Scrape ID:', scrapeId, 'Fetching parsed article data from', url);


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

    // Scrape the website using FireCrawl
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
    const metadata = response.data.data.metadata;
    // console.log('Metadata:', metadata);
    const html = response.data.data.html;
    const $ = cheerio.load(html);  

    console.log('Scraping recipe data from URL:', url);

    // Parse title, description, and metadata
    const title = $('h1.entry-title').text().trim() || $('h1.recipe-title').text().trim() || null;
    const description = metadata.ogDescription || $('p').first().text().trim() || null;
    const imageUrl = metadata.ogImage || $('img.wp-image').first().attr('src') || null;
    // const date = Date.now() / 1000;

    // Parse ingredient sections
    const ingredientSections = [];
    $('[class*="ingredient-group"], [class*="ingredients-group"]').each((i, section) => {
      const sectionName = $(section).find('[class*="group-name"], [class*="section-title"]').text().trim() || `Section ${i + 1}`;
      const ingredients = [];

      $(section)
        .find('[class*="ingredient"]')
        .each((j, elem) => {
          const amount = $(elem).find('[class*="amount"]').text().trim() || null;
          const unit = $(elem).find('[class*="unit"]').text().trim() || null;
          const name = $(elem).find('[class*="name"]').text().trim() || null;

          // Ensure that at least `name` is present and valid to include the ingredient
          if (name && (amount || unit || name)) {
            ingredients.push({
              amount: parseFloat(amount) || null,
              unit: unit || '',
              name: name || '',
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

    // Primary ingredient section logic
    let primaryIngredientSection = ingredientSections[0];
    if (ingredientSections.length > 1) {
      primaryIngredientSection = ingredientSections.reduce((prev, current) =>
        prev.ingredients.length > current.ingredients.length ? prev : current
      );
    }

    console.log('Ingredient sections count:', ingredientSections.length, ingredientSections);
    console.log('Primary ingredient section:', primaryIngredientSection);


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

  // Extract instructions
  const instructions = [];


  $('.wprm-recipe-instruction').each((i, elem) => {
    const instruction = $(elem).text().replace(/\s+/g, ' ').trim();
    if (instruction) instructions.push(instruction);
  });

  console.log('Instructions:', instructions);

  const ingredientNames = primaryIngredientSection.ingredients.map(ing => {
    const normalizedIngredientName = ing.name.trim().toLowerCase().replace(/,$/, '');
    return normalizedIngredientName;
  });
  const ingredientAmounts = primaryIngredientSection.ingredients.map(ing => ing.amount ?? 1);
const ingredientUnits = primaryIngredientSection.ingredients.map(ing => (ing.unit && ing.unit.trim()) || 'unit'); // Default unit to 'unit'

  console.log('Ingredient units:', ingredientUnits);
    
  // Define ingredient synonyms for better matching
  const synonymMap = {
      "garlic cloves": "minced garlic",
      "ground green cardamom": "ground cardamom",
      "chicken breast": "boneless skinless chicken breast",
      "chicken thighs": "boneless skinless chicken thighs",
      "olive oil": "extra virgin olive oil",
      "vegetable oil": "seed oil",
      "all-purpose flour": "flour",
      "green onions": "scallions",
      "cilantro": "fresh cilantro",
      "parsley": "fresh parsley",
      "basil": "fresh basil",
      "oregano": "fresh oregano",
      "thyme": "fresh thyme",
      "rosemary": "fresh rosemary",
      "sage": "fresh sage",
      "dill": "fresh dill",
      "mint": "fresh mint",
      "chives": "fresh chives",
      "tarragon": "fresh tarragon",
      "bay leaves": "dried bay leaves",
      "red pepper flakes": "crushed red pepper",
      "red pepper": "red bell pepper",
      // Add more as needed
  };

  let recordMap = {};
    
  async function fetchIngredientRecordData(primaryIngredientSection) {
    const ingredientNames = primaryIngredientSection.ingredients.map(ing => ing.name.trim().toLowerCase().replace(/,$/, ''));

    // Query for all ingredients in one API call
    const queryParams = {
        recordType: 'nutritionalInfo',
        search: ingredientNames.join(','),
        limit: 50
    };

    const recordsInDB = await getRecords(queryParams);
    console.log('quantity of results:', recordsInDB.searchResults);
    // Populate the global recordMap
    recordMap = {};  // Reset before populating
    recordsInDB.records.forEach(record => {
        const recordName = record.data.basic.name.toLowerCase();
        recordMap[recordName] = record;
    });

    const ingredientDidRefs = {};
    const nutritionalInfo = [];

    for (const name of ingredientNames) {
        const bestMatch = findBestMatch(name);
        if (bestMatch) {
            ingredientDidRefs[name] = bestMatch.oip.didTx;
            nutritionalInfo.push({
                ingredientName: bestMatch.data.basic.name,
                nutritionalInfo: bestMatch.data.nutritionalInfo || {},
                ingredientSource: bestMatch.data.basic.webUrl,
                ingredientDidRef: bestMatch.oip.didTx
            });
            console.log(`Match found for ${name}:`, nutritionalInfo[nutritionalInfo.length - 1]);
        } else {
            ingredientDidRefs[name] = null;
        }
    }

    return { ingredientDidRefs, nutritionalInfo };

    
  }

// } catch (error) {
// console.error('Error fetching parsed recipe data:', error);
// sendUpdate('error', { message: 'Failed to fetch recipe data.' });
// res.end();
// cleanupScrape(scrapeId);
// }



    
  // Function to find the best match
  function findBestMatch(ingredientName) {
    if (!recordMap || Object.keys(recordMap).length === 0) {
        console.error("Error: recordMap is not populated before calling findBestMatch().");
        return null;
    }
    // const ingredientNames = primaryIngredientSection.ingredients.map(ing => {
    //   const normalizedIngredientName = ing.name.trim().toLowerCase().replace(/,$/, '');
    //   return normalizedIngredientName;
    // });
  
    // const normalizedIngredientName = ing.name.trim().toLowerCase().replace(/,$/, '');
    const searchTerms = ingredientName.split(/\s+/).filter(Boolean);

    console.log(`Searching for ingredient: ${ingredientName}, Search terms:`, searchTerms);

    // Check if the ingredient has a predefined synonym
    const synonym = synonymMap[ingredientName];
    if (synonym && recordMap[synonym]) {
        console.log(`Found synonym match for ${ingredientName}: ${synonym}`);
        return recordMap[synonym];
    }

    // Direct match
    if (recordMap[ingredientName]) {
        console.log(`Direct match found for ${ingredientName}, nutritionalInfo:`, recordMap[ingredientName].data.nutritionalInfo);
        return recordMap[ingredientName];
    }

    // Looser match using search terms
    const matches = Object.keys(recordMap)
        .filter(recordName => {
            const normalizedRecordName = recordName.toLowerCase();
            return searchTerms.some(term => normalizedRecordName.includes(term));
        })
        .map(recordName => recordMap[recordName]);

    if (matches.length > 0) {
        matches.sort((a, b) => {
            const aMatchCount = searchTerms.filter(term => a.data.basic.name.toLowerCase().includes(term)).length;
            const bMatchCount = searchTerms.filter(term => b.data.basic.name.toLowerCase().includes(term)).length;
            return bMatchCount - aMatchCount;
        });

        console.log(`Loose matches found for ${ingredientName}:`, matches);
        return matches[0];
    }

    console.log(`No match found for ${ingredientName}`);
    return null;
  }

  const ingredientRecords = await fetchIngredientRecordData(primaryIngredientSection);
  console.log('Ingredient records:', ingredientRecords);
  
  let missingIngredientNames = Object.keys(ingredientRecords.ingredientDidRefs).filter(
    name => ingredientRecords.ingredientDidRefs[name] === null
  );
  if (missingIngredientNames.length > 0) {
    // Send the names of the missing ingredients through findBestMatch(ingredientName) to get the best match for each
    const bestMatches = await Promise.all(
      missingIngredientNames.map(name => findBestMatch(name))
    );
    console.log('Best matches for missing ingredients:', bestMatches);

    // Assign matches and update ingredientDidRefs
    bestMatches.forEach((match, index) => {
      if (match) {
        const name = missingIngredientNames[index];
        ingredientDidRefs[name] = match.oip.didTx;
        nutritionalInfo.push({
          ingredientName: match.data.basic.name,
          nutritionalInfo: match.data.nutritionalInfo || {},
          ingredientSource: match.data.basic.webUrl,
          ingredientDidRef: match.oip.didTx
        });
      }
    });

    // Remove matched names from missingIngredientNames
    let matchedNames = bestMatches
      .map((match, index) => (match ? missingIngredientNames[index] : null))
      .filter(name => name !== null);
    missingIngredientNames = missingIngredientNames.filter(name => !matchedNames.includes(name));

    const nutritionalInfoArray = await Promise.all(
      missingIngredientNames.map(name => createNewNutritionalInfoRecord(name, blockchain))
    );

    // Restart the function now that all ingredients have nutritional info
    return await fetchParsedRecipeData(url, scrapeId, options);
  }
  // Check for empty values in ingredientUnits and assign standard_unit from nutritionalInfoArray
  missingIngredientNames.forEach((name, index) => {
    const trimmedName = name.trim().replace(/,$/, '');
    const unitIndex = ingredientNames.findIndex(ingredientName => ingredientName === trimmedName);

    console.log(`Processing missing ingredient: ${trimmedName}, Found at index: ${unitIndex}`);

    if (unitIndex !== -1 && !ingredientUnits[unitIndex]) {
        const nutritionalInfo = nutritionalInfoArray[index];
        console.log(`Found nutritional info for: ${trimmedName}`, nutritionalInfo);

        if (nutritionalInfo && nutritionalInfo.nutritionalInfo) {
            ingredientUnits[unitIndex] = nutritionalInfo.nutritionalInfo.standard_unit || 'unit';
            ingredientAmounts[unitIndex] *= nutritionalInfo.nutritionalInfo.standard_amount || 1;

            console.log(`Updated Units: ${ingredientUnits[unitIndex]}, Updated Amounts: ${ingredientAmounts[unitIndex]}`);
        } else {
            console.log(`No nutritional info found for: ${trimmedName}`);
            ingredientUnits[unitIndex] = 'unit'; // Fallback unit
        }
    } else {
        console.log(`Ingredient not found in ingredientNames or already has a unit: ${trimmedName}`);
    }
});
  // You can now use nutritionalInfoArray as needed

  // console.log('Ingredient DidRefs:', ingredientDidRefs);

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


    // Extract prep time, cook time, total time, cuisine, and course

    const prepTimeMatch = $('.wprm-recipe-prep_time').text().trim().match(/(\d+)\s*mins?/i);
    const prep_time_mins = prepTimeMatch ? parseInt(prepTimeMatch[1], 10) : null;

    const cookTimeMatch = $('.wprm-recipe-cook_time').text().trim().match(/(\d+)\s*mins?/i);
    const cook_time_mins = cookTimeMatch ? parseInt(cookTimeMatch[1], 10) : null;

    const totalTimeMatch = $('.wprm-recipe-total_time').text().trim().match(/(\d+)\s*mins?/i);
    const total_time_mins = totalTimeMatch ? parseInt(totalTimeMatch[1], 10) : null;

    let servingsStr = $('#wprm-recipe-container-10480').attr('data-servings');
    // Fallback if data-servings is not found
    if (!servingsStr) {
      servingsStr = $('[class*="wprm-recipe-servings"]').text().trim() || null;
    }
    // Extract numerical value from servingsStr if possible
    const servings = servingsStr ? parseInt(servingsStr.match(/\d+/)?.[0], 10) : null;

    const cuisine = $('.wprm-recipe-cuisine').text().trim() || null;
    const course = $('.wprm-recipe-course').text().trim() || null;


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

const recipeDate = Math.floor(new Date(metadata.publishedTime).getTime() / 1) || Date.now() / 1;
     
    
    // Assign to recipeData
    const recipeData = {
      basic: {
        name: metadata.ogTitle || metadata.title || null,
        language: "En",
        date: recipeDate,
        description,
        webUrl: url || null,
        nsfw: false,
        // tagItems: [],
      },
      recipe: {
        prep_time_mins,
        cook_time_mins,
        total_time_mins,
        servings,
        ingredient_amount: ingredientAmounts.length ? ingredientAmounts : null,
        ingredient_unit: ingredientUnits.length ? ingredientUnits : null,
        ingredient: ingredientDRefs,
        instructions: instructions.length ? instructions : null,
        notes,
        cuisine,
        course,
        author: metadata.author || null
      },
      image: {
        webUrl: imageUrl,
        // contentType: imageFileType
      },
    };

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



// console.log('nutritionalInfo:', nutritionalInfo);
    console.log('Recipe data:', recipeData);
    recipeRecord = await publishNewRecord(recipeData, "recipe", false, false, false, null, blockchain)
    console.log('Recipe record:', recipeRecord);

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
        thumbnailUrl = `${backendURL}/api/media?id=${thumbnailFileName}`;
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
    const hostedVideoUrl = `${backendURL}/api/media?id=${videoFileName}`;

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
    ongoingScrapes.set(streamId, []);
  }
  ongoingScrapes.get(streamId).push(res);
  
  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(pingInterval);
    const clients = ongoingScrapes.get(streamId);
    if (clients) {
      const index = clients.indexOf(res);
      if (index !== -1) {
        clients.splice(index, 1);
      }
      
      // If no more clients, clean up resources
      if (clients.length === 0) {
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