const express = require('express');
const { getRecords } = require('../helpers/elasticsearch');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const Parser = require('@postlight/parser');
const router = express.Router();
const { exec } = require('child_process');
const path = require('path');
const cheerio = require('cheerio');
const axios = require('axios');
const fs = require('fs');
const progress = require('progress-stream');
const {publishVideoFiles, publishArticleText, publishImage} = require('../helpers/templateHelper');
const ProgressBar = require('progress');
const { video_basic_info } = require('play-dl');
const { timeout } = require('../config/arweave.config');
const sharp = require('sharp');
require('dotenv').config();

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


async function fetchParsedArticleData(url, res) {
  console.log('Fetching parsed article data from', url);

  // set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();


  try {
    const queryParams = {
      resolveDepth: 2,
      url,
    }
  
    const records = await getRecords(queryParams)
    console.log('records', records);
    if (records.length > 0) {
      // In the archive, use the existing data
      const data = records[0].data;

      const didTxRef = records[0].oip.didTx
      console.log('didTxRef', didTxRef);
      const references = await getRecords("post", null, null, null, 2, null, null, didTxRef);
      console.log('13 references', references[0].data[0].basic.tagItems.join(', '));
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
      console.log('article data:', articleData);
    res.write(`event: finalData\n`);
    res.write(`data: ${JSON.stringify(articleData)}\n\n`);

    res.end();
    } else {
      // Not in the archive, scrape it
    const browser = await puppeteer.launch({ headless: true });
    console.log('Browser launched.');
    const page = await browser.newPage();
    console.log('New page created.');
    // Set a realistic User-Agent to mimic a real browser
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36');
    console.log('User agent set.');
    // Navigate to the URL
    console.log('Loading page...')
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('Page loaded.');
    // Wait for the content to load (adjust selector as needed)
    await page.waitForSelector('body');
    console.log('Page content loaded.');
    // Get the page content
    const html = await page.content();
    console.log('Page content fetched.');
    // Close Puppeteer
    await browser.close();

    // Parse the content using Postlight's Parser
    const data = await Parser.parse(url, {
      html: html
    });
    let content = data.content
      .replace(/<[^>]+>/g, '') // Remove HTML tags
      .replace(/&#x2019;/g, "'") // Replace HTML entities
      .replace(/&#x201C;/g, '“')
      .replace(/&#x201D;/g, '”')
      .replace(/&#xA0;/g, ' ')
      .replace(/\s+/g, ' ') // Replace multiple spaces with a single space
      .trim() || null;
    let publishDate = null;
    if (data.date_published) {
      publishDate = new Date(data.date_published.replace(/\s+/g, ' ').trim().replace(/^PUBLISHED:\s*/, '')).toISOString() || null;
    }
    const domain = (new URL(data.url)).hostname.split('.').slice(-2, -1)[0];
    // console.log('Parsed data:', data);
    let articleData = {
      title: data.title || null,
      byline: data.author || null,
      publishDate: publishDate || null,
      description: data.excerpt || null,
      content: content || null,
      embeddedImage: data.lead_image_url || null,
      domain: domain || null,
      url: data.url || url
    };
    
    console.log('Initial article data:', articleData);
    
    res.write(`event: initialData\n`);
    res.write(`data: ${JSON.stringify(articleData)}\n\n`);    

    const $ = cheerio.load(html);

    // Common fallback selectors for title author and publish date
    const titleSelector = [
      'h1', '.headline', '.article-title', '.entry-title', '.post-title', '.title', '.entry-title',
    ];

    const authorSelector = [ 
      '.ArticleFull_headerFooter__author__pC2tR',
      '.author', '.author-name', '.byline', '.by-author', '.byline__name', '.post-author', 
      '.auth-name', '.ArticleFull_headerFooter__author', '.entry-author', 
      '.post-author-name', '.post-meta-author', '.article__author', '.author-link', 
      '.article__byline', '.content-author', '.meta-author', '.contributor', '.by', 
      '.opinion-author', '.author-block', '.author-wrapper', '.news-author', 
      '.header-byline', '.byline-name', '.post-byline', '.metadata__byline', 
      '.author-box', '.bio-name', '.auth-link'
    ];
    
    const dateSelector = [
      '.ArticleFull_headerFooter__date__UFCbS', 'time', '.publish-date', 
      '.post-date', '.entry-date', '.article-date', '.published-date', '.t-txt',
      '.t-txt\\:sm', '.t-txt\\:u', '.t-display\\:inline-block'
    ];

    const textSelector = [
      '.article-content', '.entry-content', '.post-content', '.content', '.article-body',
      '.article-text', '.article-content', '.article-body', '.article-text', '.article-copy',
      '.article-content', '.article-main', '.article-contents', '.article-content-body'
    ];
    let cleanedContent
    let byline
    let title
    let summary
    let tags

    if (!articleData.byline || articleData.byline === "Unknown author") {
      const bylineScraped = await manualScrapeWithSelectors($, authorSelector);
      const bylineCleaned = bylineScraped
        .replace(/^by\s*/g, "") // Remove leading "by"
        .replace(/\n|\t/g, "") // Remove newlines and tabs
        .trim(); // Trim whitespace
      const uniqueBylines = [...new Set(bylineCleaned.split('by').map(name => name.trim()).filter(Boolean))];
      const finalByline = uniqueBylines.join(', ');
      byline = finalByline.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
      console.log('byline', byline);
      articleData.byline = byline;
      res.write(`event: byline\n`);
      res.write(`data: ${JSON.stringify(byline)}\n\n`);
    }

    if (!articleData.publishDate || articleData.publishDate === "Unknown date") {
      cleanedPublishDate = await manualScrapeWithSelectors($, dateSelector)
      publishDate = cleanedPublishDate.replace(/\s+/g, ' ').trim().replace(/^PUBLISHED:\s*/, '');
      console.log('publishDate', publishDate);
      articleData.publishDate = publishDate;
      res.write(`event: publishDate\n`);
      res.write(`data: ${JSON.stringify(publishDate)}\n\n`);
    }
        
    if (!articleData.title || articleData.title === "No title found") {
      cleanedTitle = await manualScrapeWithSelectors($, titleSelector)
      title = cleanedTitle.replace(/\s+/g, ' ').trim();
      console.log('title', title);
      articleData.title = title;
      res.write(`event: title\n`);
      res.write(`data: ${JSON.stringify(title)}\n\n`);
    }

    if (!articleData.content || articleData.content === "No content found") {
      cleanedContent = await manualScrapeWithSelectors($, textSelector)
      content = cleanedContent.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      articleData.content = content;
      res.write(`event: content\n`);
      res.write(`data: ${JSON.stringify(content)}\n\n`);
    }
    
    if (!data.excerpt) {
      summary = await generateSummaryFromContent(title, content);
      console.log('summary', summary);
      articleData.description = summary;
      res.write(`event: summary\n`);
      res.write(`data: ${JSON.stringify(summary)}\n\n`);
    }

    if (!data.tags) {
      tags = await generateTagsFromContent(title, content);
      articleData.tags = tags;
      res.write(`event: tags\n`);
      res.write(`data: ${JSON.stringify(tags)}\n\n`);
    }
    // let tags = await generateTagsFromContent(title, content);
    
    if (!isNaN(Date.parse(publishDate))) {
      publishDate = Math.floor(new Date(publishDate).getTime() / 1000);
    } else {
      console.error('Invalid publish date:', publishDate);
      publishDate = await generateDateFromRelativeTime(publishDate);
      publishDate = Math.floor(new Date(publishDate).getTime() / 1000);
      console.log('publishDate', publishDate);
      articleData.publishDate = publishDate;
      res.write(`event: publishDate\n`);
      res.write(`data: ${JSON.stringify(publishDate)}\n\n`);
    }

    
    // Initialize an array to hold YouTube URLs
    let youtubeUrls = [];

    // Direct YouTube URL search (in the content)
    youtubeUrls = [...content.matchAll(/(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+)/g)].map(match => match[0]);

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
    let embeddedTweets = await getEmbeddedTweets(url);
    let tweetDetails = null;
    const tweetVideoTorrent = [];
    const tweetRecords = [];
    const tweetVideoRecords = [];
    const youtubeVideoTorrent = [];
    let videoRecords = [];
    
    if (embeddedTweets.length > 0) {
      tweetDetails = await fetchTweetDetails(embeddedTweets);
      console.log('Tweet details:', tweetDetails);
    
      // if (tweetDetails && tweetDetails.includes && tweetDetails.includes.media) {
      //   let tweetMediaUrls = await getTwitterVideoUrls(embeddedTweets);
      //   await Promise.all(embeddedTweets.map(async (tweet, index) => {
      //     const tweetId = tweet.match(/status\/(\d+)/)[1]; // Extract tweet ID
      //     const mediaUrl = tweetMediaUrls[index];
    
      //     if (mediaUrl) {
      //       outputPath = await downloadVideo(mediaUrl, tweetId); // Pass video URL and tweet ID
      //       videoFiles = await publishVideoFiles(outputPath, tweetId, false);
      //       tweetVideoRecords[index] = {
      //         "video": {
      //           "bittorrentAddress": videoFiles.torrentAddress
      //         }
      //       };
      //       tweetVideoTorrent.push(videoFiles.torrentAddress);
      //     } else {
      //       tweetVideoRecords[index] = null; // No video for this tweet
      //     }
      //   }));
      // }

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
      // console.log('YouTube metadata automatic transcript:', metadata.automatic_captions.en);
      
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
      // let videoWidth = metadata.width;
      // let videoHeight = metadata.height;
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
        },
        "videoItems": [
          {
          ...videoRecords
          }
        ],
        "citations": {
        ...tweetRecords
        }
      }
      };

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
  }

    



    
    
    // return {
    //   title: title,
    //   byline: byline,
    //   publishDate: publishDate,
    //   description: data.excerpt,
    //   tags: tags || [], 
    //   content: content,
    //   embeddedTweets: embeddedTweets || [],
    //   tweetDetails: tweetDetails || [],
    //   tweetVideoTorrent: tweetVideoTorrent || [],
    //   youtubeVideos: youtubeUrls || [],
    //   youtubeVideoTorrent: youtubeVideoTorrent || [],
    //   url: url
    // };

  } catch (error) {
    console.error("Error fetching parsed article data:", error);
    throw new Error("Failed to fetch article data from parser.");
  }
}

async function getEmbeddedTweets(url) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  console.log('Page loaded...');

  // Initialize an empty array for tweet URLs
  let tweetUrls = [];

  // Try to scrape tweets in blockquotes first
  try {
    console.log('Trying to scrape tweets using blockquote.twitter-tweet...');
    const tweetsFromBlockquote = await page.evaluate(() => {
      const tweetElements = Array.from(document.querySelectorAll('blockquote.twitter-tweet'));
      return tweetElements.map(tweet => {
        const tweetLink = tweet.querySelector('a[href*="twitter.com"]');
        return tweetLink ? tweetLink.href : null;
      }).filter(Boolean); // Remove null values
    });
    tweetUrls = tweetUrls.concat(tweetsFromBlockquote);
  } catch (error) {
    console.error('Error scraping tweets in blockquotes:', error);
  }

  // Try to scrape tweets from iframes as a fallback
  try {
    console.log('Trying to scrape tweets using iframes...');
    const frameHandles = await page.$$('iframe[src*="platform.twitter.com"]');
    
    for (let frameHandle of frameHandles) {
      const frame = await frameHandle.contentFrame();
      const tweetUrl = await frame.evaluate(() => {
        const tweetLink = document.querySelector('a[href*="twitter.com"]');
        return tweetLink ? tweetLink.href : null;
      });

      if (tweetUrl) {
        tweetUrls.push(tweetUrl);
      }
    }
  } catch (error) {
    console.error('Error scraping tweets from iframes:', error);
  }

  // Remove duplicate URLs and log the result
  tweetUrls = [...new Set(tweetUrls)];
  console.log('Found embedded tweets:', tweetUrls);
  //remove any ? and after from the URL
  tweetUrls = tweetUrls.map(tweetUrl => tweetUrl.split('?')[0]);

  console.log('Fixed tweet urls:', tweetUrls);

  await browser.close();
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

  // const $ = cheerio.load(html);
  for (const selector of selectors) {
    const element = $(selector);
    if (element.length && element.text()) {
      return element.text().trim();
    }
  }
  return null;
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

Please provide the tags in a comma-separated format, with primary topics first, followed by any secondary or related subjects.`
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

async function generateSummaryFromContent(title, content) {
  console.log('Generating summary from the title and content...');
  
  const messages = [
    {
      role: "system",
      content: `You are a helpful assistant tasked with generating a summary based on article content and title. Focus on identifying the main points, key information, and overall message of the article.`
    },
    {
      role: "user",
      content: `Analyze the following content and title. Generate a concise summary that captures the essence of the article.`,
      title: title,
      content: content
    }];

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
      console.log('GPT response:', responseText);
      return responseText;
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

async function generateCombinedSummaryFromArticles(articles) {
  console.log('Generating a combined summary for multiple related articles...');

  // Initialize combined content
  let combinedContent = '';
  let combinedTitle = 'Summary of Multiple Related Articles: ';

  // Loop through each article and append title and content to the combined variables
  articles.forEach((article, index) => {
    combinedTitle += `\nArticle ${index + 1}: ${article.title}`;
    combinedContent += `\n\nTitle: ${article.title}\nContent: ${article.content}`;
  });

  const messages = [
    {
      role: "system",
      content: `You are a helpful assistant tasked with generating a summary that combines and captures the main ideas, key information, and overall messages from multiple related articles. Focus on synthesizing common themes and important points.`
    },
    {
      role: "user",
      content: `Analyze the following articles and generate a concise summary that combines the essence of all of them.`,
      title: combinedTitle,
      content: combinedContent
    }
  ];

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4-turbo',  // Use GPT-4 Turbo with 128k token limit
      messages: messages,
      max_tokens: 4096, // Adjust token limit if needed
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 180000  
    });

    if (response.data && response.data.choices && response.data.choices[0]) {
      const responseText = response.data.choices[0].message.content;
      console.log('Combined GPT response:', responseText);
      return responseText;
    } else {
      console.error('Unexpected response structure:', response);
      return '';
    }
  }
  catch (error) {
    console.error('Error generating combined summary:', error.response ? error.response.data : error.message);
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

// router.post('/article', async (req, res) => {
//   let { url } = req.body;
//   if (url.includes('?')) {
//     url = url.split('?')[0];
//   }

//   if (!url) {
//     return res.status(400).json({ error: 'URL is required' });
//   }

//   try {
//     // let data = await Parser.parse(url);
//     let data = await fetchParsedArticleData(url);
//     console.log('Parsed data:', data);
//     res.json(data);
//     // Parser.parse(url).then((data) => {
//     //   console.log('Parsed data:', url, data);

//     //   let title = data.title || "No title found";
//     //   let byline = data.author || "Unknown author";
//     //   let publishDate = data.date_published || "Unknown date";

//     //   let articleData = {
//     //     title: title,
//     //     byline: byline,
//     //     publishDate: publishDate,
//     //     description: data.excerpt || "No description found",
//     //     url: url
//     //   };

//     //   console.log('Article data:', articleData);
//     //   res.json(articleData);
//     // })
//   } catch (error) {
//     console.error('Error during scraping:', error);
//     return res.status(500).json({ error: 'An error occurred while scraping the article.' });
//   }
// });

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

router.get('/article/stream', async (req, res) => {
  let url = req.query.url;
  if (url.includes('?')) {
    url = url.split('?')[0];
  }

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    await fetchParsedArticleData(url, res);
  } catch (error) {
    console.error('Error during scraping:', error);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'An error occurred while scraping the article.' })}\n\n`);
    res.end();
  }
});

module.exports = router;