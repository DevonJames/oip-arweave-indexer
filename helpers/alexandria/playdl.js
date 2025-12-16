const playdl = require('play-dl');
const { makeVideoDirectory, retryDownloadVideoThumbnail, downloadVideoThumbnail } = require('./file');

const video_basic_info = async (url) => {
    try {
        const videoInfo = await playdl.video_basic_info(url);
        const videoDetails = {
            id: videoInfo.video_details.id,
            title: videoInfo.video_details.title,
            description: videoInfo.video_details.description,
            publishedAt: new Date(videoInfo.video_details.uploadedAt).getTime() / 1000,
            thumbnails: videoInfo.video_details.thumbnails,
            channelTitle: videoInfo.video_details.channel.name,
            tags: videoInfo.video_details.tags,
            duration: videoInfo.video_details.durationInSec
        };
        return videoDetails;
    } catch (error) {
        console.error("Error fetching video info:", error);
        return null;
    }
};

const downloadAndProcessYouTubeVideo = async (youtubeUrl) => {
    const video = await video_basic_info(youtubeUrl);
    const youTubeID = video.video_details.id;
    const videoPath = `files/${youTubeID}/${youTubeID}.mp4`;
    const thumbnailPath = `files/${youTubeID}/${youTubeID}.jpg`;

    await makeVideoDirectory(youTubeID);

    const info = await video_basic_info(youtubeUrl);
    const format = info.format.filter((format) => format.mimeType.startsWith("video/")).sort((a, b) => b.bitrate - a.bitrate)[0];

    await retryDownloadVideo(info, format, `files/${youTubeID}`, maxRetries);
    await retryDownloadVideoThumbnail(info.video_details.thumbnails[0].url, thumbnailPath, maxRetries);

    return { videoPath, thumbnailPath, videoInfo: video };
};

module.exports = {
    video_basic_info,
    downloadAndProcessYouTubeVideo
};