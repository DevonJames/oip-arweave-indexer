const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const crypto = require('crypto');
const router = express.Router();
const FormData = require('form-data');
const { getRecords } = require('../helpers/elasticsearch');
const tesseract = require('tesseract.js');

// Define media directory - matching the one in api.js
const mediaDirectory = path.join(__dirname, '../media');

// Ensure JFK document directories exist
const jfkBaseDir = path.join(mediaDirectory, 'jfk');
const jfkPdfDir = path.join(jfkBaseDir, 'pdf');
const jfkImagesDir = path.join(jfkBaseDir, 'images');
const jfkAnalysisDir = path.join(jfkBaseDir, 'analysis');

// Create directories if they don't exist
[jfkBaseDir, jfkPdfDir, jfkImagesDir, jfkAnalysisDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Utility function to sanitize document IDs for safe file paths and database lookups
function sanitizeDocumentId(documentId) {
  if (!documentId) return '';
  
  // Replace spaces, parentheses, and other problematic characters
  // First, strip out common NARA reference patterns like (C06932208)
  let sanitized = documentId.replace(/\s*\([^)]+\)\s*/g, '');
  
  // Replace any remaining spaces, parentheses, and other special characters with underscores
  sanitized = sanitized.replace(/[\s()[\]{}.,;:'"\/\\<>|?*+=#&%@!^~`$]/g, '_');
  
  // Trim any leading/trailing underscores
  sanitized = sanitized.replace(/^_+|_+$/g, '');
  
  // Ensure we return a valid string
  return sanitized || crypto.createHash('sha256').update(documentId).digest('hex').substring(0, 10);
}

// Function to check if a page is already published
async function findExistingJFKPage(documentId, pageNum) {
  try {
    // Clean up document ID - remove any leading slashes if present
    if (documentId.startsWith('/')) {
      documentId = documentId.substring(1);
    }
    
    // Sanitize the document ID for consistent lookups
    const sanitizedId = sanitizeDocumentId(documentId);
    
    // Search for existing pages with this document ID and page number
    const searchQuery = {
      query: {
        bool: {
          must: [
            { match: { "data.jfkFilesPageOfDocument.pageNumber": pageNum } },
            { match_phrase: { "data.basic.name": `Page ${pageNum} of JFK Document ${sanitizedId}` } }
          ]
        }
      }
    };
    
    // Also try with the original unsanitized ID as a fallback
    const originalIdSearchQuery = {
      query: {
        bool: {
          must: [
            { match: { "data.jfkFilesPageOfDocument.pageNumber": pageNum } },
            { match_phrase: { "data.basic.name": `Page ${pageNum} of JFK Document ${documentId}` } }
          ]
        }
      }
    };
    
    // Try searching by page number only with sanitized ID prefix match
    const pageNumberOnlyQuery = {
      query: {
        bool: {
          must: [
            { match: { "data.jfkFilesPageOfDocument.pageNumber": pageNum } }
          ],
          should: [
            { prefix: { "data.basic.name": `Page ${pageNum} of JFK Document ${sanitizedId}` } },
            { prefix: { "data.basic.name": `Page ${pageNum} of JFK Document ${documentId}` } }
          ],
          minimum_should_match: 1
        }
      }
    };
    
    // Try multiple queries in sequence
    
    // Try the sanitized ID first
    let existingPages = await getRecords(searchQuery, 0, 1);
    
    // If no results, try the original ID
    if (!existingPages || existingPages.length === 0) {
      existingPages = await getRecords(originalIdSearchQuery, 0, 1);
    }
    
    // If still no results, try the more flexible page number query
    if (!existingPages || existingPages.length === 0) {
      existingPages = await getRecords(pageNumberOnlyQuery, 0, 1);
    }
    
    if (existingPages && existingPages.length > 0) {
      console.log(`Found existing page for document ${documentId}, page ${pageNum} with txid: ${existingPages[0].oip.didTx}`);
      return existingPages[0];
    }
    
    return null;
  } catch (error) {
    console.error(`Error searching for existing JFK page: ${error.message}`);
    return null;
  }
}

// Function to check if a document is already published
async function findExistingJFKDocument(documentId) {
  try {
    // Clean up document ID - remove any leading slashes if present
    if (documentId.startsWith('/')) {
      documentId = documentId.substring(1);
    }
    
    // Sanitize the document ID for consistent lookups
    const sanitizedId = sanitizeDocumentId(documentId);
    
    console.log(`Searching for document with ID: ${documentId} (sanitized: ${sanitizedId})`);
    
    // Search for existing document with this ID - try multiple approaches
    
    // First, try exact match on sanitized ID
    const exactSearchQuery = {
      query: {
        bool: {
          must: [
            { match: { "data.jfkFilesDocument.naraRecordNumber": sanitizedId } }
          ]
        }
      }
    };
    
    // Also try with the original unsanitized ID as a fallback
    const originalIdSearchQuery = {
      query: {
        bool: {
          must: [
            { match: { "data.jfkFilesDocument.naraRecordNumber": documentId } }
          ]
        }
      }
    };
    
    // Try prefix match (for cases with missing parts of ID)
    const prefixSearchQuery = {
      query: {
        bool: {
          must: [
            { prefix: { "data.jfkFilesDocument.naraRecordNumber": sanitizedId } }
          ]
        }
      }
    };
    
    // Try the document name field as well
    const nameSearchQuery = {
      query: {
        bool: {
          must: [
            { match_phrase: { "data.basic.name": `JFK Document ${sanitizedId}` } }
          ]
        }
      }
    };
    
    // Try multiple queries in sequence
    let existingDocs = null;
    
    // Try exact match on sanitizedId first
    existingDocs = await getRecords(exactSearchQuery, 0, 1);
    if (existingDocs && existingDocs.length > 0) {
      console.log(`Found existing document with exact sanitized ID match: ${existingDocs[0].oip.didTx}`);
      return existingDocs[0];
    }
    
    // Try exact match on original ID
    existingDocs = await getRecords(originalIdSearchQuery, 0, 1);
    if (existingDocs && existingDocs.length > 0) {
      console.log(`Found existing document with exact original ID match: ${existingDocs[0].oip.didTx}`);
      return existingDocs[0];
    }
    
    // Try prefix match
    existingDocs = await getRecords(prefixSearchQuery, 0, 1);
    if (existingDocs && existingDocs.length > 0) {
      console.log(`Found existing document with prefix match: ${existingDocs[0].oip.didTx}`);
      return existingDocs[0];
    }
    
    // Try name match
    existingDocs = await getRecords(nameSearchQuery, 0, 1);
    if (existingDocs && existingDocs.length > 0) {
      console.log(`Found existing document with name match: ${existingDocs[0].oip.didTx}`);
      return existingDocs[0];
    }
    
    console.log(`No existing document found for ${documentId}`);
    return null;
  } catch (error) {
    console.error(`Error searching for existing JFK document: ${error.message}`);
    return null;
  }
}

// Function to publish content using real or mock publishing based on environment
async function publishJFKContent(data, contentType) {
  // If in production mode, use actual publishing mechanism
  if (process.env.NODE_ENV === 'production') {
    const { publishNewRecord } = require('../helpers/templateHelper');
    try {
      const record = await publishNewRecord(data, contentType);
      return {
        txid: record.oip.didTx.replace('did:arweave:', ''),
        didTx: record.oip.didTx
      };
    } catch (error) {
      console.error(`Error publishing ${contentType}:`, error);
      throw error;
    }
  } else {
    // In development/test mode, use mock publishing
    const txid = Array.from({length: 43}, () => 
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[Math.floor(Math.random() * 64)]
    ).join('');
    
    return {
      txid,
      didTx: `did:arweave:${txid}`
    };
  }
}

// Utility function to download PDF
async function downloadPdf(url, documentId, sendUpdate) {
  console.log('downloadPdf', url, documentId);
  sendUpdate('download', { status: 'downloading', message: 'Downloading PDF document' });
  
  const fileName = `jfk-doc-${documentId}.pdf`;
  const outputPath = path.join(jfkPdfDir, fileName);
  
  // If file already exists, skip download
  if (fs.existsSync(outputPath)) {
    sendUpdate('download', { status: 'cached', message: 'Using previously downloaded PDF' });
    return outputPath;
  }
  
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });
    
    // Get content length for progress tracking if available
    const totalLength = response.headers['content-length'];
    
    // Create write stream
    const writer = fs.createWriteStream(outputPath);
    
    // Set up progress tracking
    let downloadedBytes = 0;
    
    response.data.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      if (totalLength) {
        const progress = Math.round((downloadedBytes / totalLength) * 100);
        if (progress % 10 === 0) { // Only send updates every 10%
          sendUpdate('download', { 
            status: 'progress', 
            progress, 
            downloaded: downloadedBytes,
            total: totalLength 
          });
        }
      }
    });
    
    // Pipe download to file
    response.data.pipe(writer);
    
    // Wait for download to complete
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    
    sendUpdate('download', { status: 'complete', message: 'PDF download complete' });
    
    return outputPath;
  } catch (error) {
    console.error(`Error downloading PDF: ${error.message}`);
    // Instead of throwing an error, send an update to the client
    sendUpdate('download', { 
      status: 'error', 
      message: `The PDF file could not be downloaded: ${error.message}`,
      error: true
    });
    
    // Return null to indicate no file was downloaded
    return null;
  }
}

