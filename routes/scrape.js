const express = require('express');
const { getRecords } = require('../helpers/elasticsearch');
// const puppeteer = require('puppeteer-extra');
// const StealthPlugin = require('puppeteer-extra-plugin-stealth');
// puppeteer.use(StealthPlugin());
const Parser = require('@postlight/parser');
const router = express.Router();
const { exec } = require('child_process');
const path = require('path');
const cheerio = require('cheerio');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');  // For generating a unique hash
// const path = require('path');
const progress = require('progress-stream');
const {publishVideoFiles, publishArticleText, publishImage} = require('../helpers/templateHelper');
const {generateSummaryFromContent, generateTagsFromContent, generateCombinedSummaryFromArticles} = require('../helpers/generators');
const ProgressBar = require('progress');
// const { video_basic_info } = require('play-dl');
const { timeout } = require('../config/arweave.config');
const sharp = require('sharp');
require('dotenv').config();

// Create a directory to store the audio files if it doesn't exist
const audioDirectory = path.join(__dirname, '../media');
if (!fs.existsSync(audioDirectory)) {
    fs.mkdirSync(audioDirectory);
}

// Utility function to create a unique hash based on the URL or text
function generateAudioFileName(text) {
  return crypto.createHash('sha256').update(text).digest('hex') + '.wav';
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

async function downloadTextFile(content) {
  const outputPath = path.resolve(__dirname, `../downloads/text_file.txt`);
  // console.log('Downloading text file to:', outputPath);
  try {
    fs.writeFileSync(outputPath, content);
    return outputPath;
  } catch (error) {
    console.error('Error downloading text file:', error);
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
    const mediaDir = path.resolve(__dirname, `../downloads/${id}`);
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
    const videoDir = path.resolve(__dirname, `../downloads/${id}`);
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
async function getTwitterMediaUrls(tweetUrls) {
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

async function publishArticleAndAttachedMedia(articleData, $, url, html, res) {

    
  // Initialize an array to hold YouTube URLs
  let youtubeUrls = [];

  // Direct YouTube URL search (in the content)
  youtubeUrls = [...articleData.content.matchAll(/(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+)/g)].map(match => match[0]);

  // Ensure the downloads directory exists
  const downloadsDir = path.resolve(__dirname, '../downloads');
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

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

  outputPath = await downloadTextFile(articleData.content);
  articleTextAddresses = await publishArticleText(outputPath, null, null, null, false);
  console.log('articleTextBittorrentAddress', articleTextAddresses.torrent.magnetURI);
  articleTextBittorrentAddress = articleTextAddresses.torrent.magnetURI;

  if (articleData.embeddedImage) {
    const imageUrl = articleData.embeddedImage;
    console.log('imageUrl', imageUrl);

    // Extract the filename and file type from the URL
    const parsedPath = path.parse(new URL(imageUrl).pathname);
    const fileName = parsedPath.base;
    const fileType = parsedPath.ext;

    // Use the extracted filename in the imagePath
    const imagePath = path.join(downloadsDir, fileName);
    await downloadFile(imageUrl, imagePath);
    torrent = await publishImage(imagePath, null, null, null, false);
    imageBittorrentAddress = torrent.magnetURI;
    console.log('imageBittorrentAddress', imageBittorrentAddress);
    imageFileType = mimeTypes[fileType.toLowerCase()] || 'application/octet-stream';

    // Get image dimensions and file size using 'sharp'
    const imageStats = fs.statSync(imagePath);
    imageSize = imageStats.size;

    const imageMetadata = await sharp(imagePath).metadata();
    imageWidth = imageMetadata.width;
    imageHeight = imageMetadata.height;

    console.log('Image dimensions:', imageWidth, imageHeight);
    console.log('Image size:', imageSize);
  }


  // Fetch and download Twitter videos
  let embeddedTweets = await getEmbeddedTweets(html);
  let tweetDetails = null;
  const tweetVideoTorrent = [];
  const tweetRecords = [];
  const tweetVideoRecords = [];
  const youtubeVideoTorrent = [];
  let videoRecords = [];
  
  if (embeddedTweets.length > 0) {
    tweetDetails = await fetchTweetDetails(embeddedTweets);
    console.log('Tweet details:', tweetDetails);

    if (tweetDetails && tweetDetails.includes && tweetDetails.includes.media) {
      let tweetMediaUrls = await getTwitterMediaUrls(embeddedTweets);
      await Promise.all(embeddedTweets.map(async (tweet, index) => {
        const tweetId = tweet.match(/status\/(\d+)/)[1]; // Extract tweet ID
        const mediaUrl = tweetMediaUrls[index];
    
        if (mediaUrl) {
          outputPath = await downloadMedia(mediaUrl, tweetId); // Pass media URL and tweet ID
          mediaFiles = await publishMediaFiles(outputPath, tweetId, false);
          tweetMediaRecords[index] = {
            "media": {
              "bittorrentAddress": mediaFiles.torrentAddress
            }
          };
          tweetMediaTorrent.push(mediaFiles.torrentAddress);
        } else {
          tweetMediaRecords[index] = null; // No media for this tweet
        }
      }));
    }
  
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
    



  if (tweetVideoTorrent.length > 0) {
    console.log('Twitter video torrents:', tweetVideoTorrent);
    res.write(`event: tweets\n`);
    res.write(`data: ${JSON.stringify(tweetVideoTorrent)}\n\n`);
  }

  // Scrape YouTube iframes using Cheerio
  const youtubeIframeUrls = [];

  $('iframe[src*="youtube.com"]').each((i, elem) => {
    const iframeSrc = $(elem).attr('src');
    if (iframeSrc) {
      youtubeIframeUrls.push(iframeSrc);
    }
  });

  // Also look for YouTube videos embedded in iframes
  if (youtubeIframeUrls.length > 0) {
    youtubeIframeUrls.forEach(iframeSrc => {
      const youtubeUrlMatch = iframeSrc.match(/(https?:\/\/(?:www\.)?(?:youtube\.com\/embed\/)[\w-]+)/);
      if (youtubeUrlMatch) {
        const videoUrl = youtubeUrlMatch[0].replace("/embed/", "/watch?v=");
        youtubeUrls.push(videoUrl);
      }
    });
  }

  // Direct YouTube URL search (in the content)
  const youtubeUrlMatches = [...html.matchAll(/(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+)/g)];
  youtubeUrlMatches.forEach(match => youtubeUrls.push(match[0]));

  // Remove duplicates
  youtubeUrls = [...new Set(youtubeUrls)];

  for (const videoUrl of youtubeUrls) {
    const videoId = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)[1]; // Extract YouTube video ID
    const metadata = await getYouTubeMetadata(videoUrl);

    videoOutputPath = path.join(downloadsDir, `${videoId}/${videoId}.mp4`);

    // videoMetadata.push(metadata);
    await downloadVideo(videoUrl, videoId); // Pass video URL and YouTube video ID

    // Assuming metadata.automatic_captions.en is your array
    const captions = metadata.automatic_captions.en;
    let vttUrl;
    if (captions) {
    // Find the URL for the caption with the 'vtt' extension
    const vttCaption = captions.find(caption => caption.ext === 'vtt');

    if (vttCaption) {
      vttUrl = vttCaption.url;
      console.log('VTT Caption URL:', vttUrl);
    } else {
      console.log('No VTT captions found.');
    }
    
    await downloadFile(vttUrl, path.join(downloadsDir, `${videoId}/${videoId}.vtt`));
    transcriptOutputPath = path.join(downloadsDir, `${videoId}/${videoId}.vtt`)
    console.log('Transcript downloaded to:', transcriptOutputPath);
    transriptAddresses = await publishArticleText(transcriptOutputPath, null, null, null, false);
    console.log('transcriptBittorrentAddress', transriptAddresses.torrent.magnetURI);
    transcriptBittorrentAddress = transriptAddresses.torrent.magnetURI;
    }
    
    const videoFiles = await publishVideoFiles(videoOutputPath, videoId, false);
    let fileType = path.extname(videoOutputPath);
    let videoFileType = mimeTypes[fileType.toLowerCase()] || 'application/octet-stream';
    let fileName = `${videoId}.mp4`
    youtubeVideoTorrent.push(videoFiles.torrentAddress);

    videoRecordData = {
      "basic": {
        "name": metadata.title,
        "language": "en",
        "date": metadata.timestamp,
        "description": metadata.description,
        "urlItems": [
      {
        "associatedUrlOnWeb": {
          "url": videoUrl
        }
      }
        ],
        "nsfw": false,
        "tagItems": [...(metadata.tags || []), ...(metadata.categories || [])]
      },
      "video": {
        "arweaveAddress": "",
        "ipfsAddress": "",
        "bittorrentAddress": youtubeVideoTorrent,
        "filename": fileName,
        "size": metadata.filesize || 0,
        "width": metadata.width,
        "height": metadata.height,
        "duration": metadata.duration,
        "contentType": videoFileType
      },
      "text": {
        "bittorrentAddress": transcriptBittorrentAddress,
        "contentType": "text/text"
      }
        
    };
    videoRecords.push(videoRecordData);

  
  }

  if (youtubeUrls.length > 0) {
    console.log('YouTube video URLs:', youtubeUrls);
    console.log('YouTube video torrents:', youtubeVideoTorrent);
    res.write(`event: youtube\n`);
    res.write(`data: ${JSON.stringify(youtubeVideoTorrent)}\n\n`);
  }
  
  // console.log('Final article data:', articleData);
  res.write(`event: finalData\n`);
  res.write(`data: ${JSON.stringify(articleData)}\n\n`);

  res.end();

  const recordToPublish = {
    "basic": {
      "name": articleData.title,
      "language": "en",
      "date": articleData.publishDate,
      "description": articleData.description,
      "urlItems": [
        {
          "associatedUrlOnWeb": {
            "url": articleData.url
          }
        }
      ],
      "nsfw": false,
      "tagItems": articleData.tags || []
    },
    "post": {
      "bylineWriter": articleData.byline,
      "articleText": {
      "text": {
        "bittorrentAddress": articleTextBittorrentAddress,
        "contentType": "text/text"
      }
      }
    }
    };
    if (youtubeVideoTorrent.length > 0) {
      recordToPublish.post.videoItems = [...videoRecords];
    }
    if (imageBittorrentAddress) {
      recordToPublish.post.featuredImage = [{
      "basic": {
        "name": articleData.title,
        "language": "en",
        "nsfw": false,
        "urlItems": [
        {
          "associatedUrlOnWeb": {
          "url": articleData.embeddedImage
          }
        }
        ]
      },
      "image": {
        "bittorrentAddress": imageBittorrentAddress,
        "height": imageHeight,
        "width": imageWidth,
        "size": imageSize,
        "contentType": imageFileType
      }
      }];
    }
    if (tweetRecords.length > 0) {
      recordToPublish.post.citations = [...tweetRecords];
    }

    console.log('recordToPublish 123', recordToPublish, recordToPublish.basic.urlItems, recordToPublish.post.featuredImage, recordToPublish.post.videoItems, recordToPublish.post.citations);
  
    const apiEndpoint = "http://localhost:3005/api/records/newRecord?recordType=post";  // Update your API URL here
    fetch(apiEndpoint, {
      method: "POST",
      headers: {
          "Content-Type": "application/json"
      },
      body: JSON.stringify(recordToPublish)
  })
  .then(response => response.json())
  .then(data => {
      console.log("Record published:", data);
  })
  .catch(error => {
      console.error("Error publishing record:", error);
  });
}

async function fetchParsedArticleData(url, html, res) {
  console.log('Fetching parsed article data from', url);

  try {
    // Attempt to retrieve existing records based on the URL
    const queryParams = { resolveDepth: 2, url };
    const records = await getRecords(queryParams);
    console.log('Records:', records);

    if (records.length > 0) {
      const didTxRef = records[0].oip.didTx;
      const refQueryParams = { 
        recordType: "post", 
        didTxRef: didTxRef
       };
      const references = await getRecords(refQueryParams);

      const domain = (new URL(url)).hostname.split('.').slice(-2, -1)[0];
      let articleData = {
        title: references[0].data[0].basic.name || null,
        byline: references[0].data[1].post.bylineWriter || null,
        publishDate: references[0].data[0].basic.date || null,
        description: references[0].data[0].basic.description || null,
        tags: references[0].data[0].basic.tagItems || '',
        content: references[0].data[1].post.articleText.data[0].text || null,
        embeddedImage: references[0].data[1].post.featuredImage.data[1] || [],
        domain: domain || null,
        url: url
      };

      console.log('Article data found in archive:', articleData);

      // Stream the final article data
      res.write(`event: finalData\n`);
      res.write(`data: ${JSON.stringify(articleData)}\n\n`);
      res.end();

    } else {
      // Handle new article scraping if no archived data is found
      console.log('New article, fetching...');
      const data = await Parser.parse(url, { html: html });
      console.log('Parsed data:', data);

      let content = data.content
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .replace(/\s+/g, ' ') // Remove multiple spaces
        .trim() || null;

      let publishDate = data.date_published
        ? Math.floor(new Date(data.date_published.replace(/\s+/g, ' ').trim().replace(/^PUBLISHED:\s*/, '')).getTime() / 1000)
        : null;

      const domain = (new URL(url)).hostname.split('.').slice(-2, -1)[0];

      // Initial parsed article data
      let articleData = {
        title: data.title || null,
        byline: data.author || null,
        publishDate: publishDate || null,
        description: data.excerpt || null,
        content: content || null,
        embeddedImage: data.lead_image_url || null,
        domain: domain || null,
        url: url || null
      };


      // Stream initial article data
      res.write(`event: initialData\n`);
      res.write(`data: ${JSON.stringify(articleData)}\n\n`);
      // res.flush(); // Ensures data is flushed to the client immediately
      console.log('Sent initialData:', articleData);

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
          '.author', '.author-name', '.byline', '.by-author', '.byline__name', '.post-author', '.auth-name', '.ArticleFull_headerFooter__author',
          '.entry-author', '.post-author-name', '.post-meta-author', '.article__author', '.author-link', '.article__byline', '.content-author',
          '.meta-author', '.contributor', '.by', '.opinion-author', '.author-block', '.author-wrapper', '.news-author', '.header-byline',
          '.byline-name', '.post-byline', '.metadata__byline', '.author-box', '.bio-name', '.auth-link', 'ArticleFull_headerFooter__author__pC2tR'
        ];
        const byline = await manualScrapeWithSelectors($, authorSelector);
        articleData.byline = byline ? byline.trim().replace(/^by\s*/i, '').replace(/\s+/g, ' ').replace(/\n|\t/g, '').split('by').map(name => name.trim()).filter(Boolean).join(', ') : articleData.byline;
        console.log('Byline:', articleData.byline);
        res.write(`event: byline\n`);
        res.write(`data: ${JSON.stringify({ byline: articleData.byline })}\n\n`); // Send only the byline
      }

      // **PUBLISH DATE**
      if (!articleData.publishDate) {
        const dateSelector = [
          '.ArticleFull_headerFooter__date__UFCbS', 'time', '.publish-date', '.post-date', '.entry-date', '.article-date',
          '.published-date', '.t-txt', '.t-txt\\:sm', '.t-txt\\:u', '.t-display\\:inline-block'
        ];
        const publishDate = await manualScrapeWithSelectors($, dateSelector);
        console.log('Publish Date after manual scrape:', publishDate);
        articleData.publishDate = 
            Math.floor(new Date(
          publishDate.replace(/\s+/g, ' ').trim().replace(/^Published:\s*/i, '').split('|')[0].trim().split(' - ')[0].trim()
            ).getTime() / 1000)

        console.log('Publish Date:', articleData.publishDate);
        res.write(`event: publishDate\n`);
        res.write(`data: ${JSON.stringify({ publishDate: articleData.publishDate })}\n\n`); // Send only the publish date
      }

      // **CONTENT**
      if (!articleData.content) {
        const textSelector = [
          '.article-content', '.entry-content', '.post-content', '.content', '.article-body', '.article-text', '.article-content',
          '.article-body', '.article-text', '.article-copy', '.article-content', '.article-main', '.article-contents', '.article-content-body'
        ];
        const content = await manualScrapeWithSelectors($, textSelector);
        articleData.content = content ? content.trim() : articleData.content;
        console.log('Content:', articleData.content);
        res.write(`event: content\n`);
        res.write(`data: ${JSON.stringify({ content: articleData.content })}\n\n`); // Send only the content
      }

      // **TAGS**
      const tags = await generateTagsFromContent(articleData.title, articleData.content);
      articleData.tags = tags;
      console.log('Tags:', tags);
      res.write(`event: tags\n`);
      res.write(`data: ${JSON.stringify({ tags: articleData.tags })}\n\n`); // Send only the tags

      // **SUMMARY**
      const summary = await generateSummaryFromContent(articleData.title, articleData.content);
      console.log('description:', articleData.description);
      articleData.description = `${articleData.description}\n\n${summary}`;
      console.log('description with Summary:', articleData.description);
      res.write(`event: summary\n`);
      res.write(`data: ${JSON.stringify({ description: articleData.description })}\n\n`); // Send only the summary
      // **create audio of summary**
      const audioFileName = generateAudioFileName(url);
      const filePath = path.join(audioDirectory, audioFileName);
      // Check if the file already exists
      if (fs.existsSync(filePath)) {
        // If the file already exists, return the URL
        return res.json({ url: `/api/generate/media?id=${audioFileName}` });
      }
      const model_name = 'tts_models/en/jenny/jenny'
      // const model_name = 'tts_models/en/ljspeech/tacotron2-DDC';
      const response = await axios.post('http://speech-synthesizer:8082/synthesize', 
        { text: summary, model_name, vocoder_name: 'vocoder_name' }, 
        { responseType: 'arraybuffer' });

      console.log('saving Synthesized speech');
      // Save the audio file locally
      fs.writeFileSync(filePath, Buffer.from(response.data, 'binary'));

      // Return the URL for the stored file
      res.write(`event: synthesizedSpeech\n`);
      res.write(`data: /api/generate/media?id=${audioFileName}\n\n`);
        console.log('sending finalData');
      res.write(`event: finalData\n`);
      res.write(`data: ${JSON.stringify(articleData)}\n\n`);
      console.log('Sent finalData:', articleData);
      // article
      didTx = await publishArticleAndAttachedMedia(articleData, $, url,html, res);
      console.log('article archived successfully at didTx', didTx);
      res.end();
    }
  } catch (error) {
    console.error('Error fetching parsed article data:', error);
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ error: 'Failed to fetch article data.' })}\n\n`);
    res.end();
  }
}

async function getEmbeddedTweets(html) {
    // Initialize an empty array for tweet URLs
    let tweetUrls = [];

    // Load the HTML into Cheerio
    const $ = cheerio.load(html);

    console.log('Scraping for embedded tweets...');

    // Try to scrape tweets in blockquotes
    try {
        console.log('Trying to scrape tweets using blockquote.twitter-tweet...');
        const tweetsFromBlockquote = $('blockquote.twitter-tweet').map((i, tweet) => {
            const tweetLink = $(tweet).find('a[href*="twitter.com"]').attr('href');
            return tweetLink ? tweetLink.split('?')[0] : null;  // Remove anything after '?'
        }).get();  // Get array of results
        tweetUrls = tweetUrls.concat(tweetsFromBlockquote);
    } catch (error) {
        console.error('Error scraping tweets in blockquotes:', error);
    }

    // Try to scrape tweets from iframes as a fallback
    try {
        console.log('Trying to scrape tweets using iframes...');
        const tweetsFromIframes = $('iframe[src*="platform.twitter.com"]').map((i, iframe) => {
            const tweetLink = $(iframe).attr('src');
            if (tweetLink) {
                // Extract the tweet URL from the iframe src attribute
                const match = tweetLink.match(/https:\/\/twitter\.com\/[a-zA-Z0-9_]+\/status\/[0-9]+/);
                return match ? match[0] : null;
            }
            return null;
        }).get();  // Get array of results
        tweetUrls = tweetUrls.concat(tweetsFromIframes);
    } catch (error) {
        console.error('Error scraping tweets from iframes:', error);
    }

    // Asynchronous loaded tweets via JavaScript
    try {
        console.log('Trying to scrape async loaded tweets...');
        $('script').each((i, script) => {
            const scriptContent = $(script).html();
            if (scriptContent && scriptContent.includes('twitter.com')) {
                const match = scriptContent.match(/https:\/\/twitter\.com\/[a-zA-Z0-9_]+\/status\/[0-9]+/);
                if (match) {
                    tweetUrls.push(match[0]);
                }
            }
        });
    } catch (error) {
        console.error('Error scraping async loaded tweets from scripts:', error);
    }

    // Remove duplicate URLs
    tweetUrls = [...new Set(tweetUrls)];

    console.log('Found embedded tweets:', tweetUrls);

    return tweetUrls;
}

async function fetchTweetDetails(embeddedTweets) {
  const twitterBearerToken = process.env.TWITTER_BEARER_TOKEN;

  // Extract tweet IDs from URLs
  const tweetIds = embeddedTweets.map(tweetUrl => {
    const tweetIdMatch = tweetUrl.match(/status\/(\d+)/);
    return tweetIdMatch ? tweetIdMatch[1] : null;
  }).filter(Boolean); // Filter out any null or invalid IDs

  if (tweetIds.length === 0) {
    console.log('No valid tweet IDs found.');
    return [];
  }

  console.log('Tweet IDs:', tweetIds);

  try {
    const response = await axios.get(`https://api.twitter.com/2/tweets`, {
      headers: {
        'Authorization': `Bearer ${twitterBearerToken}`,
      },
      params: {
        ids: tweetIds.join(','),  // Join the tweet IDs into a comma-separated list
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

// might be deprecated by helpers/generators
router.post('/articles/summary', async (req, res) => {
  console.log('Generating summary for multiple articles...');
  let { articles } = req.body;

  if (!articles) {
    return res.status(400).json({ error: 'articles are required' });
  }

  try {
    let summary = await generateCombinedSummaryFromArticles(articles);
    res.json({ summary });
  } catch (error) {
    console.error('Error generating summary:', error);
    return res.status(500).json({ error: 'An error occurred while generating the summary.' });
  }
});

router.post('/article/stream', async (req, res) => {
  console.log('Received scraping request...', req.body.url);
  const { html, url } = req.body; // Extract HTML and URL from request body

  if (!html || !url) {
    return res.status(400).json({ error: 'HTML and URL are required' });
  }

  // Set SSE headers for streaming data
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // Flush headers to establish the SSE connection

  // Keep the connection alive by sending periodic "ping" events
  const keepAliveInterval = setInterval(() => {
    res.write(`event: ping\n`);
    res.write(`data: "Keep connection alive"\n\n`);
  }, 15000); // Every 15 seconds

  try {
    // Start scraping and stream data back piece by piece
    await fetchParsedArticleData(url, html, res);
  } catch (error) {
    console.error('Error processing scraping:', error);
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ error: 'Failed to scrape article.' })}\n\n`);
    res.end(); // End the stream in case of an error
  }

  // When the client disconnects
  req.on('close', () => {
    console.log('Client disconnected from stream.');
    clearInterval(keepAliveInterval); // Clear the keep-alive interval
    res.end(); // Close the SSE connection
  });
});


module.exports = router;