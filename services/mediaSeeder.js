/**
 * Persistent Media Seeder Service
 * Uses WebTorrent to continuously seed media files with content-addressed storage
 */

const WebTorrent = require('webtorrent');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class MediaSeeder {
    constructor() {
        this.client = new WebTorrent();
        this.seedingTorrents = new Map(); // mediaId -> torrent info
        this.mediaDir = process.env.MEDIA_DIR || path.join(__dirname, '../data/media');
        this.stateFile = path.join(this.mediaDir, 'seeder.json');
        
        // Default WebTorrent trackers
        this.trackers = [
            'wss://tracker.btorrent.xyz',
            'wss://tracker.openwebtorrent.com',
            'wss://tracker.webtorrent.dev'
        ];
    }

    async initialize() {
        try {
            // Ensure media directory exists
            await fs.mkdir(this.mediaDir, { recursive: true });
            
            // Load previous seeding state
            await this.loadState();
            
            console.log(`MediaSeeder initialized. Media dir: ${this.mediaDir}`);
            console.log(`Currently seeding ${this.seedingTorrents.size} torrents`);
            
            return true;
        } catch (error) {
            console.error('Failed to initialize MediaSeeder:', error);
            return false;
        }
    }

    async loadState() {
        try {
            const stateData = await fs.readFile(this.stateFile, 'utf8');
            const state = JSON.parse(stateData);
            
            // Restore seeding for each torrent
            for (const [mediaId, torrentInfo] of Object.entries(state.torrents || {})) {
                await this.restoreTorrent(mediaId, torrentInfo);
            }
        } catch (error) {
            // State file doesn't exist or is corrupted - start fresh
            console.log('No previous seeding state found, starting fresh');
        }
    }

    async saveState() {
        const state = {
            version: '1.0',
            lastUpdated: new Date().toISOString(),
            torrents: {}
        };

        for (const [mediaId, info] of this.seedingTorrents.entries()) {
            state.torrents[mediaId] = {
                infoHash: info.torrent.infoHash,
                magnetURI: info.torrent.magnetURI,
                filePath: info.filePath,
                contentType: info.contentType,
                fileSize: info.fileSize,
                createdAt: info.createdAt
            };
        }

        await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2));
    }

    async restoreTorrent(mediaId, torrentInfo) {
        try {
            // Check if file still exists
            const filePath = torrentInfo.filePath;
            await fs.access(filePath);

            // Add torrent back to seeding
            const torrent = this.client.add(torrentInfo.magnetURI, {
                path: path.dirname(filePath)
            });

            torrent.on('ready', () => {
                this.seedingTorrents.set(mediaId, {
                    torrent,
                    filePath: torrentInfo.filePath,
                    contentType: torrentInfo.contentType,
                    fileSize: torrentInfo.fileSize,
                    createdAt: torrentInfo.createdAt
                });
                console.log(`Restored seeding for ${mediaId}`);
            });

            torrent.on('error', (err) => {
                console.error(`Error restoring torrent ${mediaId}:`, err);
                this.seedingTorrents.delete(mediaId);
            });

        } catch (error) {
            console.warn(`Could not restore torrent ${mediaId}:`, error.message);
        }
    }

    generateMediaId(buffer) {
        // Content-addressable storage using SHA256
        return crypto.createHash('sha256').update(buffer).digest('hex');
    }

    async addMedia(fileBuffer, originalName, contentType) {
        const mediaId = this.generateMediaId(fileBuffer);
        const fileExtension = path.extname(originalName) || '';
        const fileName = `${mediaId}${fileExtension}`;
        const filePath = path.join(this.mediaDir, fileName);

        try {
            // Check if already seeding
            if (this.seedingTorrents.has(mediaId)) {
                return this.getMediaInfo(mediaId);
            }

            // Write file to disk
            await fs.writeFile(filePath, fileBuffer);

            // Create torrent
            const torrent = this.client.seed(filePath, {
                announce: this.trackers,
                name: fileName
            });

            return new Promise((resolve, reject) => {
                torrent.on('ready', async () => {
                    try {
                        const mediaInfo = {
                            torrent,
                            filePath,
                            contentType: contentType || 'application/octet-stream',
                            fileSize: fileBuffer.length,
                            createdAt: new Date().toISOString()
                        };

                        this.seedingTorrents.set(mediaId, mediaInfo);
                        await this.saveState();

                        resolve({
                            mediaId,
                            infoHash: torrent.infoHash,
                            magnetURI: torrent.magnetURI,
                            fileSize: fileBuffer.length,
                            contentType: mediaInfo.contentType,
                            fileName,
                            trackers: this.trackers
                        });

                        console.log(`Started seeding ${mediaId} (${fileName})`);
                    } catch (error) {
                        reject(error);
                    }
                });

                torrent.on('error', (err) => {
                    console.error(`Torrent error for ${mediaId}:`, err);
                    reject(err);
                });
            });

        } catch (error) {
            console.error(`Failed to add media ${mediaId}:`, error);
            throw error;
        }
    }

    getMediaInfo(mediaId) {
        const info = this.seedingTorrents.get(mediaId);
        if (!info) return null;

        return {
            mediaId,
            infoHash: info.torrent.infoHash,
            magnetURI: info.torrent.magnetURI,
            fileSize: info.fileSize,
            contentType: info.contentType,
            fileName: path.basename(info.filePath),
            isSeeding: true,
            peers: info.torrent.numPeers,
            downloaded: info.torrent.downloaded,
            uploaded: info.torrent.uploaded
        };
    }

    async getMediaFile(mediaId) {
        const info = this.seedingTorrents.get(mediaId);
        if (!info) return null;

        try {
            const fileBuffer = await fs.readFile(info.filePath);
            return {
                buffer: fileBuffer,
                contentType: info.contentType,
                fileName: path.basename(info.filePath)
            };
        } catch (error) {
            console.error(`Failed to read media file ${mediaId}:`, error);
            return null;
        }
    }

    listSeeding() {
        const result = [];
        for (const [mediaId, info] of this.seedingTorrents.entries()) {
            result.push({
                mediaId,
                fileName: path.basename(info.filePath),
                fileSize: info.fileSize,
                contentType: info.contentType,
                peers: info.torrent.numPeers,
                uploaded: info.torrent.uploaded,
                createdAt: info.createdAt
            });
        }
        return result;
    }

    async downloadFromPeer(magnetURI, downloadPath = null) {
        return new Promise((resolve, reject) => {
            const downloadDir = downloadPath || this.mediaDir;
            
            const torrent = this.client.add(magnetURI, {
                path: downloadDir
            });

            torrent.on('ready', () => {
                console.log(`Started downloading: ${torrent.name}`);
            });

            torrent.on('done', async () => {
                try {
                    const file = torrent.files[0];
                    const filePath = path.join(downloadDir, file.name);
                    const fileBuffer = await fs.readFile(filePath);
                    const mediaId = this.generateMediaId(fileBuffer);

                    // Add to seeding if not already
                    if (!this.seedingTorrents.has(mediaId)) {
                        this.seedingTorrents.set(mediaId, {
                            torrent,
                            filePath,
                            contentType: 'application/octet-stream', // Will be updated by caller
                            fileSize: file.length,
                            createdAt: new Date().toISOString()
                        });
                        await this.saveState();
                    }

                    resolve({
                        mediaId,
                        filePath,
                        fileSize: file.length,
                        infoHash: torrent.infoHash
                    });

                    console.log(`Download completed: ${mediaId}`);
                } catch (error) {
                    reject(error);
                }
            });

            torrent.on('error', reject);

            // Set timeout for downloads
            setTimeout(() => {
                if (!torrent.done) {
                    torrent.destroy();
                    reject(new Error('Download timeout'));
                }
            }, 60000); // 60 second timeout
        });
    }

    getStats() {
        const stats = {
            totalTorrents: this.seedingTorrents.size,
            totalPeers: 0,
            totalUploaded: 0,
            totalDownloaded: 0,
            client: {
                peerId: this.client.peerId,
                nodeId: this.client.nodeId
            }
        };

        for (const info of this.seedingTorrents.values()) {
            stats.totalPeers += info.torrent.numPeers;
            stats.totalUploaded += info.torrent.uploaded;
            stats.totalDownloaded += info.torrent.downloaded;
        }

        return stats;
    }

    async shutdown() {
        console.log('Shutting down MediaSeeder...');
        await this.saveState();
        this.client.destroy();
        console.log('MediaSeeder shutdown complete');
    }
}

module.exports = MediaSeeder;