// Utility function to convert PDF to images
async function convertPdfToImages(pdfPath, documentId, sendUpdate) {
  sendUpdate('conversion', { status: 'starting', message: 'Converting PDF to images' });
  
  const outputDir = path.join(jfkImagesDir, documentId);
  
  // Create document-specific output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  try {
    // First, determine the number of pages using pdftoppm
    const { stdout: pageInfoOutput } = await execAsync(`pdfinfo "${pdfPath}"`);
    const pageCountMatch = pageInfoOutput.match(/Pages:\s*(\d+)/);
    const pageCount = pageCountMatch ? parseInt(pageCountMatch[1], 10) : 0;
    
    if (pageCount === 0) {
      throw new Error('Could not determine page count or PDF has no pages');
    }
    
    sendUpdate('conversion', { 
      status: 'info', 
      message: `PDF has ${pageCount} pages to process` 
    });
    
    // Use pdftoppm to convert PDF to PNG images (one per page)
    const outputPrefix = path.join(outputDir, 'page');
    await execAsync(`pdftoppm -png -r 300 "${pdfPath}" "${outputPrefix}"`);
    
    // Check if pages were generated
    const files = fs.readdirSync(outputDir);
    const pageFiles = files.filter(file => file.startsWith('page-') && file.endsWith('.png'));
    
    if (pageFiles.length === 0) {
      throw new Error('No page images were generated during conversion');
    }
    
    // Sort page files to ensure correct order
    pageFiles.sort((a, b) => {
      const numA = parseInt(a.match(/page-(\d+)/)[1], 10);
      const numB = parseInt(b.match(/page-(\d+)/)[1], 10);
      return numA - numB;
    });
    
    // Create full paths for all page images
    const imagePaths = pageFiles.map(file => path.join(outputDir, file));
    
    sendUpdate('conversion', { 
      status: 'complete', 
      message: `Successfully converted PDF to ${imagePaths.length} images`,
      imageCount: imagePaths.length
    });
    
    return imagePaths;
  } catch (error) {
    console.error(`Error converting PDF to images: ${error.message}`);
    // Send an update instead of throwing error
    sendUpdate('conversion', { 
      status: 'error', 
      message: `Failed to convert PDF to images: ${error.message}`,
      error: true
    });
    
    // Return null to indicate conversion failure
    return null;
  }
}

// Utility function to analyze images with Grok Vision API
async function analyzeImagesWithGrok(imagePaths, documentId, sendUpdate) {
  const results = [];
  
  // Get API key from environment
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    sendUpdate('analysis', { 
      status: 'error', 
      message: 'XAI_API_KEY is not set in environment variables', 
      error: true 
    });
    return null;
  }
  
  sendUpdate('analysis', { 
    status: 'starting', 
    message: `Beginning image analysis for ${imagePaths.length} pages` 
  });
  
  // Create document-specific analysis directory
  const analysisDir = path.join(jfkAnalysisDir, documentId);
  if (!fs.existsSync(analysisDir)) {
    fs.mkdirSync(analysisDir, { recursive: true });
  }
  
  let worker;
  try {
    // Initialize Tesseract worker (this is reused for all pages)
    worker = await tesseract.createWorker('eng');
    
    // Process each image sequentially
    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];
      const pageNum = i + 1;
      
      sendUpdate('analysis', { 
        status: 'processing', 
        message: `Analyzing page ${pageNum} of ${imagePaths.length}`,
        page: pageNum,
        totalPages: imagePaths.length
      });
      
      try {
        // First, run OCR on the image to extract text
        sendUpdate('analysis', { 
          status: 'ocr', 
          message: `Extracting text from page ${pageNum} via OCR`,
          page: pageNum
        });
        
        const { data: { text: extractedText } } = await worker.recognize(imagePath);
        
        // Save OCR text to file
        const ocrTextPath = path.join(analysisDir, `page-${pageNum}-ocr.txt`);
        fs.writeFileSync(ocrTextPath, extractedText);
        
        sendUpdate('analysis', { 
          status: 'ocr_complete', 
          message: `OCR text extraction complete for page ${pageNum}`,
          page: pageNum,
          textLength: extractedText.length
        });
        
        // Read image file as base64 for Grok analysis
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString('base64');
        
        // Prepare prompt for Grok Vision API (now we don't need full text transcription)
        const prompt = `
          This is a page from an FBI document related to the JFK assassination. 
          Please analyze it carefully and provide:
          
          1. A detailed summary of what you see on this page
          2. All handwritten notes and their locations
          3. Any stamps, markings, or annotations with dates
          4. Names of people mentioned in the document
          5. Dates mentioned in the document
          6. Places mentioned in the document (cities, countries, buildings, locations)
          7. Objects mentioned in the document (weapons, vehicles, documents, physical items)
          8. Any redacted sections and their context
          
          After your analysis, provide a structured JSON output with the following format:
          {
            "pageNumber": ${pageNum},
            "summary": "brief description of page content",
            "handwrittenNotes": [
              {"content": "text of note", "location": "approximate location"}
            ],
            "stamps": [
              {"type": "stamp type", "date": "date if present", "text": "text content"}
            ],
            "names": ["list of names found"],
            "dates": ["list of dates mentioned"],
            "places": ["list of places mentioned"],
            "objects": ["list of objects mentioned"],
            "redactions": ["descriptions of redacted areas"],
            "relevanceToJFK": "assessment of relevance to the assassination"
          }
        `;
        
        // Make request to Grok Vision API
        const response = await axios.post(
          'https://api.x.ai/v1/chat/completions',
          {
            model: 'grok-2-vision-latest',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:image/png;base64,${base64Image}`,
                      detail: 'high',
                    },
                  },
                  {
                    type: 'text',
                    text: prompt,
                  },
                ],
              },
            ],
            temperature: 0.2,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
          }
        );
        
        // Extract the analysis text and attempt to parse JSON
        const analysisText = response.data.choices[0].message.content;
        
        // Save raw analysis to file
        const rawAnalysisPath = path.join(analysisDir, `page-${pageNum}-raw.txt`);
        fs.writeFileSync(rawAnalysisPath, analysisText);
        
        // Extract JSON from the analysis text
        let jsonData = {};
        try {
          // Look for JSON block in response
          const jsonMatch = analysisText.match(/```json\n([\s\S]*?)\n```/) || 
                           analysisText.match(/```\n([\s\S]*?)\n```/) ||
                           analysisText.match(/{[\s\S]*?}/);
                           
          const jsonString = jsonMatch ? jsonMatch[0].replace(/```json\n|```\n|```/g, '') : analysisText;
          jsonData = JSON.parse(jsonString);
        } catch (jsonError) {
          console.warn(`Warning: Could not parse JSON from Grok response for page ${pageNum}. Using raw text.`);
          jsonData = { 
            pageNumber: pageNum,
            rawAnalysis: analysisText,
            error: "Failed to parse structured data"
          };
        }
        
        // Add OCR text to the data
        jsonData.fullText = extractedText;
        
        // Add additional metadata
        jsonData.pageNumber = pageNum;
        jsonData.imagePath = imagePath;
        
        // Save JSON analysis to file
        const jsonAnalysisPath = path.join(analysisDir, `page-${pageNum}.json`);
        fs.writeFileSync(jsonAnalysisPath, JSON.stringify(jsonData, null, 2));
        
        // Add to results array
        results.push(jsonData);
        
        sendUpdate('analysis', { 
          status: 'progress', 
          page: pageNum,
          totalPages: imagePaths.length,
          progress: Math.round((pageNum / imagePaths.length) * 100)
        });
        
      } catch (error) {
        console.error(`Error analyzing page ${pageNum}:`, error);
        
        // Continue with other pages despite error
        results.push({
          pageNumber: pageNum,
          error: `Failed to analyze: ${error.message}`,
          imagePath: imagePath,
          fullText: "Error during text extraction"
        });
        
        sendUpdate('analysis', { 
          status: 'error', 
          message: `Error analyzing page ${pageNum}: ${error.message}`,
          page: pageNum
        });
      }
    }
    
    sendUpdate('analysis', { 
      status: 'complete', 
      message: `Completed analysis of all ${imagePaths.length} pages` 
    });
    
    return results;
  } catch (error) {
    console.error(`Error in image analysis process:`, error);
    sendUpdate('analysis', { 
      status: 'error', 
      message: `Analysis process failed: ${error.message}`,
      error: true
    });
    
    // Return the partial results or null
    return results.length > 0 ? results : null;
  } finally {
    // Always clean up the Tesseract worker
    if (worker) {
      try {
        await worker.terminate();
      } catch (err) {
        console.error("Error terminating Tesseract worker:", err);
      }
    }
  }
}

// Function to generate metadata from analysis results
function generateMetadata(documentUrl, documentId, imagePaths, analysisResults) {
  const metadata = {
    documentId,
    documentUrl,
    processingDate: new Date().toISOString(),
    pageCount: imagePaths.length,
    pages: [],
    summary: '',
    allNames: new Set(),
    allDates: new Set(),
    allPlaces: new Set(),
    allObjects: new Set(),
    handwrittenNotes: [],
    stamps: []
  };
  
  // Process each page's analysis
  analysisResults.forEach(result => {
    // Add normalized page data
    const pageData = {
      pageNumber: result.pageNumber,
      imagePath: result.imagePath,
      summary: result.summary || result.rawAnalysis || 'No analysis available',
      fullText: result.fullText || '',
      dates: result.dates || []
    };
    
    // Collect names
    if (result.names && Array.isArray(result.names)) {
      result.names.forEach(name => metadata.allNames.add(name));
    }
    
    // Collect dates
    if (result.dates && Array.isArray(result.dates)) {
      result.dates.forEach(date => metadata.allDates.add(date));
    }
    
    // Collect places
    if (result.places && Array.isArray(result.places)) {
      result.places.forEach(place => metadata.allPlaces.add(place));
    }
    
    // Collect objects
    if (result.objects && Array.isArray(result.objects)) {
      result.objects.forEach(object => metadata.allObjects.add(object));
    }
    
    // Collect handwritten notes
    if (result.handwrittenNotes && Array.isArray(result.handwrittenNotes)) {
      result.handwrittenNotes.forEach(note => {
        metadata.handwrittenNotes.push({
          pageNumber: result.pageNumber,
          ...note
        });
      });
    }
    
    // Collect stamps
    if (result.stamps && Array.isArray(result.stamps)) {
      result.stamps.forEach(stamp => {
        metadata.stamps.push({
          pageNumber: result.pageNumber,
          ...stamp
        });
      });
    }
    
    metadata.pages.push(pageData);
  });
  
  // Convert Sets to Arrays
  metadata.allNames = Array.from(metadata.allNames);
  metadata.allDates = Array.from(metadata.allDates);
  metadata.allPlaces = Array.from(metadata.allPlaces);
  metadata.allObjects = Array.from(metadata.allObjects);
  
  // Generate an overall summary
  // Use first few page summaries to create a document-level summary
  const summaryPages = metadata.pages.slice(0, Math.min(5, metadata.pages.length));
  const summaryTexts = summaryPages.map(page => page.summary).filter(Boolean);
  metadata.summary = summaryTexts.join(' ').substring(0, 500) + (metadata.pages.length > 5 ? '...' : '');
  
  // Create a combined full text of the entire document
  metadata.fullText = metadata.pages.map(page => `--- PAGE ${page.pageNumber} ---\n${page.fullText}`).join('\n\n');
  
  // Save metadata to file
  const metadataPath = path.join(jfkAnalysisDir, `${documentId}-metadata.json`);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  
  return metadata;
}

