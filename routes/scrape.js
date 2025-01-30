const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
// const { crypto } = require('crypto');
const base64url = require('base64url');
const { createCanvas, loadImage, Image } = require('canvas');
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
const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware
const { ongoingScrapes } = require('../helpers/sharedState.js'); // Adjust the path to store.js

// const { FirecrawlApp } = require('@mendable/firecrawl-js');
// const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

// const cheerio = require('cheerio');

// Initialize FirecrawlApp with your API key

const {
  replaceAcronyms,
  identifyAuthorNameFromContent, 
  identifyPublishDateFromContent, 
  generateSummaryFromContent,
  analyzeImageForAuthor
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
function generateAudioFileName(text) {
  return crypto.createHash('sha256').update(text).digest('hex') + '.wav';
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
      return tweetIdMatch ? tweetIdMatch[1] : null;
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

async function publishArticleAndAttachedMedia(articleData, $, url, html, res) {
  console.log('test test url:', url); 
  // Initialize an array to hold YouTube URLs
  let youtubeUrls = [];

  // Direct YouTube URL search (in the content)
  youtubeUrls = [...articleData.content.matchAll(/(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+)/g)].map(match => match[0]);

  // Ensure the downloads directory exists
  const downloadsDir = path.resolve(__dirname, '../media');
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }
  let imageArweaveAddress
  let imageIPFSAddress
  let imageBittorrentAddress
  let imageFileType
  let imageWidth
  let imageHeight
  let imageSize
  
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

  // publish to arweave
  // const arweaveAddress = await publishArticleText(textFile.outputPath, null, null, null, false);
  
  articleTextURL = `${backendURL}/api/media?id=${textFile}`;
  // TEMPORARILY TURNED OFF FOR FIRST RELEASE
  // articleTextAddresses = await publishArticleText(textFile.outputPath, null, null, null, false);
  // console.log({articleTextURL},'articleTextBittorrentAddress', articleTextAddresses.torrent.magnetURI);
  // articleTextBittorrentAddress = articleTextAddresses.torrent.magnetURI;
// let hostedImageUrl
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

    // Use the extracted filename in the imagePath
    // const imagePath = path.join(downloadsDir, fileName);

    const imageFileName = await downloadImageFile(imageUrl, url);
    // fileName=imageFile.imageFileName
    const mediaDownloadsDir = path.resolve(__dirname, '../media');
    console.log('mediaDownloadsDir', mediaDownloadsDir, 'fileName', imageFileName);
    const imagePath = path.join(mediaDownloadsDir, imageFileName);

    // const imagePath = imageFile.imageFileName
    // const imagePath = path.join(downloadsDirectory, imageFile.imageFileName);
    const hostedImageUrl = `${backendURL}/api/media?id=${imageFileName}`;
    articleData.embeddedImageUrl = hostedImageUrl;
    // TEMPORARILY TURNED OFF FOR FIRST RELEASE
    // torrent = await publishImage(imageFile.outputPath, null, null, null, false);
    // imageBittorrentAddress = torrent.magnetURI;
    // console.log('imageBittorrentAddress', imageBittorrentAddress);
    // imageFileType = mimeTypes[fileType.toLowerCase()] || 'application/octet-stream';

    // Get image dimensions and file size using 'sharp'
    // path.join(downloadsDir, fileName)
    console.log('Image file:', imagePath);
    const imageStats = fs.statSync(imagePath);
    imageSize = imageStats.size;
    imageFileType = mimeTypes[fileType.toLowerCase()] || 'image/jpeg';

    const imageMetadata = await sharp(imagePath).metadata();
    imageWidth = imageMetadata.width;
    imageHeight = imageMetadata.height;
    console.log(articleData.embeddedImageUrl);

    // console.log('Image dimensions:', imageWidth, imageHeight);
    // console.log('Image size:', imageSize);
  }

  // TEMPORARILY DISABLING TWEETS AND YT VIDEOS - DO NOT DELETE
  // Fetch and download Twitter videos
    try {
      let embeddedTweets = await getEmbeddedTweets(html);
      console.log('embeddedTweets', embeddedTweets);
      let tweetDetails = null;
      const tweetVideoTorrent = [];
      const tweetRecords = [];
      const tweetVideoRecords = [];
      const youtubeVideoTorrent = [];
      let videoRecords = [];

      if (embeddedTweets.length > 0) {
        tweetDetails = await fetchTweetDetails(embeddedTweets);
        console.log('Tweet details:', tweetDetails);
      }
      if (tweetDetails && tweetDetails.includes && tweetDetails.includes.media) {
        let tweetMediaUrls = await getTwitterMediaUrls(embeddedTweets);
        await Promise.all(embeddedTweets.map(async (tweet, index) => {
          const tweetId = tweet.match(/status\/(\d+)/)[1]; // Extract tweet ID
          const mediaUrl = tweetMediaUrls[index];

          if (mediaUrl) {
            outputPath = await downloadMedia(mediaUrl, tweetId); // Pass media URL and tweet ID
            console.log('Media downloaded to:', outputPath);
            // mediaFiles = await publishMediaFiles(outputPath, tweetId, false);
            // tweetMediaRecords[index] = {
            //   "media": {
            //     "bittorrentAddress": mediaFiles.torrentAddress
            //   }
            // };
            // tweetMediaTorrent.push(mediaFiles.torrentAddress);
          } else {
            // tweetMediaRecords[index] = null; // No media for this tweet
          }
        }));
        // }

        for (let i = 0; i < embeddedTweets.length; i++) {
          // console.log('tweetDetails from index', tweetDetails[i], 'tweetdetails', tweetDetails);
          const tweetRecord = {
            "basic": {
              "name": tweetDetails.data[i].id,
              "language": "en",
              "date": tweetDetails.data[i].created_at,
              "description": tweetDetails.data[i].text,
              "urlItems": [
                {
                  "associatedUrlOnWeb": {
                    "url": embeddedTweets[i]
                  }
                }
              ]
            },
            "post": {
              "bylineWriter": tweetDetails.data[i].author_id,
              "videoItems": tweetVideoRecords[i] ? [tweetVideoRecords[i]] : [] // Add video record or empty array
            }
          };
          tweetRecords.push(tweetRecord);
        }

        console.log('tweetRecords', tweetRecords);
      }
    } catch (error) {
      console.error('Error processing embedded tweets:', error);
    }




    // if (tweetVideoTorrent.length > 0) {
    //   console.log('Twitter video torrents:', tweetVideoTorrent);
    //   res.write(`event: tweets\n`);
    //   res.write(`data: ${JSON.stringify(tweetVideoTorrent)}\n\n`);
    // }
    // // Scrape YouTube iframes using Cheerio
    // const youtubeIframeUrls = [];

    // $('iframe[src*="youtube.com"]').each((i, elem) => {
    //   const iframeSrc = $(elem).attr('src');
    //   if (iframeSrc) {
    //     youtubeIframeUrls.push(iframeSrc);
    //   }
    // });
    // // Also look for YouTube videos embedded in iframes
    // if (youtubeIframeUrls.length > 0) {
    //   youtubeIframeUrls.forEach(iframeSrc => {
    //     const youtubeUrlMatch = iframeSrc.match(/(https?:\/\/(?:www\.)?(?:youtube\.com\/embed\/)[\w-]+)/);
    //     if (youtubeUrlMatch) {
    //       const videoUrl = youtubeUrlMatch[0].replace("/embed/", "/watch?v=");
    //       youtubeUrls.push(videoUrl);
    //     }
    //   });
    // }
    // // Direct YouTube URL search (in the content)
    // const youtubeUrlMatches = [...html.matchAll(/(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+)/g)];
    // youtubeUrlMatches.forEach(match => youtubeUrls.push(match[0]));
    // // Remove duplicates
    // youtubeUrls = [...new Set(youtubeUrls)];
    // for (const videoUrl of youtubeUrls) {
    //   const videoId = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)[1]; // Extract YouTube video ID
    //   const metadata = await getYouTubeMetadata(videoUrl);
    //   videoOutputPath = path.join(downloadsDir, `${videoId}/${videoId}.mp4`);
    //   // videoMetadata.push(metadata);
    //   await downloadVideo(videoUrl, videoId); // Pass video URL and YouTube video ID
    //   // Assuming metadata.automatic_captions.en is your array
    //   const captions = metadata.automatic_captions.en;
    //   let vttUrl;
    //   if (captions) {
    //     // Find the URL for the caption with the 'vtt' extension
    //     const vttCaption = captions.find(caption => caption.ext === 'vtt');

    //     if (vttCaption) {
    //       vttUrl = vttCaption.url;
    //       console.log('VTT Caption URL:', vttUrl);
    //     } else {
    //       console.log('No VTT captions found.');
    //     }
    //     await downloadFile(vttUrl, path.join(downloadsDir, `${videoId}/${videoId}.vtt`));
    //     transcriptOutputPath = path.join(downloadsDir, `${videoId}/${videoId}.vtt`)
    //     console.log('Transcript downloaded to:', transcriptOutputPath);
    //     transriptAddresses = await publishArticleText(transcriptOutputPath, null, null, null, false);
    //     console.log('transcriptBittorrentAddress', transriptAddresses.torrent.magnetURI);
    //     transcriptBittorrentAddress = transriptAddresses.torrent.magnetURI;
    //   }
    //   const videoFiles = await publishVideoFiles(videoOutputPath, videoId, false);
    //   let fileType = path.extname(videoOutputPath);
    //   let videoFileType = mimeTypes[fileType.toLowerCase()] || 'application/octet-stream';
    //   let fileName = `${videoId}.mp4`
    //   youtubeVideoTorrent.push(videoFiles.torrentAddress);
    //   videoRecordData = {
    //     "basic": {
    //       "name": metadata.title,
    //       "language": "en",
    //       "date": metadata.timestamp,
    //       "description": metadata.description,
    //       "urlItems": [
    //         {
    //           "associatedUrlOnWeb": {
    //             "url": videoUrl
    //           }
    //         }
    //       ],
    //       "nsfw": false,
    //       "tagItems": [...(metadata.tags || []), ...(metadata.categories || [])]
    //     },
    //     "video": {
    //       "arweaveAddress": "",
    //       "ipfsAddress": "",
    //       "bittorrentAddress": youtubeVideoTorrent,
    //       "filename": fileName,
    //       "size": metadata.filesize || 0,
    //       "width": metadata.width,
    //       "height": metadata.height,
    //       "duration": metadata.duration,
    //       "contentType": videoFileType
    //     },
    //     "text": {
    //       "bittorrentAddress": transcriptBittorrentAddress,
    //       "contentType": "text/text"
    //     }

    //   };
    //   videoRecords.push(videoRecordData);
    // }
    // if (youtubeUrls.length > 0) {
    //   console.log('YouTube video URLs:', youtubeUrls);
    //   console.log('YouTube video torrents:', youtubeVideoTorrent);
    //   res.write(`event: youtube\n`);
    //   res.write(`data: ${JSON.stringify(youtubeVideoTorrent)}\n\n`);
    // }

  if (articleData.summaryTTS) {
    const fullUrl = backendURL + articleData.summaryTTS;
    articleData.summaryTTS = fullUrl;
  }
  // console.log('Final article data:', articleData);
  // res.write(`event: finalData\n`);
  // res.write(`data: ${JSON.stringify(articleData)}\n\n`);

  // res.end();
  // audioUrl = `https://api.oip.onl/api/generate/media?id=${articleData.summaryTTSid}`
  // const cleanUrl = (url) => {
  //   const urlObj = new URL(url);
  //   return urlObj.origin + urlObj.pathname;
  // };

  const recordToPublish = {
    "basic": {
      "name": articleData.title,
      "language": "en",
      "date": articleData.publishDate,
      "description": articleData.description,
      "nsfw": false,
      "tagItems": articleData.tags || []
    },
    "post": {
      "bylineWriter": articleData.byline,
      "articleText": 
        { 
          "text": {
            "webUrl": articleTextURL,
            "contentType": "text/text"
          }
          // "associatedUrlOnWeb": {
          //   "url": articleTextURL
          // }
        }
      ,
      "webUrl": cleanUrl(articleData.url),
    },
    // "associatedUrlOnWeb": {
    //   "url": cleanUrl(articleData.url)
    // }
  };
  if (articleData.embeddedImage) {
    recordToPublish.post.featuredImage = 
      {
        "basic": {
          "name": articleData.title,
          "language": "en",
          "nsfw": false,
          // "urlItems": [
          //   {
          //     "associatedUrlOnWeb": {
          //       "url": articleData.embeddedImage
          //     }
          //   }
          // ]
        },
        // "associatedUrlOnWeb": {
        //   "url": articleData.embeddedImageUrl
        // },
        "image": {
          "webUrl": articleData.embeddedImageUrl,
          // "bittorrentAddress": imageBittorrentAddress,
          "height": imageHeight,
          "width": imageWidth,
          "size": imageSize,
          "contentType": imageFileType
        }
      }
    
  }

  if (articleData.summaryTTS) {
    recordToPublish.post.audioItems = [
      { 
        "audio": {
          "webUrl": articleData.summaryTTS,
          "contentType" : "audio/mp3"
        }
      }
    ]
  }

  console.log('this is whats getting published:', recordToPublish)
        

    // TEMPORARILY DISABLING TWEETS AND YT VIDEOS - DO NOT DELETE
    // if (youtubeVideoTorrent.length > 0) {
    //   recordToPublish.post.videoItems = [...videoRecords];
    // }
    // if (imageBittorrentAddress) {
    //   recordToPublish.post.featuredImage = [{
    //   "basic": {
    //     "name": articleData.title,
    //     "language": "en",
    //     "nsfw": false,
    //     "urlItems": [
    //     {
    //       "associatedUrlOnWeb": {
    //       "url": articleData.embeddedImage
    //       }
    //     }
    //     ]
    //   },
    //   "image": {
    //     "bittorrentAddress": imageBittorrentAddress,
    //     "height": imageHeight,
    //     "width": imageWidth,
    //     "size": imageSize,
    //     "contentType": imageFileType
    //   }
    //   }];
    // }
    // if (tweetRecords.length > 0) {
    //   recordToPublish.post.citations = [...tweetRecords];
    // }
    record = await publishNewRecord(recordToPublish, "post")
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
//       ongoingScrapes.delete(scrapeId);
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

//       ongoingScrapes.delete(scrapeId);
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
  const { sendUpdate, res } = options; // Destructure res from options

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
      // ongoingScrapes.delete(scrapeId); // Clear completed scrape


    } else {
      // Handle new article scraping if no archived data is found
      console.log('Not found in Archive, fetching as a new article...');
      const data = await Parser.parse(url, { html: html });
      console.log('Parsed data:', data);

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
      console.log('Sending initialData:', articleData);

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
        // if (!articleData.byline) {
          console.log('Byline not found in content. Attempting to extract from screenshot...', screenshotURL);
          const extractedByline = await analyzeImageForAuthor(screenshotURL);
          articleData.byline = extractedByline || null; // Fallback to any previously found byline
      // }
        const authorSelector = [
          '.author', '.author-name', '.byline', '.by-author', '.byline__name', '.post-author', '.auth-name', '.ArticleFull_headerFooter__author',
          '.entry-author', '.post-author-name', '.post-meta-author', '.article__author', '.author-link', '.article__byline', '.content-author',
          '.meta-author', '.contributor', '.by', '.opinion-author', '.author-block', '.author-wrapper', '.news-author', '.header-byline',
          '.byline-name', '.post-byline', '.metadata__byline', '.author-box', '.bio-name', '.auth-link', 'ArticleFull_headerFooter__author__pC2tR'
        ];

        const byline = await manualScrapeWithSelectors($, authorSelector);
        console.log('Byline1:', articleData.byline);
        articleData.byline = byline ? byline.trim().replace(/^by\s*/i, '').replace(/\s+/g, ' ').replace(/\n|\t/g, '').split('by').map(name => name.trim()).filter(Boolean).join(', ') : articleData.byline;
        console.log('Byline2:', articleData.byline);
        const repeatedWordsPattern = /\b(\w+)\b\s*\1\b/i; // Check for repeated words
        const excessiveSpacesPattern = /\s{2,}/; // Matches two or more spaces
        if (articleData.domain === 'zerohedge' && !articleData.byline || articleData.byline === "John Smith" ) {
          const bylineFound = await scrapeZeroHedgeByline($);
          articleData.byline = bylineFound
       }
        if (!articleData.byline || articleData.byline === null || repeatedWordsPattern.test(byline) || excessiveSpacesPattern.test(byline)) {
          const bylineFound = await identifyAuthorNameFromContent(articleData.content);
          articleData.byline = bylineFound
        }
        sendUpdate('byline', { byline: articleData.byline });
        // res.write(`event: byline\n`);
        // res.write(`data: ${JSON.stringify({ byline: articleData.byline })}\n\n`); // Send only the byline
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
      const script = replaceAcronyms(summary);
      // **create audio of summary**
      const audioFileName = generateAudioFileName(url);
      const filePath = path.join(audioDirectory, audioFileName);
      // Check if the file already exists
      // if (fs.existsSync(filePath)) {
        // If the file already exists, return the URL
        // articleData.summaryTTS = `/api/generate/media?id=${audioFileName}`;
        // articleData.summaryTTSid = audioFileName; 
      // } else {
      // const response = await axios.post('http://localhost:8082/synthesize', 
      // const response = await axios.post('http://speech-synthesizer:8082/synthesize', 
      //   { text: script, model_name, vocoder_name: 'vocoder_name' }, 
      //   { responseType: 'arraybuffer' });

      const response = await axios
        .post
        (
          `${backendURL}/api/generate/speech`,
          { text: script }
        );
        // { responseType: 'arraybuffer' });
      console.log('saving Synthesized speech', response.data);
      // summaryTTS = response.data.url;
      format = response.data.format;
      articleData.summaryTTS = response.data.url;
      console.log('Synthesized speech:', articleData.summaryTTS, format);
      // Save the audio file locally
      // fs.writeFileSync(filePath, Buffer.from(response.data, 'binary'));
      // Return the URL for the stored file
      sendUpdate('synthesizedSpeech', { url: articleData.summaryTTS });
      // res.write(`event: synthesizedSpeech\n`);
      // res.write(`data: ${url}\n\n`);
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
      let article = await publishArticleAndAttachedMedia(articleData, $, articleData.url,html, res);
      let articleTxid = article.transactionId;
      let articleDidTx = article.didTx;
      // this is the audio url
      let didTxRefs = article.didTxRefs;
      let subRecords = article.subRecords;
      let subRecordTypes = article.subRecordTypes;

      // Define placeholders for each type of record
      let articleUrlRecord = null;
      let audioUrlRecord = null;
      let articleDidTxRef = null;
      let audioDidTxRef = null;
      let urlInRecord = null;
      let imageRecord = null;
      let imageDidTxRef = null;
      let textRecord = null;
      let textDidTxRef = null;

      let currentblock = await getCurrentBlockHeight();
      if (currentblock === null) {
        currentblock = await getCurrentBlockHeight();
        if (currentblock === null) {
          currentblock = latestArweaveBlockInDB;
        }
      }
      console.log('SUPER IMPORTANT currentblock:', currentblock);
      
      const jwk = JSON.parse(fs.readFileSync(process.env.WALLET_FILE)); 
      const myPublicKey = jwk.n;
      const myAddress = base64url(crypto.createHash('sha256').update(Buffer.from(myPublicKey, 'base64')).digest()); 
      const creatorDid = `did:arweave:${myAddress}`;
      const creatorInfo = await searchCreatorByAddress(creatorDid)
      // console.log('creatorData:', creatorData);


      const creator = {
        creatorHandle: creatorInfo.data.creatorHandle,
        didAddress: creatorInfo.data.didAddress,
        didTx: creatorInfo.data.didTx,
        publicKey: creatorInfo.data.publicKey
      }
        // "creatorHandle": "scribe1",
        // "didAddress": "did:arweave:iZq_A50yy5YpHNZZfQ5E5Xres3fhMa-buPOlotxbEtU",
        // "didTx": "did:arweave:B-2sMjXybRI-gGbKUyu-KEBHT7HfgD0hZKmso0nZmds",
        // "publicKey": "g80XM1oE_GZVzpq6yTRVX0sCj1xisWhBAA31ANiqAl9-r6_5VMOT5SiX5ujLIh1GtLefb_BtNECoTSRbosndWrhypPFzEZutT6ttBi6lPrrDJGFYdAxE8Rucfw7aZyzfMNYQfEZC-vK6Wkw4HiVllwwp2ZG--XplJyYlKSQIDt78DmLUnkRIA0c0HhPC4pct3G0lHFz7-7ychn9HYNOmEYBsaIrqX4XIE1GGOzPieyAa5DiOkWqTDBwFVglRZ1bE4VSEl-TdEpizUC8SOuAsVvjiHIXkrCP3ugkZj2mpi3VaDN6T9GhI9BtP6duXa7fU5GUbYTkArxYU9bGCpvJKVE3hoeWAq-5coaG3tV5q_vXfGcVcwbm2tz1q292kpXnQ91HIBVzaOlJgEhC-f4UvHy_4dNvYlBc8wvdUFktkPK8tpQ17a3wNSN6_qRZemvbVobLXguSqWE9jxx4F3oXSoGoYQYL_UomWnIsNRr5Gre8fwrBOc8ZTl3wdKbqDV6SlSYq0q3y41KW2V6KI_csTXyE6boTWRIoFxGBG7Z1N8Fd3_GtdFKmevEkfNnlYYAM7pcMRfD-oz8ZMXHXwD86yed-b0kh6p4yqPnYpR_NyKsURlloVvpxBwOzZqIU9d_rsmsMZDY2ZIIowSYkqkjW7ug0597_LkCpA-eyyLaijbxE"
    // }
      
      const records = getRecords({ resolveDepth: 0 });
      
    // console.log('subRecords:', subRecords, 'subRecordTypes', subRecordTypes);
      subRecords.forEach(async (record, index) => {
        let didTxRef = didTxRefs[index]; // Get the corresponding didTxRef
        recordType = subRecordTypes[index]; // Get the corresponding record type
        // console.log('1184 record:', index, {recordType}, record);
          if (record.associatedUrlOnWeb !== undefined && record.associatedUrlOnWeb.url !== undefined) {
            urlInRecord = record.associatedUrlOnWeb.url
            // console.log('1187 record:', urlInRecord, {recordType}, record);
          } else if (record.basic && record.basic.urlItems !== undefined && record.basic.urlItems[0] !== undefined) {
            // console.log('1176 record:', {recordType}, record.basic.urlItems);
            urlInRecord = record.basic.urlItems[0].associatedUrlOnWeb.url;
          } else if (record.audio !== undefined && record.audio.webUrl !== undefined) {
            urlInRecord = record.audio.webUrl;
          }
            if (recordType === 'audio') {
              audioUrlRecord = audioUrlRecord || { oip: {} };
              audioUrlRecord.data = { ...record };
              audioUrlRecord.oip.didTx = didTxRef;
              // audioUrlRecord.data = audioUrlRecord.data || '';
              // audioUrlRecord.data.push(record);
              audioDidTxRef = didTxRefs[index];
              audioUrlRecord.oip.indexedAt = new Date().toISOString();
              audioUrlRecord.oip.recordType = 'audio';
              audioUrlRecord.oip.inArweaveBlock = currentblock;
              audioUrlRecord.oip.recordStatus = 'pending confirmation in Arweave';
              audioUrlRecord.oip.creator = creator;
              console.log('30 indexRecord audioUrlRecord:', audioUrlRecord, audioDidTxRef);
              // console.log('audioDidTxRef:', audioDidTxRef);

              indexRecord(audioUrlRecord);
            } else if (recordType === 'image') {
              console.log('Image record found:', imageRecord);
              imageRecord = imageRecord || { oip: {} };
              imageRecord.data = { ...record };
              imageRecord.oip.didTx = didTxRef;
              // imageRecord.data = imageRecord.data || [];
              // imageRecord.data.push(record);
              imageDidTxRef = didTxRefs[index];
              imageRecord.oip.indexedAt = new Date().toISOString();
              imageRecord.oip.recordType = 'image';
              imageRecord.oip.inArweaveBlock = currentblock;
              imageRecord.oip.recordStatus = 'pending confirmation in Arweave';
              imageRecord.oip.creator = creator;
              console.log('30 indexRecord imageRecord:', imageRecord, imageDidTxRef);
              // console.log('imageDidTxRef:', imageDidTxRef);
              indexRecord(imageRecord);
            
            } else if (recordType === 'text') {
              textRecord = textRecord || { oip: {} };
              textRecord.data = { ...record };
              textRecord.oip.didTx = didTxRef;
              // textRecord.data = textRecord.data || [];
              // textRecord.data.push(record);
              textDidTxRef = didTxRefs[index];
              textRecord.oip.indexedAt = new Date().toISOString();
              textRecord.oip.recordType = 'text';
              textRecord.oip.inArweaveBlock = currentblock;
              textRecord.oip.recordStatus = 'pending confirmation in Arweave';
              textRecord.oip.creator = creator;
              console.log('30 indexRecord textRecord:', textRecord, textDidTxRef);
              // console.log('textDidTxRef:', textDidTxRef);
              indexRecord(textRecord);
            }
      });

      // res.write(`event: archived\n`);
      // res.write(`data: ${JSON.stringify({ archived: articleDidTx })}\n\n`);
      // articleData.url = String(url);
      let record = {
        "data": 
          {
            "basic": {
              "name": articleData.title,
              "language": "en",
              "date": articleData.publishDate,
              "description": articleData.description,
              // "urlItems": [
                //   articleDidTxRef
                // ],
                "nsfw": false,
                "tagItems": articleData.tags || []
              },
              "post": {
                "bylineWriter": articleData.byline,
                // "audioItems": [
                //   audioDidTxRef
                // ],
                // "articleText": textDidTxRef
                // ,
                "webUrl": cleanUrl(articleData.url)
                // "featuredImage": [
                  //   imageDidTxRef
                  // ]
                },
                // "associatedUrlOnWeb": {
                //   "url": cleanUrl(articleData.url)
                // }
            },
          "oip": {
            "didTx": articleDidTx,
            "inArweaveBlock": currentblock,
            "recordType": "post",
            "indexedAt": new Date().toISOString(),
            "recordStatus": "pending confirmation in Arweave",
            "creator": {...creator}
            // "indexedAt": new Date().toISOString(),
            }
            };
            if (imageRecord && imageDidTxRef) {
              record.data.post.featuredImage = imageDidTxRef;
            }
            if (textRecord && textDidTxRef) {
              record.data.post.articleText = textDidTxRef;
            }
            if (audioUrlRecord && audioDidTxRef) {
              record.data.post.audioItems = [audioDidTxRef];
            }
            
            console.log('40 indexRecord pending record to index:', record);
            
            // indexRecord(record);
            console.log('article archived successfully at didTx', articleDidTx);
            sendUpdate('archived', { archived: articleDidTx });
      res.end();
      ongoingScrapes.delete(scrapeId); // Clear completed scrape

    }
  } catch (error) {
    console.error('Error fetching parsed article data:', error);
    sendUpdate('error', { message: 'Failed to fetch article data.' });
    // res.write(`event: error\n`);
    // res.write(`data: ${JSON.stringify({ error: 'Failed to fetch article data.' })}\n\n`);
    res.end();
    ongoingScrapes.delete(scrapeId);

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

async function createNewNutritionalInfoRecord(ingredientName) {
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

    console.log(`Successfully retrieved nutritional info for ${ingredientName}:`, formattedNutritionalInfo);

    return formattedNutritionalInfo;
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

async function fetchParsedRecipeData(url, html, scrapeId, screenshotBase64, screenshots, totalHeight, res) {
  try {
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
    console.log('Metadata:', metadata);
    const html = response.data.data.html;
    const $ = cheerio.load(html);  

    console.log('Scraping recipe data from URL:', url);

    // Parse title, description, and metadata
    const title = $('h1.entry-title').text().trim() || $('h1.recipe-title').text().trim() || null;
    const description = $('p').first().text().trim() || null;
    const imageUrl = $('img.wp-image').first().attr('src') || null;
    const date = Date.now() / 1000;

    const ingredientSections = [];
    $('.wprm-recipe-ingredient-group').each((i, section) => {
        const sectionName = $(section).find('.wprm-recipe-group-name').text().trim() || `Section ${i + 1}`;
        const ingredients = [];

        $(section)
            .find('.wprm-recipe-ingredient')
            .each((j, elem) => {
                const amount = $(elem).find('.wprm-recipe-ingredient-amount').text().trim() || null;
                const unit = $(elem).find('.wprm-recipe-ingredient-unit').text().trim() || null;
                const name = $(elem).find('.wprm-recipe-ingredient-name').text().trim() || null;

                if (amount || unit || name) {
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

    console.log('Ingredient sections count:', ingredientSections.length, ingredientSections);

    // if there are more than one ingredient sections, identify the primary one - the one with the most ingredients
    let primaryIngredientSection = ingredientSections[0];
    if (ingredientSections.length > 1) {
        primaryIngredientSection = ingredientSections.reduce((prev, current) => {
            return prev.ingredients.length > current.ingredients.length ? prev : current;
        });
    }
    console.log('Primary ingredient section:', primaryIngredientSection);
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

  const ingredientNames = primaryIngredientSection.ingredients.map(ing => ing.name);
  const ingredientAmounts = primaryIngredientSection.ingredients.map(ing => ing.amount ?? 1);
  const ingredientUnits = primaryIngredientSection.ingredients.map(ing => ing.unit);

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
    const ingredientNames = primaryIngredientSection.ingredients.map(ing => ing.name.toLowerCase());

    // Query for all ingredients in one API call
    const queryParams = {
        recordType: 'nutritionalInfo',
        search: ingredientNames.join(','),
        limit: 50
    };

    const searchResults = await getRecords(queryParams);

    // Populate the global recordMap
    recordMap = {};  // Reset before populating
    searchResults.records.forEach(record => {
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

  
// Function to find the best match
function findBestMatch(ingredientName) {
  if (!recordMap || Object.keys(recordMap).length === 0) {
      console.error("Error: recordMap is not populated before calling findBestMatch().");
      return null;
  }

  const normalizedIngredientName = ingredientName.trim().toLowerCase();
  const searchTerms = normalizedIngredientName.split(/\s+/).filter(Boolean);

  console.log(`Searching for ingredient: ${normalizedIngredientName}, Search terms:`, searchTerms);

  // Check if the ingredient has a predefined synonym
  const synonym = synonymMap[normalizedIngredientName];
  if (synonym && recordMap[synonym]) {
      console.log(`Found synonym match for ${normalizedIngredientName}: ${synonym}`);
      return recordMap[synonym];
  }

  // Direct match
  if (recordMap[normalizedIngredientName]) {
      console.log(`Direct match found for ${normalizedIngredientName}, nutritionalInfo:`, recordMap[normalizedIngredientName].data.nutritionalInfo);
      return recordMap[normalizedIngredientName];
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

      console.log(`Loose matches found for ${normalizedIngredientName}:`, matches);
      return matches[0];
  }

  console.log(`No match found for ${normalizedIngredientName}`);
  return null;
}

  const ingredientRecords = await fetchIngredientRecordData(primaryIngredientSection);
  console.log('Ingredient records:', ingredientRecords);

  let missingIngredientNames = Object.keys(ingredientRecords.ingredientDidRefs).filter(
    name => ingredientRecords.ingredientDidRefs[name] === null
  );

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
    missingIngredientNames.map(name => createNewNutritionalInfoRecord(name))
  );
  
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
    const prepTime = prepTimeMatch ? parseInt(prepTimeMatch[1], 10) : null;

    const cookTimeMatch = $('.wprm-recipe-cook_time').text().trim().match(/(\d+)\s*mins?/i);
    const cookTime = cookTimeMatch ? parseInt(cookTimeMatch[1], 10) : null;

    const totalTimeMatch = $('.wprm-recipe-total_time').text().trim().match(/(\d+)\s*mins?/i);
    const totalTime = totalTimeMatch ? parseInt(totalTimeMatch[1], 10) : null;

    const servingsStr = $('#wprm-recipe-container-10480').attr('data-servings');
    const servings = servingsStr ? parseInt(servingsStr, 10) : null;

    const cuisine = $('.tmd-meta_single:contains("Cuisine")')
    .next()
    .text()
    .trim() || null;
  const course = $('.tmd-meta_single:contains("Course")')
    .next()
    .text()
    .trim() || null;


    // Extract notes
    const notes = $('.wprm-recipe-notes').text().trim() || null;


    // Extract description
    // const description = $('p').first().text().trim() || null;

    // Extract image
    // const image = $('.wp-block-image img').attr('src') || null;




    console.log('Missing Ingredients:', missingIngredientNames);
    console.log('Nutritional Info Array:', nutritionalInfoArray);
 
    console.log('Original Ingredient Names:', ingredientNames);
console.log('Units Before Assignment:', ingredientUnits);
console.log('Amounts Before Assignment:', ingredientAmounts);




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


console.log('Units After Assignment:', ingredientUnits);
console.log('Amounts After Assignment:', ingredientAmounts);
    
    // Assign to recipeData
    const recipeData = {
      title: metadata.ogTitle || metadata.title || null,
      date: metadata.publishedTime || null,
      author: metadata.author || null,
      image: metadata.ogImage || null,
      ingredients: {
        amounts: ingredientAmounts.length ? ingredientAmounts : null,
        units: ingredientUnits.length ? ingredientUnits : null,
        names: ingredientNames.length ? ingredientNames : null
      },
      instructions: instructions.length ? instructions : null,
      servings,
      prepTime,
      cookTime,
      totalTime,
      notes,
      description,
      url: url || null
    };

    console.log('Recipe data:', recipeData);

    ongoingScrapes.delete(scrapeId); // Clear completed scrape
  } catch (error) {
    console.error('Error fetching parsed recipe data:', error);

    ongoingScrapes.delete(scrapeId);
  }
}

async function fetchTweetDetails(embeddedTweets) {
  const twitterBearerToken = process.env.TWITTER_BEARER_TOKEN;

  if (embeddedTweets.length === 0) {
    console.log('No valid tweet IDs found.');
    return [];
  }

  console.log('Tweet IDs:', embeddedTweets);

  try {
    const response = await axios.get(`https://api.twitter.com/2/tweets`, {
      headers: {
        'Authorization': `Bearer ${twitterBearerToken}`,
      },
      params: {
        ids: embeddedTweets.join(','),  // Join the tweet IDs into a comma-separated list
        'tweet.fields': 'attachments,created_at,author_id',
        'expansions': 'attachments.media_keys',
        'media.fields': 'url,preview_image_url,type'
      }
    });

    // Process and return the tweet details, including media
    return response.data;
  } catch (error) {
    console.error('Error fetching tweet details:', error.response ? error.response.data : error.message);
    return [];
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

// router.post('/article/stream', authenticateToken, async (req, res) => {
// router.post('/article/stream', async (req, res) => {
//   const { html, url, userId, screenshotBase64, screenshots, totalHeight } = req.body; // Extract HTML and URL from request body
//   // const userId = req.user.userId; // Extract userId from the decoded token
  
//   if (!html || !url || !userId) {
//     return res.status(400).json({ error: 'HTML, URL, and User ID are required' });
//   }
  
//   console.log('User ID:', userId);
//   console.log('Received scraping request...', req.body.url);
//   console.log('Total screenshots received:', screenshots?.length);
//   // Generate a unique identifier for this scrape request
//   const scrapeId = generateScrapeId(url, userId);
//   console.log('Scrape ID:', scrapeId);
//   // Set SSE headers for streaming data
//   if (!ongoingScrapes.has(scrapeId)) {
//     res.setHeader('Content-Type', 'text/event-stream');
//     res.setHeader('Cache-Control', 'no-cache');
//     res.setHeader('Connection', 'keep-alive');
//   }
//   res.flushHeaders(); // Flush headers to establish the SSE connection

//   // Keep the connection alive by sending periodic "ping" events
//   const keepAliveInterval = setInterval(() => {
//     res.write(`event: ping\n`);
//     res.write(`data: "Keep connection alive"\n\n`);
//   }, 15000); // Every 15 seconds

//   try {
//     // Start scraping and stream data back piece by piece
//     await fetchParsedArticleData(url, html, scrapeId, screenshotBase64, screenshots, totalHeight, res);
//   } catch (error) {
//     console.error('Error processing scraping:', error);
//     res.write(`event: error\n`);
//     res.write(`data: ${JSON.stringify({ error: 'Failed to scrape article.' })}\n\n`);
//     res.end(); // End the stream in case of an error
//   }

//   // When the client disconnects
//   req.on('close', () => {
//     console.log('Client disconnected from stream.');
//     clearInterval(keepAliveInterval); // Clear the keep-alive interval
//     res.end(); // Close the SSE connection
//   });
// });

router.post('/article', async (req, res) => {
  const { html, url, userId, screenshotBase64, screenshots, totalHeight } = req.body;

  if (!html || !url || !userId) {
    return res.status(400).json({ error: 'HTML, URL, and User ID are required' });
  }

  const scrapeId = generateScrapeId(url, userId);
  console.log('Scrape ID:', scrapeId);

  // Respond immediately with the scrapeId
  res.status(200).json({ scrapeId });

  // Initialize the stream if not already present
  if (!ongoingScrapes.has(scrapeId)) {
    ongoingScrapes.set(scrapeId, { clients: [], data: [] });
  }

  try {
    // Begin fetching and storing the results to stream later
    const streamUpdates = (event, data) => {
      const streamData = ongoingScrapes.get(scrapeId);
      if (streamData) {
          streamData.data.push({ event, data });
          streamData.clients.forEach(client => {
              if (typeof client.write === 'function') {
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
      { sendUpdate: streamUpdates, res }
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
      ongoingScrapes.delete(scrapeId); // Clean up
    }
  }
});

router.post('/recipe', async (req, res) => {
  const { html, url, userId, screenshotBase64, screenshots, totalHeight } = req.body;

  if (!url || !userId) {
    return res.status(400).json({ error: 'URL and User ID are required' });
  }

  const scrapeId = generateScrapeId(url, userId);
  console.log('Scrape ID:', scrapeId);

  // Respond immediately with the scrapeId
  res.status(200).json({ scrapeId });

  // Initialize the stream if not already present
  if (!ongoingScrapes.has(scrapeId)) {
    ongoingScrapes.set(scrapeId, { clients: [], data: [] });
  }

  try {
    // Begin fetching and storing the results to stream later
    const streamUpdates = (event, data) => {
      const streamData = ongoingScrapes.get(scrapeId);
      if (streamData) {
          streamData.data.push({ event, data });
          streamData.clients.forEach(client => {
              if (typeof client.write === 'function') {
                  client.write(`event: ${event}\n`);
                  client.write(`data: ${JSON.stringify({ type: event, data })}\n\n`);
                  client.flush && client.flush();
                  console.log('Sent event:', event, data);
              } else {
                  console.warn('client.write is not a function');
              }
          }
          );
      }
  }

    // Fetch recipe data and stream updates
    await fetchParsedRecipeData(
      url, 
      html,
      scrapeId, 
      screenshotBase64, 
      screenshots, 
      totalHeight, 
      { sendUpdate: streamUpdates, res }
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
      ongoingScrapes.delete(scrapeId); // Clean up
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

module.exports = router;