// Function to format page data according to template
function formatPageData(analysisData, imagePath, documentId, pageNum) {
  // Sanitize document ID for consistent formatting
  const sanitizedId = sanitizeDocumentId(documentId);
  
  // Create the filename for the image
  const imageFilename = path.basename(imagePath || '');
  
  // Create webUrl for the image
  const imageWebUrl = `/api/jfk/media?id=${encodeURIComponent(sanitizedId)}&type=image`;
  
  // Get image dimensions using Sharp
  let width = 0;
  let height = 0;
  let size = 0;
  
  try {
    if (imagePath && fs.existsSync(imagePath)) {
      const stats = fs.statSync(imagePath);
      size = stats.size;
      
      // Only try to get dimensions if the file exists
      try {
        const sharp = require('sharp');
        const metadata = sharp(imagePath).metadata();
        width = metadata.width || 800;  // Default if can't determine
        height = metadata.height || 1200; // Default if can't determine
      } catch (dimensionError) {
        console.warn(`Warning: Could not get image dimensions for ${imagePath}: ${dimensionError.message}`);
        // Use default dimensions
        width = 800;
        height = 1200;
      }
    } else {
      console.warn(`Warning: Image path is missing or invalid: ${imagePath}`);
      // Use default size and dimensions
      size = 100000; // Default size
      width = 800;
      height = 1200;
    }
  } catch (error) {
    console.warn(`Warning: Could not get image stats for ${imagePath}: ${error.message}`);
    // Use default size and dimensions
    size = 100000; // Default size
    width = 800;
    height = 1200;
  }
  
  // Handle cases where analysisData might be a page from reconstructed metadata
  const summary = analysisData.summary || "JFK assassination document page";
  const fullText = analysisData.fullText || "";
  const handwrittenNotes = Array.isArray(analysisData.handwrittenNotes) 
    ? analysisData.handwrittenNotes.map(note => note.content || note) 
    : [];
  const stamps = Array.isArray(analysisData.stamps) ? analysisData.stamps : [];
  const names = Array.isArray(analysisData.names) ? analysisData.names : [];
  const dates = Array.isArray(analysisData.dates) ? analysisData.dates : [];
  const places = Array.isArray(analysisData.places) ? analysisData.places : [];
  const objects = Array.isArray(analysisData.objects) ? analysisData.objects : [];
  const redactions = Array.isArray(analysisData.redactions) ? analysisData.redactions : [];
  const relevanceToJFK = analysisData.relevanceToJFK || "";
  
  // Format the page data according to jfkFilesPageOfDocument template
  const pageData = {
    "basic": {
      "name": `Page ${pageNum} of JFK Document ${sanitizedId}`,
      "date": Math.floor(Date.now() / 1000), // Current timestamp in seconds
      "language": "en",
      "nsfw": false,
      "description": summary,
      "text": fullText,
      "webUrl": imageWebUrl,
      "tagItems": ["JFK", "assassination", "document", "declassified"]
    },
    "jfkFilesPageOfDocument": {
      "pageNumber": pageNum,
      "fullText": fullText,
      "summary": summary,
      "handwrittenNotes": handwrittenNotes,
      "stamps": stamps,
      "names": names,
      "dates": dates,
      "places": places,
      "objects": objects,
      "redactions": redactions,
      "relevanceToJFK": relevanceToJFK,
      "image": { // This will become a dref after publishing
        "webUrl": imageWebUrl,
        "contentType": "image/png",
        "size": size,
        "width": width,
        "height": height
      }
    }
  };
  
  return pageData;
}

// Function to format the complete document data
function formatDocumentData(documentId, documentUrl, metadata, pageRefs) {
  // Extract information from the URL and metadata
  const naraRecordNumber = documentId;
  
  // Extract release information from URL if possible
  let releaseBatch = "JFK Assassination Records";
  let releaseDate = new Date().toISOString().split('T')[0]; // Default to today
  
  // Try to parse the URL for release information
  // Example URL: https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10012-10022.pdf
  try {
    const urlMatch = documentUrl.match(/\/releases\/(\d{4})\/(\d{2})(\d{2})\//);
    if (urlMatch) {
      const [_, year, month, day] = urlMatch;
      const releaseYear = year;
      const formattedMonth = new Date(`${year}-${month}-01`).toLocaleString('default', { month: 'long' });
      releaseBatch = `${formattedMonth} ${year} Release`;
      releaseDate = `${year}-${month}-${day}`;
    }
  } catch (e) {
    console.warn("Could not parse release date from URL:", e);
  }
  
  // Determine agency from document content or ID pattern if possible
  let originatingAgency = "Unknown";
  if (metadata.pages && metadata.pages.length > 0) {
    const firstPageSummary = metadata.pages[0].summary || "";
    if (firstPageSummary.includes("FBI")) {
      originatingAgency = "FBI";
    } else if (firstPageSummary.includes("CIA")) {
      originatingAgency = "CIA";
    } else if (firstPageSummary.includes("Department of State")) {
      originatingAgency = "Department of State";
    }
  }
  
  const declassificationStatus = "Declassified";
  
  // Ensure we have related names, even if empty
  const relatedNames = Array.isArray(metadata.allNames) && metadata.allNames.length > 0 
    ? metadata.allNames 
    : ["Records related to JFK Assassination"];
  
  // Format according to jfkFilesDocument template with all required fields
  const documentData = {
    "basic": {
      "name": `JFK Document ${documentId}`,
      "date": Math.floor(Date.now() / 1000), // Current timestamp in seconds
      "language": "en",
      "nsfw": false,
      "description": metadata.summary || `Declassified document related to the JFK assassination investigation`,
      "webUrl": documentUrl || `https://www.archives.gov/research/jfk/releases`,
      "tagItems": ["JFK", "assassination", "document", "declassified"]
    },
    "jfkFilesDocument": {
      "naraRecordNumber": naraRecordNumber,
      "documentType": "Government Record",
      "declassificationStatus": declassificationStatus,
      "releaseBatch": releaseBatch,
      "releaseDate": releaseDate,
      "releaseTimeEST": new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
      "releasePagesCount": pageRefs.length,
      "originatingAgency": originatingAgency,
      "relatedNames": relatedNames,
      "relatedTopics": ["Kennedy Assassination"],
      "internalReferenceCodes": [],
      "pages": pageRefs // Array of didTx references to published pages
    }
  }
  
  // Add additional fields if they exist in metadata
  if (metadata.allDates && metadata.allDates.length > 0) {
    documentData.jfkFilesDocument.documentDates = metadata.allDates;
  }
  
  if (metadata.allPlaces && metadata.allPlaces.length > 0) {
    documentData.jfkFilesDocument.documentPlaces = metadata.allPlaces;
  }
  
  if (metadata.allObjects && metadata.allObjects.length > 0) {
    documentData.jfkFilesDocument.documentObjects = metadata.allObjects;
  }
  
  return documentData;
}

// Function to check if a document entry is incomplete/malformed
async function isDocumentEntryIncomplete(document) {
  if (!document) return true;
  
  try {
    // Check if the document has missing critical information
    const data = document.data?.jfkFilesDocument;
    if (!data) return true;
    
    // Check if pageCount is missing or zero
    if (!data.pages || data.pages.length === 0) return true;
    
    // Check if other important fields are missing
    if (!data.relatedNames || data.relatedNames.length === 0) return true;
    
    // Check for missing dates
    if (!data.releaseDate) return true;
    
    // Check for missing relatedTopics
    if (!data.relatedTopics || data.relatedTopics.length === 0) return true;
    
    // Check for empty string values in critical fields
    if (data.naraRecordNumber === "") return true;
    if (data.documentType === "") return true;
    if (data.declassificationStatus === "") return true;
    
    return false;
  } catch (error) {
    console.error(`Error checking if document entry is incomplete: ${error.message}`);
    return true; // If we couldn't check properly, assume it's incomplete
  }
}

// Function to build an updated document entry
async function buildUpdatedDocumentEntry(existingDocument, documentId, metadata) {
  try {
    // Get all formatted page files
    const documentAnalysisDir = path.join(jfkAnalysisDir, documentId);
    const files = fs.readdirSync(documentAnalysisDir);
    const formattedPageFiles = files.filter(file => file.match(/page-\d+-formatted\.json/));
    
    // Get references to all published pages
    const pageRefs = [];
    for (let i = 1; i <= metadata.pageCount; i++) {
      const existingPage = await findExistingJFKPage(documentId, i);
      if (existingPage) {
        pageRefs.push(existingPage.oip.didTx);
      }
    }
    
    // If there are no page references, we can't update the document properly
    if (pageRefs.length === 0) {
      return null;
    }
    
    // Preserve the original document ID and txid
    const originalTxid = existingDocument.oip.didTx;
    const documentUrl = metadata.documentUrl;
    
    // Format document data
    const documentData = formatDocumentData(documentId, documentUrl, metadata, pageRefs);
    
    // Add the original transaction ID to make sure we update the correct record
    documentData.originalTxid = originalTxid;
    
    return documentData;
  } catch (error) {
    console.error(`Error building updated document entry: ${error.message}`);
    return null;
  }
}

// Helper function to reconstruct metadata from pages
async function reconstructMetadataFromPages(documentId, originalMetadata) {
  try {
    // Directory for page analysis files
    const analysisDir = path.join(jfkAnalysisDir, documentId);
    
    if (!fs.existsSync(analysisDir)) {
      console.log(`Analysis directory not found for document ${documentId}`);
      return null;
    }
    
    // Clone the original metadata as a starting point
    const metadata = JSON.parse(JSON.stringify(originalMetadata));
    
    // Initialize or reset collections
    metadata.allNames = new Set();
    metadata.allDates = new Set();
    metadata.allPlaces = new Set();
    metadata.allObjects = new Set();
    metadata.handwrittenNotes = [];
    metadata.stamps = [];
    
    let metadataUpdated = false;
    
    // Update each page with the latest data
    for (let i = 0; i < metadata.pages.length; i++) {
      const pageNum = metadata.pages[i].pageNumber;
      const pageJsonPath = path.join(analysisDir, `page-${pageNum}.json`);
      
      if (fs.existsSync(pageJsonPath)) {
        try {
          // Read the latest page data
          const pageData = JSON.parse(fs.readFileSync(pageJsonPath, 'utf-8'));
          
          // Update the metadata with this latest page data
          metadata.pages[i] = {
            pageNumber: pageNum,
            imagePath: pageData.imagePath || metadata.pages[i].imagePath,
            summary: pageData.summary || metadata.pages[i].summary,
            fullText: pageData.fullText || metadata.pages[i].fullText,
            dates: pageData.dates || [],
            names: pageData.names || [],
            places: pageData.places || [],
            objects: pageData.objects || []
          };
          
          // Collect names
          if (pageData.names && Array.isArray(pageData.names)) {
            pageData.names.forEach(name => metadata.allNames.add(name));
          }
          
          // Collect dates
          if (pageData.dates && Array.isArray(pageData.dates)) {
            pageData.dates.forEach(date => metadata.allDates.add(date));
          }
          
          // Collect places
          if (pageData.places && Array.isArray(pageData.places)) {
            pageData.places.forEach(place => metadata.allPlaces.add(place));
          }
          
          // Collect objects
          if (pageData.objects && Array.isArray(pageData.objects)) {
            pageData.objects.forEach(object => metadata.allObjects.add(object));
          }
          
          // Collect handwritten notes
          if (pageData.handwrittenNotes && Array.isArray(pageData.handwrittenNotes)) {
            pageData.handwrittenNotes.forEach(note => {
              metadata.handwrittenNotes.push({
                pageNumber: pageNum,
                ...note
              });
            });
          }
          
          // Collect stamps
          if (pageData.stamps && Array.isArray(pageData.stamps)) {
            pageData.stamps.forEach(stamp => {
              metadata.stamps.push({
                pageNumber: pageNum,
                ...stamp
              });
            });
          }
          
          metadataUpdated = true;
        } catch (pageError) {
          console.error(`Error reading latest data for page ${pageNum}:`, pageError);
          // Keep the existing page data if there's an error
        }
      }
    }
    
    // Convert Sets to Arrays
    if (metadataUpdated) {
      metadata.allNames = Array.from(metadata.allNames);
      metadata.allDates = Array.from(metadata.allDates);
      metadata.allPlaces = Array.from(metadata.allPlaces);
      metadata.allObjects = Array.from(metadata.allObjects);
      
      // Generate an updated overall summary
      const summaryPages = metadata.pages.slice(0, Math.min(5, metadata.pages.length));
      const summaryTexts = summaryPages.map(page => page.summary).filter(Boolean);
      metadata.summary = summaryTexts.join(' ').substring(0, 500) + (metadata.pages.length > 5 ? '...' : '');
      
      // Create a combined full text of the entire document
      metadata.fullText = metadata.pages.map(page => `--- PAGE ${page.pageNumber} ---\n${page.fullText}`).join('\n\n');
      
      return metadata;
    }
    
    return null;
  } catch (error) {
    console.error(`Error reconstructing metadata from pages: ${error.message}`);
    return null;
  }
}

// Shared utility function for setting up SSE connections
function setupSSEConnection(res, documentId) {
  // Set up SSE connection
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'  // Allow CORS
  });
  
  // Set up heartbeat interval
  const heartbeatInterval = setInterval(() => {
    res.write(`event: heartbeat\n`);
    res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
  }, 15000); // Send heartbeat every 15 seconds
  
  // Set a stall timeout
  const stallTimeout = setTimeout(() => {
    console.log("No progress detected after timeout, ending connection");
    clearInterval(heartbeatInterval);
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ status: 'timeout', message: 'Processing timed out without completion' })}\n\n`);
    res.end();
  }, 1800000); // 30 minutes
  
  // Create sendUpdate function
  const sendUpdate = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  return { heartbeatInterval, stallTimeout, sendUpdate };
}

// Process document endpoint
router.post('/process', async (req, res) => {
  try {
    const { documentUrl } = req.body;
    console.log('documentUrl at start of function', documentUrl);
    
    if (!documentUrl) {
      return res.status(400).json({ error: 'Document URL is required' });
    }
    
    // Extract document ID from URL instead of hashing it
    const rawDocumentId = documentUrl.match(/\/([^\/]+)\.pdf$/i)?.[1] || 
      crypto.createHash('sha256').update(documentUrl).digest('hex').substring(0, 10);
    
    // Keep track of both the original ID and the sanitized version
    const originalDocumentId = rawDocumentId;
    const documentId = sanitizeDocumentId(rawDocumentId);
    
    console.log(`Document ID: Original=${originalDocumentId}, Sanitized=${documentId}`);
    
    // Set up SSE connection and communication utilities
    const { heartbeatInterval, stallTimeout, sendUpdate } = setupSSEConnection(res, documentId);
    
    sendUpdate('processing', { 
      status: 'starting', 
      message: 'Beginning document processing',
      originalDocumentId,
      documentId
    });
    
    // Check if this document has already been processed
    const documentImagesDir = path.join(jfkImagesDir, documentId);
    const documentMetadataPath = path.join(jfkAnalysisDir, `${documentId}-metadata.json`);
    
    if (fs.existsSync(documentImagesDir) && fs.existsSync(documentMetadataPath)) {
      sendUpdate('processing', { 
        status: 'cached', 
        message: 'Document has already been processed, using cached results' 
      });
      
      console.log(`Using cached processing results for document ${documentId}`);
      
      // Force regenerate metadata to ensure complete metadata
      let metadata;
      try {
        console.log(`Reconstructing complete metadata for document ${documentId}`);
        sendUpdate('processing', {
          status: 'reconstructing',
          message: 'Reconstructing complete metadata from page files'
        });
        
        // Read the original metadata file for basic info
        const originalMetadata = JSON.parse(fs.readFileSync(documentMetadataPath, 'utf-8'));
        
        // Load all the latest page data
        const analysisDir = path.join(jfkAnalysisDir, documentId);
        if (fs.existsSync(analysisDir)) {
          // Build comprehensive metadata by combining page data
          const metadataUpdated = await reconstructMetadataFromPages(documentId, originalMetadata);
          if (metadataUpdated) {
            metadata = metadataUpdated;
            console.log(`Successfully reconstructed complete metadata for ${documentId}`);
            
            // Save the updated metadata back to disk
            fs.writeFileSync(documentMetadataPath, JSON.stringify(metadata, null, 2));
            
            sendUpdate('processing', {
              status: 'metadata_updated',
              message: 'Successfully reconstructed complete document metadata'
            });
          } else {
            metadata = originalMetadata;
            console.log(`Failed to reconstruct metadata, using original for ${documentId}`);
          }
        } else {
          metadata = originalMetadata;
        }
      } catch (error) {
        console.error(`Error regenerating metadata for ${documentId}: ${error.message}`);
        // Fall back to the file-based metadata if regeneration fails
        metadata = JSON.parse(fs.readFileSync(documentMetadataPath, 'utf-8'));
      }
      
      // Check if the document has already been published
      const existingDocument = await findExistingJFKDocument(documentId);
      console.log('existingDocument', existingDocument);
      if (existingDocument) {
        sendUpdate('publishing', { 
          status: 'updating', 
          message: 'Document exists in database, checking if update is needed',
          documentDidTx: existingDocument.oip.didTx,
          pageCount: metadata.pageCount
        });
        
        // Check if existing document is incomplete and needs updating
        const isIncomplete = await isDocumentEntryIncomplete(existingDocument);
        if (isIncomplete) {
          sendUpdate('publishing', {
            status: 'updating_incomplete',
            message: 'Document exists but is incomplete. Updating with complete metadata...'
          });
          
          // Get all page references
          const pageRefs = [];
          for (let i = 1; i <= metadata.pageCount; i++) {
            const existingPage = await findExistingJFKPage(documentId, i);
            if (existingPage) {
              pageRefs.push(existingPage.oip.didTx);
            }
          }
          
          if (pageRefs.length > 0) {
            // Format document data with updated metadata
            const documentData = formatDocumentData(documentId, metadata.documentUrl, metadata, pageRefs);
            
            try {
              // Update the existing document record
              const { updateRecord } = require('../helpers/templateHelper');
              const result = await updateRecord(existingDocument.oip.didTx, documentData, "jfkFilesDocument");
              
              sendUpdate('publishing', {
                status: 'updated',
                message: 'Successfully updated document with complete metadata',
                documentDidTx: existingDocument.oip.didTx
              });
            } catch (error) {
              console.error(`Error updating document record: ${error.message}`);
              sendUpdate('error', {
                status: 'update_failed',
                message: `Failed to update document: ${error.message}`
              });
            }
          }
        }
        
        // Send final success message and end the stream
        sendUpdate('complete', { 
          status: 'success', 
          documentId,
          documentDidTx: existingDocument.oip.didTx,
          summary: metadata.summary,
          pageCount: metadata.pageCount
        });
        
        clearInterval(heartbeatInterval);
        clearTimeout(stallTimeout);
        res.end();
        return;
      }
      
      // Special handling when document exists on disk but not in database
      if (existingDocument === null) {
        console.log(`Document ${documentId} exists on disk but not in database, proceeding to publish it`);
        
        sendUpdate('processing', { 
          status: 'publishing_from_disk',
          message: 'Document files exist but not published to database, awaiting publishing',
          documentId
        });
        
        // Check if all the formatted JSON files exist
        const documentAnalysisDir = path.join(jfkAnalysisDir, documentId);
        const documentFormattedPath = path.join(jfkAnalysisDir, `${documentId}-formatted.json`);
        
        // Skip to the publishing steps with the existing files
        const pageRefs = [];
        const formattedPagePaths = [];

        // Get all page references
        for (let i = 1; i <= metadata.pageCount; i++) {
          // Check if formatted JSON file exists
          const formattedPagePath = path.join(jfkAnalysisDir, documentId, `page-${i}-formatted.json`);
          if (fs.existsSync(formattedPagePath)) {
            formattedPagePaths.push(formattedPagePath);
          } else {
            // If formatted file doesn't exist, create it now
            const pageJsonPath = path.join(documentAnalysisDir, `page-${i}.json`);
            if (fs.existsSync(pageJsonPath)) {
              try {
                const pageData = JSON.parse(fs.readFileSync(pageJsonPath, 'utf-8'));
                // Format the page data
                const formattedPageData = formatPageData(pageData, pageData.imagePath, documentId, i);
                // Create the directory if it doesn't exist
                if (!fs.existsSync(path.join(jfkAnalysisDir, documentId))) {
                  fs.mkdirSync(path.join(jfkAnalysisDir, documentId), { recursive: true });
                }
                // Save the formatted page data
                fs.writeFileSync(formattedPagePath, JSON.stringify(formattedPageData, null, 2));
                formattedPagePaths.push(formattedPagePath);
              } catch (error) {
                console.error(`Error formatting page ${i}: ${error.message}`);
              }
            }
          }
        }
        
        // Publish each page if not already published
        for (let i = 0; i < formattedPagePaths.length; i++) {
          const pageNum = i + 1;
          
          // Check if this page has already been published
          const existingPage = await findExistingJFKPage(documentId, pageNum);
          
          if (existingPage) {
            // Use the existing page reference
            pageRefs.push(existingPage.oip.didTx);
            
            sendUpdate('publishing', { 
              status: 'skipped', 
              message: `Page ${pageNum}/${formattedPagePaths.length} already exists`,
              pageNumber: pageNum,
              didTx: existingPage.oip.didTx
            });
            
            continue; // Skip to the next page
          }
          
          // Load the formatted page data
          const pageData = JSON.parse(fs.readFileSync(formattedPagePaths[i], 'utf-8'));
          
          // Publish the page
          const publishResult = await publishJFKContent(pageData, "jfkFilesPageOfDocument");
          
          // Save transaction info
          pageRefs.push(publishResult.didTx);
          
          sendUpdate('publishing', { 
            status: 'progress', 
            message: `Published page ${pageNum}/${formattedPagePaths.length}`,
            pageNumber: pageNum,
            txid: publishResult.txid,
            didTx: publishResult.didTx
          });
        }
        
        // Format and publish document data
        const documentData = formatDocumentData(documentId, metadata.documentUrl, metadata, pageRefs);
        
        // Save the formatted document data for future reference
        const documentDataPath = path.join(jfkAnalysisDir, `${documentId}-formatted.json`);
        fs.writeFileSync(documentDataPath, JSON.stringify(documentData, null, 2));
        
        // Publish the document
        try {
          const documentPublish = await publishJFKContent(documentData, "jfkFilesDocument");
          
          sendUpdate('publishing', { 
            status: 'complete', 
            message: 'Document and pages published successfully',
            documentTxid: documentPublish.txid,
            documentDidTx: documentPublish.didTx,
            pageCount: formattedPagePaths.length,
            pageRefs: pageRefs
          });
          
          // Send final success message
          sendUpdate('complete', { 
            status: 'success', 
            documentId,
            documentDidTx: documentPublish.didTx,
            summary: metadata.summary,
            pageCount: formattedPagePaths.length,
            message: 'Document successfully published to database with complete metadata'
          });
        } catch (error) {
          console.error(`Error publishing document: ${error.message}`);
          sendUpdate('error', {
            status: 'publishing_error',
            message: `Error publishing document: ${error.message}`,
            error: true
          });
        }
        
        // End the connection when done
        clearInterval(heartbeatInterval);
        clearTimeout(stallTimeout);
        res.end();
        return;
      }
      
      // Standard publishing of cached files
      sendUpdate('publishing', { 
        status: 'starting', 
        message: 'Document was processed previously, proceeding to publishing step' 
      });
      
      // Find all the formatted page files
      const formattedPagePaths = [];
      for (let i = 1; i <= metadata.pageCount; i++) {
        const formattedPagePath = path.join(jfkAnalysisDir, documentId, `page-${i}-formatted.json`);
        if (fs.existsSync(formattedPagePath)) {
          formattedPagePaths.push(formattedPagePath);
        }
      }
      
      // Publish pages and document
      const pageRefs = [];
      for (let i = 0; i < formattedPagePaths.length; i++) {
        const pageNum = i + 1;
        
        // Check if this page has already been published
        const existingPage = await findExistingJFKPage(documentId, pageNum);
        
        if (existingPage) {
          // Use the existing page reference
          pageRefs.push(existingPage.oip.didTx);
          
          sendUpdate('publishing', { 
            status: 'skipped', 
            message: `Page ${pageNum}/${formattedPagePaths.length} already exists`,
            pageNumber: pageNum,
            didTx: existingPage.oip.didTx
          });
          
          continue; // Skip to the next page
        }
        
        // Load the formatted page data
        const pageData = JSON.parse(fs.readFileSync(formattedPagePaths[i], 'utf-8'));
        
        // Publish the page
        const publishResult = await publishJFKContent(pageData, "jfkFilesPageOfDocument");
        
        // Save transaction info
        pageRefs.push(publishResult.didTx);
        
        sendUpdate('publishing', { 
          status: 'progress', 
          message: `Published page ${pageNum}/${formattedPagePaths.length}`,
          pageNumber: pageNum,
          txid: publishResult.txid,
          didTx: publishResult.didTx
        });
      }
      
      // Format and publish document data
      const documentDataPath = path.join(jfkAnalysisDir, `${documentId}-formatted.json`);
      let documentData;
      
      if (fs.existsSync(documentDataPath)) {
        // Load existing formatted document data
        documentData = JSON.parse(fs.readFileSync(documentDataPath, 'utf-8'));
        // Update the page references
        documentData.jfkFilesDocument.pages = pageRefs;
      } else {
        // Format the document data from scratch
        documentData = formatDocumentData(documentId, documentUrl, metadata, pageRefs);
        // Save the formatted document data
        fs.writeFileSync(documentDataPath, JSON.stringify(documentData, null, 2));
      }
      
      // Publish the document
      const documentPublish = await publishJFKContent(documentData, "jfkFilesDocument");
      
      sendUpdate('publishing', { 
        status: 'complete', 
        message: 'Document and pages published successfully',
        documentTxid: documentPublish.txid,
        documentDidTx: documentPublish.didTx,
        pageCount: formattedPagePaths.length,
        pageRefs: pageRefs
      });
      
      // Send final success message
      sendUpdate('complete', { 
        status: 'success', 
        documentId,
        documentDidTx: documentPublish.didTx,
        summary: metadata.summary,
        pageCount: formattedPagePaths.length
      });
      
      // End the connection
      clearInterval(heartbeatInterval);
      clearTimeout(stallTimeout);
      res.end();
      return;
    }
    
    // If the document hasn't been processed yet, continue with normal flow
    console.log('documentUrl', documentUrl);
    
    // 1. Download the PDF file
    const pdfPath = await downloadPdf(documentUrl, documentId, sendUpdate);
    
    // If PDF download failed, end the process
    if (pdfPath === null) {
      sendUpdate('complete', { 
        status: 'error', 
        message: 'Process could not continue because the PDF file could not be downloaded',
        documentId
      });
      
      clearInterval(heartbeatInterval);
      clearTimeout(stallTimeout);
      res.end();
      return;
    }
    
    // 2. Convert PDF to images
    const imagePaths = await convertPdfToImages(pdfPath, documentId, sendUpdate);
    console.log('imagePaths', imagePaths);
    
    // If PDF conversion failed, end the process
    if (imagePaths === null) {
      sendUpdate('complete', { 
        status: 'error', 
        message: 'Process could not continue because the PDF could not be converted to images',
        documentId
      });
      
      clearInterval(heartbeatInterval);
      clearTimeout(stallTimeout);
      res.end();
      return;
    }
    
    // 3. Analyze each image with Grok Vision API
    const analysisResults = await analyzeImagesWithGrok(imagePaths, documentId, sendUpdate);
    console.log('analysisResults', analysisResults);
    
    // If analysis failed, end the process
    if (analysisResults === null) {
      sendUpdate('complete', { 
        status: 'error', 
        message: 'Process could not continue because the image analysis failed',
        documentId
      });
      
      clearInterval(heartbeatInterval);
      clearTimeout(stallTimeout);
      res.end();
      return;
    }
    
    // 4. Generate and save metadata file
    const metadata = generateMetadata(documentUrl, documentId, imagePaths, analysisResults);
    console.log('metadata', metadata);
    
    // 5. Format and publish each page
    sendUpdate('publishing', { status: 'starting', message: 'Formatting and publishing pages' });
    
    const pageRefs = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const pageNum = i + 1;
      
      // Check if this page has already been published
      const existingPage = await findExistingJFKPage(documentId, pageNum);
      
      if (existingPage) {
        // Use the existing page reference
        pageRefs.push(existingPage.oip.didTx);
        
        sendUpdate('publishing', { 
          status: 'skipped', 
          message: `Page ${pageNum}/${imagePaths.length} already exists`,
          pageNumber: pageNum,
          didTx: existingPage.oip.didTx
        });
        
        continue; // Skip to the next page
      }
      
      // Format the page data
      const pageData = formatPageData(analysisResults[i], imagePaths[i], documentId, pageNum);
      
      // Save formatted page data to file
      const pageDataPath = path.join(jfkAnalysisDir, documentId, `page-${pageNum}-formatted.json`);
      fs.writeFileSync(pageDataPath, JSON.stringify(pageData, null, 2));
      
      // Publish the page
      const publishResult = await publishJFKContent(pageData, "jfkFilesPageOfDocument");
      
      // Save transaction info
      pageRefs.push(publishResult.didTx);
      
      sendUpdate('publishing', { 
        status: 'progress', 
        message: `Published page ${pageNum}/${imagePaths.length}`,
        pageNumber: pageNum,
        txid: publishResult.txid,
        didTx: publishResult.didTx
      });
    }
    
    // 6. Check if the document has already been published
    const existingDocument = await findExistingJFKDocument(documentId);
    
    if (existingDocument) {
      sendUpdate('publishing', { 
        status: 'complete', 
        message: 'Document already exists, using existing reference',
        documentDidTx: existingDocument.oip.didTx,
        pageCount: imagePaths.length,
        pageRefs: pageRefs
      });
      
      // 7. Send final success message
      sendUpdate('complete', { 
        status: 'success', 
        documentId,
        documentDidTx: existingDocument.oip.didTx,
        summary: metadata.summary,
        pageCount: imagePaths.length
      });
      
      clearInterval(heartbeatInterval);
      clearTimeout(stallTimeout);
      res.end();
      return;
    }
    
    // Format and publish document data
    const documentData = formatDocumentData(documentId, documentUrl, metadata, pageRefs);
    
    // Save formatted document data to file
    const documentDataPath = path.join(jfkAnalysisDir, `${documentId}-formatted.json`);
    fs.writeFileSync(documentDataPath, JSON.stringify(documentData, null, 2));
    
    // Publish the document
    const documentPublish = await publishJFKContent(documentData, "jfkFilesDocument");
    
    sendUpdate('publishing', { 
      status: 'complete', 
      message: 'Document and pages published successfully',
      documentTxid: documentPublish.txid,
      documentDidTx: documentPublish.didTx,
      pageCount: imagePaths.length,
      pageRefs: pageRefs
    });
    
    // Send final success message
    sendUpdate('complete', { 
      status: 'success', 
      documentId,
      documentDidTx: documentPublish.didTx,
      summary: metadata.summary,
      pageCount: imagePaths.length
    });
    
    clearInterval(heartbeatInterval);
    clearTimeout(stallTimeout);
    res.end();
    
  } catch (error) {
    console.error('Error processing JFK document:', error);
    
    // Try to send error through SSE if possible
    if (!res.headersSent) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
    }
    
    try {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: error.message || 'Unknown error occurred' })}\n\n`);
      res.end();
    } catch (streamError) {
      console.error('Error sending error through stream:', streamError);
    }
  }
});

// Add a route to serve JFK document media files
router.get('/media', (req, res) => {
  const { id, type, filename, getLatestPageData } = req.query;
  
  if (!id || !type) {
    return res.status(400).send("Missing id or type parameter");
  }
  
  let filePath;
  if (type === 'pdf') {
    filePath = path.join(jfkPdfDir, `jfk-doc-${id}.pdf`);
    
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).send(`File not found: ${filePath}`);
    }
  } else if (type === 'image') {
    if (filename) {
      // Prevent directory traversal attacks
      const sanitizedFilename = path.basename(filename);
      
      // Check if filename contains a path (like "2ab393178a/page-1.png")
      if (filename.includes('/')) {
        const parts = filename.split('/');
        const docId = parts[0];
        const imgFile = path.basename(parts[1]);
        
        // Make sure document ID matches requested ID
        if (docId === id) {
          filePath = path.join(jfkImagesDir, docId, imgFile);
          
          // If file doesn't exist, try alternate formats
          if (!fs.existsSync(filePath)) {
            // Try to extract page number from filename (e.g., "page-2.png" or "page-02.png")
            const pageMatch = imgFile.match(/page-(\d+)/i);
            if (pageMatch) {
              const pageNum = pageMatch[1];
              // Try both formats: with and without leading zero
              const alternateFilenames = [
                `page-${pageNum}.png`, // page-1.png
                `page-${pageNum.padStart(2, '0')}.png`, // page-01.png
              ];
              
              for (const altName of alternateFilenames) {
                const altPath = path.join(jfkImagesDir, docId, altName);
                if (fs.existsSync(altPath)) {
                  filePath = altPath;
                  console.log(`Found alternative file: ${altPath}`);
                  break;
                }
              }
            }
          }
        } else {
          return res.status(400).send("Document ID in filename doesn't match requested ID");
        }
      } else {
        // Simple filename without path
        filePath = path.join(jfkImagesDir, id, sanitizedFilename);
        
        // If file doesn't exist, try alternate formats
        if (!fs.existsSync(filePath)) {
          // Try to extract page number from filename
          const pageMatch = sanitizedFilename.match(/page-(\d+)/i);
          if (pageMatch) {
            const pageNum = pageMatch[1];
            // Try both formats: with and without leading zero
            const alternateFilenames = [
              `page-${pageNum}.png`, // page-1.png
              `page-${pageNum.padStart(2, '0')}.png`, // page-01.png
            ];
            
            for (const altName of alternateFilenames) {
              const altPath = path.join(jfkImagesDir, id, altName);
              if (fs.existsSync(altPath)) {
                filePath = altPath;
                console.log(`Found alternative file: ${altPath}`);
                break;
              }
            }
          }
        }
      }
    } else {
      // For backward compatibility - existing page-number based logic
      const pageMatch = id.match(/page-(\d+)/i);
      const pageNum = pageMatch ? pageMatch[1] : '1';
      const imagesDir = path.join(jfkImagesDir, id);
      
      if (fs.existsSync(imagesDir)) {
        // Check if there's a specific page requested
        if (pageMatch) {
          // Try both formats: with and without leading zero
          const pageFilePaths = [
            path.join(imagesDir, `page-${pageNum}.png`), // page-1.png
            path.join(imagesDir, `page-${pageNum.padStart(2, '0')}.png`), // page-01.png
          ];
          
          // Use the first file that exists
          for (const pagePath of pageFilePaths) {
            if (fs.existsSync(pagePath)) {
              filePath = pagePath;
              break;
            }
          }
        } else {
          // Get the first image in the directory
          const files = fs.readdirSync(imagesDir).filter(f => f.endsWith('.png'));
          if (files.length > 0) {
            filePath = path.join(imagesDir, files[0]);
          }
        }
      }
    }
    
    // Send the image file
    if (filePath && fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).send(`File not found: ${filePath || 'unknown'}`);
    }
  } else if (type === 'analysis') {
    const metadataPath = path.join(jfkAnalysisDir, `${id}-metadata.json`);
    
    // Check if we need to get the latest page data
    if (getLatestPageData === 'true' && fs.existsSync(metadataPath)) {
      try {
        // Read the base metadata file
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        
        // Directory for page analysis files
        const analysisDir = path.join(jfkAnalysisDir, id);
        
        // Update each page with the latest data if available
        if (fs.existsSync(analysisDir)) {
          let metadataUpdated = false;
          
          for (let i = 0; i < metadata.pages.length; i++) {
            const pageNum = metadata.pages[i].pageNumber;
            const pageJsonPath = path.join(analysisDir, `page-${pageNum}.json`);
            
            if (fs.existsSync(pageJsonPath)) {
              try {
                // Read the latest page data
                const pageData = JSON.parse(fs.readFileSync(pageJsonPath, 'utf-8'));
                
                // Update the metadata with this latest page data
                metadata.pages[i] = {
                  pageNumber: pageNum,
                  imagePath: pageData.imagePath || metadata.pages[i].imagePath,
                  summary: pageData.summary || metadata.pages[i].summary,
                  fullText: pageData.fullText || metadata.pages[i].fullText,
                  dates: pageData.dates || [],
                  names: pageData.names || [],
                  places: pageData.places || [],
                  objects: pageData.objects || []
                };
                
                metadataUpdated = true;
              } catch (pageError) {
                console.error(`Error reading latest data for page ${pageNum}:`, pageError);
                // Keep the existing page data if there's an error
              }
            }
          }
          
          // If updates were made, save back to the metadata file
          if (metadataUpdated) {
            console.log(`Updating metadata file for document ${id} with latest page data`);
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
          }
          
          // Return the dynamically updated metadata
          return res.json(metadata);
        }
      } catch (error) {
        console.error(`Error generating dynamic metadata for ${id}:`, error);
        // Fall back to the static file if there's an error
      }
    }
    
    // Default: serve the static metadata file
    if (fs.existsSync(metadataPath)) {
      res.sendFile(metadataPath);
    } else {
      res.status(404).send(`File not found: ${metadataPath}`);
    }
  } else {
    return res.status(400).send("Invalid type parameter");
  }
});

// Add a route to list all processed JFK documents
router.get('/list', async (req, res) => {
  try {
    // Get pagination parameters from query
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // Get search parameter (optional)
    const search = req.query.search || '';
    
    // Get filtering parameters (optional)
    const excludeNoAnalysis = req.query.excludeNoAnalysis === 'true';
    const onlyNoAnalysis = req.query.onlyNoAnalysis === 'true';
    
    // Get sort parameters (optional)
    const sortBy = req.query.sortBy || 'id'; // Default sort by ID
    const sortOrder = req.query.sortOrder || 'asc'; // Default ascending order
    
    // Read the analysis directory to get all document IDs
    const allDocuments = [];
    
    // Get all files/folders in the analysis directory
    const files = fs.readdirSync(jfkAnalysisDir);
    
    // Filter for document IDs (look for metadata files)
    for (const file of files) {
      // Only include metadata JSON files
      if (file.endsWith('-metadata.json')) {
        // Extract document ID from filename
        const docId = file.replace('-metadata.json', '');
        
        try {
          // Read the metadata file to get additional info
          const metadataPath = path.join(jfkAnalysisDir, file);
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
          
          // Check if the document has valid analysis
          const hasAnalysis = !(metadata.summary?.includes('No analysis available'));
          
          // Add document to list with key details
          allDocuments.push({
            id: docId,
            name: `JFK Document ${docId}`,
            url: metadata.documentUrl,
            pageCount: metadata.pageCount,
            processingDate: metadata.processingDate,
            summary: metadata.summary?.substring(0, 200) + (metadata.summary?.length > 200 ? '...' : ''),
            names: metadata.allNames?.slice(0, 5),
            hasAnalysis: hasAnalysis
          });
        } catch (err) {
          console.error(`Error reading metadata for ${docId}:`, err);
          // Still include the document even if metadata read fails
          allDocuments.push({
            id: docId,
            name: `JFK Document ${docId}`,
            error: 'Metadata read error',
            hasAnalysis: false
          });
        }
      }
    }
    
    // Apply filtering
    let filteredDocuments = allDocuments;
    
    // Filter by search term if provided
    if (search) {
      filteredDocuments = filteredDocuments.filter(doc => 
        doc.id.toLowerCase().includes(search.toLowerCase()) ||
        doc.summary?.toLowerCase().includes(search.toLowerCase()) ||
        doc.names?.some(name => name.toLowerCase().includes(search.toLowerCase()))
      );
    }
    
    // Apply analysis filtering (onlyNoAnalysis takes precedence if both are set)
    if (onlyNoAnalysis) {
      // Show only documents WITHOUT analysis
      filteredDocuments = filteredDocuments.filter(doc => !doc.hasAnalysis);
    } else if (excludeNoAnalysis) {
      // Show only documents WITH analysis
      filteredDocuments = filteredDocuments.filter(doc => doc.hasAnalysis);
    }
    
    // Sort documents based on sort parameters
    filteredDocuments.sort((a, b) => {
      if (sortBy === 'date') {
        // Sort by processing date
        return sortOrder === 'asc' 
          ? new Date(a.processingDate || 0) - new Date(b.processingDate || 0)
          : new Date(b.processingDate || 0) - new Date(a.processingDate || 0);
      } else if (sortBy === 'pageCount') {
        // Sort by page count
        return sortOrder === 'asc'
          ? (a.pageCount || 0) - (b.pageCount || 0)
          : (b.pageCount || 0) - (a.pageCount || 0);
      } else {
        // Default: Sort by ID alphabetically
        return sortOrder === 'asc'
          ? a.id.localeCompare(b.id)
          : b.id.localeCompare(a.id);
      }
    });
    
    // Apply pagination
    const paginatedDocuments = filteredDocuments.slice(offset, offset + limit);
    
    // Calculate pagination metadata
    const total = filteredDocuments.length;
    const totalPages = Math.ceil(total / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;
    
    // Return the results
    res.status(200).json({
      documents: paginatedDocuments,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext,
        hasPrev
      },
      sorting: {
        sortBy,
        sortOrder
      },
      filtering: {
        search: search || null,
        excludeNoAnalysis,
        onlyNoAnalysis
      }
    });
    
  } catch (error) {
    console.error('Error listing JFK documents:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// Add a route to search JFK documents by metadata
router.get('/search', async (req, res) => {
  try {
    // Get search parameters
    const { person, place, date, object, text } = req.query;
    
    // Get pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // Get sorting parameters
    const sortBy = req.query.sortBy || 'relevance'; // relevance, date, id
    const sortOrder = req.query.sortOrder || 'desc'; // asc, desc
    
    if (!person && !place && !date && !object && !text) {
      return res.status(400).json({ 
        error: 'At least one search parameter is required (person, place, date, object, or text)' 
      });
    }
    
    // Read all document metadata files
    const allDocuments = [];
    const files = fs.readdirSync(jfkAnalysisDir);
    
    // Filter for metadata files
    const metadataFiles = files.filter(file => file.endsWith('-metadata.json'));
    
    // Function to calculate relevance score
    const calculateRelevance = (metadata, searchTerms) => {
      let score = 0;
      
      // Check each page for mentions
      metadata.pages.forEach(page => {
        // Score based on full text matching
        if (page.fullText) {
          searchTerms.forEach(term => {
            // Count occurrences in full text (case insensitive)
            const regex = new RegExp(term, 'gi');
            const matches = page.fullText.match(regex);
            if (matches) {
              score += matches.length;
            }
          });
        }
      });
      
      // Boost score for metadata field matches
      searchTerms.forEach(term => {
        // Check names
        if (metadata.allNames && metadata.allNames.some(name => 
          name.toLowerCase().includes(term.toLowerCase()))) {
          score += 10; // Higher weight for exact metadata matches
        }
        
        // Check places
        if (metadata.allPlaces && metadata.allPlaces.some(place => 
          place.toLowerCase().includes(term.toLowerCase()))) {
          score += 8;
        }
        
        // Check dates
        if (metadata.allDates && metadata.allDates.some(date => 
          date.toLowerCase().includes(term.toLowerCase()))) {
          score += 5;
        }
        
        // Check objects
        if (metadata.allObjects && metadata.allObjects.some(object => 
          object.toLowerCase().includes(term.toLowerCase()))) {
          score += 5;
        }
        
        // Check summary
        if (metadata.summary && metadata.summary.toLowerCase().includes(term.toLowerCase())) {
          score += 3;
        }
      });
      
      return score;
    };
    
    // Process each metadata file
    for (const file of metadataFiles) {
      try {
        const metadataPath = path.join(jfkAnalysisDir, file);
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        const docId = file.replace('-metadata.json', '');
        
        // Initialize match flags
        let personMatch = !person; // If person not specified, consider it a match
        let placeMatch = !place;   // If place not specified, consider it a match
        let dateMatch = !date;     // If date not specified, consider it a match
        let objectMatch = !object; // If object not specified, consider it a match
        let textMatch = !text;     // If text not specified, consider it a match
        
        // Check person match
        if (person && metadata.allNames) {
          personMatch = metadata.allNames.some(name => 
            name.toLowerCase().includes(person.toLowerCase())
          );
        }
        
        // Check place match
        if (place && metadata.allPlaces) {
          placeMatch = metadata.allPlaces.some(p => 
            p.toLowerCase().includes(place.toLowerCase())
          );
        }
        
        // Check date match
        if (date && metadata.allDates) {
          dateMatch = metadata.allDates.some(d => 
            d.toLowerCase().includes(date.toLowerCase())
          );
        }
        
        // Check object match
        if (object && metadata.allObjects) {
          objectMatch = metadata.allObjects.some(obj => 
            obj.toLowerCase().includes(object.toLowerCase())
          );
        }
        
        // Check text match (in full text or summary)
        if (text) {
          // Check in full text
          textMatch = metadata.fullText && 
            metadata.fullText.toLowerCase().includes(text.toLowerCase());
            
          // If not found in full text, check in summary
          if (!textMatch) {
            textMatch = metadata.summary && 
              metadata.summary.toLowerCase().includes(text.toLowerCase());
          }
          
          // If still not found, check individual pages
          if (!textMatch && metadata.pages) {
            textMatch = metadata.pages.some(page => 
              page.fullText && page.fullText.toLowerCase().includes(text.toLowerCase())
            );
          }
        }
        
        // If all specified criteria match, include this document
        if (personMatch && placeMatch && dateMatch && objectMatch && textMatch) {
          // Build search terms array for relevance calculation
          const searchTerms = [];
          if (person) searchTerms.push(person);
          if (place) searchTerms.push(place);
          if (date) searchTerms.push(date);
          if (object) searchTerms.push(object);
          if (text) searchTerms.push(text);
          
          // Calculate relevance score
          const relevance = calculateRelevance(metadata, searchTerms);
          
          // Find pages with specific matches
          const matchingPages = [];
          if (metadata.pages) {
            metadata.pages.forEach(page => {
              const pageMatches = {
                pageNumber: page.pageNumber,
                matches: []
              };
              
              let hasMatch = false;
              
              // Check for person match in this page
              if (person && page.names && page.names.some(name => 
                name.toLowerCase().includes(person.toLowerCase())
              )) {
                pageMatches.matches.push({ type: 'person', term: person });
                hasMatch = true;
              }
              
              // Check for place match in this page
              if (place && page.places && page.places.some(p => 
                p.toLowerCase().includes(place.toLowerCase())
              )) {
                pageMatches.matches.push({ type: 'place', term: place });
                hasMatch = true;
              }
              
              // Check for date match in this page
              if (date && page.dates && page.dates.some(d => 
                d.toLowerCase().includes(date.toLowerCase())
              )) {
                pageMatches.matches.push({ type: 'date', term: date });
                hasMatch = true;
              }
              
              // Check for object match in this page
              if (object && page.objects && page.objects.some(obj => 
                obj.toLowerCase().includes(object.toLowerCase())
              )) {
                pageMatches.matches.push({ type: 'object', term: object });
                hasMatch = true;
              }
              
              // Check for text match in this page
              if (text && page.fullText && 
                page.fullText.toLowerCase().includes(text.toLowerCase())
              ) {
                pageMatches.matches.push({ type: 'text', term: text });
                hasMatch = true;
              }
              
              if (hasMatch) {
                matchingPages.push(pageMatches);
              }
            });
          }
          
          // Add document to results
          allDocuments.push({
            id: docId,
            name: `JFK Document ${docId}`,
            url: metadata.documentUrl,
            pageCount: metadata.pageCount,
            processingDate: metadata.processingDate,
            summary: metadata.summary?.substring(0, 200) + (metadata.summary?.length > 200 ? '...' : ''),
            names: metadata.allNames?.slice(0, 10),
            places: metadata.allPlaces?.slice(0, 10),
            dates: metadata.allDates?.slice(0, 10),
            relevance: relevance,
            matchingPages: matchingPages
          });
        }
      } catch (err) {
        console.error(`Error processing metadata file ${file}:`, err);
      }
    }
    
    // Sort documents based on sort parameter
    if (sortBy === 'relevance') {
      allDocuments.sort((a, b) => 
        sortOrder === 'asc' ? a.relevance - b.relevance : b.relevance - a.relevance
      );
    } else if (sortBy === 'date') {
      allDocuments.sort((a, b) => {
        const dateA = new Date(a.processingDate || 0);
        const dateB = new Date(b.processingDate || 0);
        return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
      });
    } else { // sortBy === 'id'
      allDocuments.sort((a, b) => {
        return sortOrder === 'asc' ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
      });
    }
    
    // Apply pagination
    const paginatedDocuments = allDocuments.slice(offset, offset + limit);
    
    // Calculate pagination metadata
    const total = allDocuments.length;
    const totalPages = Math.ceil(total / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;
    
    // Return the results
    res.status(200).json({
      documents: paginatedDocuments,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext,
        hasPrev
      },
      sorting: {
        sortBy,
        sortOrder
      },
      search: {
        person: person || null,
        place: place || null,
        date: date || null,
        object: object || null,
        text: text || null
      }
    });
    
  } catch (error) {
    console.error('Error searching JFK documents:', error);
    res.status(500).json({ error: 'Failed to search documents' });
  }
});

// Add a route to check the status of document processing via SSE
router.get('/process/status', (req, res) => {
  const { documentId } = req.query;
  
  if (!documentId) {
    return res.status(400).json({ error: 'Document ID is required' });
  }
  
  // Sanitize the document ID
  const sanitizedId = sanitizeDocumentId(documentId);
  
  console.log(`Status connection requested for document: ${documentId} (sanitized: ${sanitizedId})`);
  
  // Set up SSE connection and communication utilities
  const { heartbeatInterval, stallTimeout, sendUpdate } = setupSSEConnection(res, documentId);
  
  // Immediately send a connection established event
  sendUpdate('connected', { 
    status: 'monitoring',
    message: `Monitoring status for document ${documentId}`,
    timestamp: Date.now()
  });
  
  // Check if processing is already complete by looking for metadata file
  const documentMetadataPath = path.join(jfkAnalysisDir, `${sanitizedId}-metadata.json`);
  if (fs.existsSync(documentMetadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(documentMetadataPath, 'utf-8'));
      
      // Check if the document has already been published to the database
      findExistingJFKDocument(documentId).then(async existingDocument => {
        // Check if document exists and is complete
        if (existingDocument && !(await isDocumentEntryIncomplete(existingDocument))) {
          sendUpdate('complete', { 
            status: 'success', 
            documentId,
            documentDidTx: existingDocument.oip.didTx,
            summary: metadata.summary,
            pageCount: metadata.pageCount,
            message: 'Document processing already complete'
          });
          
          // End the SSE connection since processing is complete
          clearInterval(heartbeatInterval);
          clearTimeout(stallTimeout);
          res.end();
        } 
        // Check if document exists but is incomplete
        else if (existingDocument && await isDocumentEntryIncomplete(existingDocument)) {
          sendUpdate('processing', { 
            status: 'fixing',
            message: 'Document exists in database but with incomplete metadata. Attempting to repair.',
            documentId
          });
          
          // Build an updated document entry
          const updatedDocumentData = await buildUpdatedDocumentEntry(existingDocument, sanitizedId, metadata);
          
          if (updatedDocumentData) {
            try {
              // Update the document record in the database
              const { updateRecord } = require('../helpers/templateHelper');
              const result = await updateRecord(existingDocument.oip.didTx, updatedDocumentData, "jfkFilesDocument");
              
              sendUpdate('complete', { 
                status: 'repaired', 
                documentId,
                documentDidTx: existingDocument.oip.didTx,
                message: 'Document record has been repaired with complete metadata.',
                pageCount: metadata.pageCount
              });
              
              // End the SSE connection since repair is complete
              clearInterval(heartbeatInterval);
              clearTimeout(stallTimeout);
              res.end();
              return;
            } catch (error) {
              console.error(`Error updating document record: ${error.message}`);
              sendUpdate('error', {
                status: 'repair_failed',
                message: `Failed to repair document record: ${error.message}`,
                documentId
              });
              
              // We'll continue with other checks below since the update failed
            }
          } else {
            sendUpdate('processing', {
              status: 'repair_failed',
              message: 'Failed to build updated document data, will check for alternative repair options',
              documentId
            });
          }
          // If we couldn't build the updated document data, continue checking other conditions
        } 
        else {
          sendUpdate('processing', { 
            status: 'publishing_from_disk',
            message: 'Document files exist but not published to database, awaiting publishing',
            documentId
          });
          
          // Check if all the formatted JSON files exist, which would indicate complete processing
          const documentAnalysisDir = path.join(jfkAnalysisDir, sanitizedId);
          const documentFormattedPath = path.join(jfkAnalysisDir, `${sanitizedId}-formatted.json`);
          
          if (fs.existsSync(documentAnalysisDir) && fs.existsSync(documentFormattedPath)) {
            // Count how many formatted page files exist
            try {
              const files = fs.readdirSync(documentAnalysisDir);
              const formattedPageFiles = files.filter(file => file.match(/page-\d+-formatted\.json/));
              
              // If we have formatted JSON for all pages, processing is actually complete
              if (formattedPageFiles.length === metadata.pageCount) {
                sendUpdate('processing', { 
                  status: 'publishing',
                  message: 'Document processing complete. All files exist on disk. Initiating publishing to database...',
                  pageCount: metadata.pageCount
                });
                
                try {
                  // Find all the formatted page files
                  const formattedPagePaths = [];
                  for (let i = 1; i <= metadata.pageCount; i++) {
                    const formattedPagePath = path.join(jfkAnalysisDir, sanitizedId, `page-${i}-formatted.json`);
                    if (fs.existsSync(formattedPagePath)) {
                      formattedPagePaths.push(formattedPagePath);
                    }
                  }
                  
                  // Publish each page if not already published
                  const pageRefs = [];
                  for (let i = 0; i < formattedPagePaths.length; i++) {
                    const pageNum = i + 1;
                    
                    // Check if this page has already been published
                    const existingPage = await findExistingJFKPage(documentId, pageNum);
                    
                    if (existingPage) {
                      // Use the existing page reference
                      pageRefs.push(existingPage.oip.didTx);
                      
                      sendUpdate('publishing', { 
                        status: 'skipped', 
                        message: `Page ${pageNum}/${formattedPagePaths.length} already exists`,
                        pageNumber: pageNum,
                        didTx: existingPage.oip.didTx
                      });
                      
                      continue; // Skip to the next page
                    }
                    
                    // Load the formatted page data
                    const pageData = JSON.parse(fs.readFileSync(formattedPagePaths[i], 'utf-8'));
                    
                    // Publish the page
                    const publishResult = await publishJFKContent(pageData, "jfkFilesPageOfDocument");
                    
                    // Save transaction info
                    pageRefs.push(publishResult.didTx);
                    
                    sendUpdate('publishing', { 
                      status: 'progress', 
                      message: `Published page ${pageNum}/${formattedPagePaths.length}`,
                      pageNumber: pageNum,
                      txid: publishResult.txid,
                      didTx: publishResult.didTx
                    });
                  }
                  
                  // Format and publish document data
                  const documentDataPath = path.join(jfkAnalysisDir, `${sanitizedId}-formatted.json`);
                  let documentData;
                  
                  if (fs.existsSync(documentDataPath)) {
                    // Load existing formatted document data
                    documentData = JSON.parse(fs.readFileSync(documentDataPath, 'utf-8'));
                    // Update the page references
                    documentData.jfkFilesDocument.pages = pageRefs;
                  } else {
                    // Format the document data from scratch
                    documentData = formatDocumentData(sanitizedId, metadata.documentUrl, metadata, pageRefs);
                    // Save the formatted document data
                    fs.writeFileSync(documentDataPath, JSON.stringify(documentData, null, 2));
                  }
                  
                  // Publish the document
                  const documentPublish = await publishJFKContent(documentData, "jfkFilesDocument");
                  
                  sendUpdate('publishing', { 
                    status: 'complete', 
                    message: 'Document and pages published successfully',
                    documentTxid: documentPublish.txid,
                    documentDidTx: documentPublish.didTx,
                    pageCount: formattedPagePaths.length,
                    pageRefs: pageRefs
                  });
                  
                  // Send final success message and end the stream
                  sendUpdate('complete', { 
                    status: 'success', 
                    documentId,
                    documentDidTx: documentPublish.didTx,
                    summary: metadata.summary,
                    pageCount: formattedPagePaths.length,
                    message: 'Document successfully published to database'
                  });
                  
                } catch (error) {
                  console.error(`Error during publishing: ${error.message}`);
                  sendUpdate('error', {
                    status: 'publishing_error',
                    message: `Error publishing document: ${error.message}`,
                    documentId
                  });
                }
                
                // End the connection when done
                clearInterval(heartbeatInterval);
                clearTimeout(stallTimeout);
                res.end();
                return;
              }
            } catch (error) {
              console.error(`Error checking formatted files: ${error.message}`);
            }
          } else if (fs.existsSync(documentAnalysisDir)) {
            // If analysis directory exists but formatted files don't, check for raw JSON files
            try {
              const files = fs.readdirSync(documentAnalysisDir);
              const rawJsonFiles = files.filter(file => file.match(/page-\d+\.json$/));
              
              if (rawJsonFiles.length > 0) {
                // We have some raw JSON files but formatting was not completed
                sendUpdate('processing', { 
                  status: 'partial',
                  message: 'Document analysis is complete but formatting was not finished. Waiting for formatting to complete.',
                  documentId,
                  rawFilesCount: rawJsonFiles.length,
                  expectedPageCount: metadata.pageCount
                });
                
                // Keep the connection open as processing should continue
                return;
              }
            } catch (error) {
              console.error(`Error checking raw JSON files: ${error.message}`);
            }
          }
          
          // In this case, keep the connection open to monitor the publishing process
        }
      }).catch(error => {
        console.error(`Error checking document existence: ${error.message}`);
        // Send an error event to the client
        sendUpdate('error', {
          status: 'error',
          message: `Error checking document status: ${error.message}`,
          documentId
        });
        
        // End the connection on error
        clearInterval(heartbeatInterval);
        clearTimeout(stallTimeout);
        res.end();
      });
    } catch (error) {
      console.error(`Error reading metadata for ${documentId}:`, error);
      // Send an error event to the client
      sendUpdate('error', {
        status: 'error',
        message: `Error reading document metadata: ${error.message}`,
        documentId
      });
      
      // End the connection on error
      clearInterval(heartbeatInterval);
      clearTimeout(stallTimeout);
      res.end();
    }
  } else {
    sendUpdate('processing', { 
      status: 'waiting', 
      message: 'Waiting for document processing to start or complete',
      documentId
    });
  }
  
  // Set up connection cleanup
  req.on('close', () => {
    console.log(`Status connection closed for document ${documentId}`);
    clearInterval(heartbeatInterval);
    clearTimeout(stallTimeout);
  });
});

module.exports = router; 