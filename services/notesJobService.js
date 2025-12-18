/**
 * Notes Job Service
 * Manages async processing jobs for long meeting recordings
 * Supports meetings up to 4+ hours by processing asynchronously with status polling
 */

const EventEmitter = require('events');

// Job statuses
const JobStatus = {
    QUEUED: 'queued',
    UPLOADING: 'uploading',
    TRANSCRIBING: 'transcribing',
    CHUNKING: 'chunking',
    SUMMARIZING: 'summarizing',
    CREATING_RECORDS: 'creating_records',
    COMPLETE: 'complete',
    FAILED: 'failed'
};

// In-memory job store (can be replaced with Redis for production scaling)
const jobs = new Map();

// Clean up old jobs after 24 hours
const JOB_RETENTION_MS = 24 * 60 * 60 * 1000;

class NotesJobService extends EventEmitter {
    constructor() {
        super();
        this.cleanupInterval = null;
        this.startCleanupInterval();
    }

    /**
     * Create a new processing job
     * @param {object} jobData - Initial job data
     * @returns {string} Job ID
     */
    createJob(jobData) {
        const jobId = this._generateJobId();
        const now = Date.now();
        
        const job = {
            id: jobId,
            status: JobStatus.QUEUED,
            progress: 0,
            currentStep: 'Queued for processing',
            createdAt: now,
            updatedAt: now,
            
            // Request data
            userId: jobData.userId,
            userPublicKey: jobData.userPublicKey,
            userEmail: jobData.userEmail,
            
            // Audio metadata
            audioFilename: jobData.audioFilename,
            audioSize: jobData.audioSize,
            durationSec: jobData.durationSec,
            
            // Request parameters
            params: {
                start_time: jobData.start_time,
                end_time: jobData.end_time,
                note_type: jobData.note_type,
                device_type: jobData.device_type,
                capture_location: jobData.capture_location,
                transcription_engine_id: jobData.transcription_engine_id,
                chunking_strategy: jobData.chunking_strategy,
                participant_display_names: jobData.participant_display_names,
                participant_roles: jobData.participant_roles,
                calendar_event_id: jobData.calendar_event_id,
                calendar_start_time: jobData.calendar_start_time,
                calendar_end_time: jobData.calendar_end_time,
                model: jobData.model,
                generateChunkTags: jobData.generateChunkTags,
                transcript: jobData.transcript // Pre-existing transcript if provided
            },
            
            // Processing state
            tempFilePath: jobData.tempFilePath,
            token: jobData.token,
            
            // Results (populated as processing progresses)
            transcription: null,
            noteHash: null,
            chunks: null,
            summary: null,
            
            // Final results
            result: null,
            error: null,
            errorDetails: null
        };
        
        jobs.set(jobId, job);
        console.log(`📋 [Job ${jobId}] Created for ${jobData.audioFilename || 'transcript input'} (${jobData.durationSec}s)`);
        
        this.emit('jobCreated', job);
        return jobId;
    }

    /**
     * Get job by ID
     * @param {string} jobId - Job ID
     * @returns {object|null} Job data or null if not found
     */
    getJob(jobId) {
        return jobs.get(jobId) || null;
    }

    /**
     * Get job status (public-facing, without sensitive data)
     * @param {string} jobId - Job ID
     * @returns {object|null} Public job status
     */
    getJobStatus(jobId) {
        const job = jobs.get(jobId);
        if (!job) return null;
        
        return {
            id: job.id,
            status: job.status,
            progress: job.progress,
            currentStep: job.currentStep,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            durationSec: job.durationSec,
            
            // Include result if complete
            result: job.status === JobStatus.COMPLETE ? job.result : null,
            
            // Include error if failed
            error: job.status === JobStatus.FAILED ? job.error : null,
            errorDetails: job.status === JobStatus.FAILED ? job.errorDetails : null,
            
            // Estimated time remaining (rough calculation)
            estimatedTimeRemaining: this._estimateTimeRemaining(job)
        };
    }

    /**
     * Update job status
     * @param {string} jobId - Job ID
     * @param {object} updates - Status updates
     */
    updateJob(jobId, updates) {
        const job = jobs.get(jobId);
        if (!job) {
            console.error(`[Job ${jobId}] Not found for update`);
            return;
        }
        
        Object.assign(job, updates, { updatedAt: Date.now() });
        
        const progressStr = updates.progress !== undefined ? ` (${updates.progress}%)` : '';
        console.log(`📋 [Job ${jobId}] ${updates.status || job.status}: ${updates.currentStep || job.currentStep}${progressStr}`);
        
        this.emit('jobUpdated', job);
    }

    /**
     * Mark job as complete
     * @param {string} jobId - Job ID
     * @param {object} result - Final result
     */
    completeJob(jobId, result) {
        const job = jobs.get(jobId);
        if (!job) return;
        
        job.status = JobStatus.COMPLETE;
        job.progress = 100;
        job.currentStep = 'Complete';
        job.result = result;
        job.updatedAt = Date.now();
        job.completedAt = Date.now();
        
        // Calculate processing time
        const processingTime = Math.round((job.completedAt - job.createdAt) / 1000);
        const processingMins = Math.floor(processingTime / 60);
        const processingSecs = processingTime % 60;
        
        console.log(`✅ [Job ${jobId}] Complete in ${processingMins}m ${processingSecs}s`);
        this.emit('jobComplete', job);
    }

    /**
     * Mark job as failed
     * @param {string} jobId - Job ID
     * @param {Error|string} error - Error that caused failure
     */
    failJob(jobId, error) {
        const job = jobs.get(jobId);
        if (!job) return;
        
        job.status = JobStatus.FAILED;
        job.error = typeof error === 'string' ? error : error.message;
        job.errorDetails = error.stack || null;
        job.updatedAt = Date.now();
        
        console.error(`❌ [Job ${jobId}] Failed: ${job.error}`);
        this.emit('jobFailed', job);
    }

    /**
     * List jobs for a user
     * @param {string} userId - User ID
     * @param {object} options - Filter options
     * @returns {array} Array of job statuses
     */
    listUserJobs(userId, options = {}) {
        const { limit = 10, status = null } = options;
        const userJobs = [];
        
        for (const job of jobs.values()) {
            if (job.userId === userId) {
                if (!status || job.status === status) {
                    userJobs.push(this.getJobStatus(job.id));
                }
            }
        }
        
        // Sort by createdAt descending
        userJobs.sort((a, b) => b.createdAt - a.createdAt);
        
        return userJobs.slice(0, limit);
    }

    /**
     * Cancel a job
     * @param {string} jobId - Job ID
     * @returns {boolean} True if cancelled
     */
    cancelJob(jobId) {
        const job = jobs.get(jobId);
        if (!job) return false;
        
        // Can only cancel queued or in-progress jobs
        if ([JobStatus.COMPLETE, JobStatus.FAILED].includes(job.status)) {
            return false;
        }
        
        job.status = JobStatus.FAILED;
        job.error = 'Cancelled by user';
        job.updatedAt = Date.now();
        
        console.log(`🚫 [Job ${jobId}] Cancelled`);
        this.emit('jobCancelled', job);
        return true;
    }

    /**
     * Generate unique job ID
     * @private
     */
    _generateJobId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `job_${timestamp}_${random}`;
    }

    /**
     * Estimate time remaining for a job
     * @private
     */
    _estimateTimeRemaining(job) {
        if ([JobStatus.COMPLETE, JobStatus.FAILED].includes(job.status)) {
            return 0;
        }
        
        const durationSec = job.durationSec || 0;
        const progress = job.progress || 0;
        
        if (progress === 0) {
            // Rough estimate: processing takes ~0.5-1x realtime for short meetings,
            // but can take 2-3x realtime for very long meetings due to LLM overhead
            const estimatedMultiplier = durationSec > 7200 ? 2.5 : durationSec > 3600 ? 2 : 1.5;
            return Math.round(durationSec * estimatedMultiplier);
        }
        
        // Calculate based on elapsed time and progress
        const elapsedSec = Math.round((Date.now() - job.createdAt) / 1000);
        if (progress > 0) {
            const estimatedTotalSec = Math.round(elapsedSec / (progress / 100));
            return Math.max(0, estimatedTotalSec - elapsedSec);
        }
        
        return null; // Unknown
    }

    /**
     * Start cleanup interval for old jobs
     * @private
     */
    startCleanupInterval() {
        // Clean up every hour
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            let cleaned = 0;
            
            for (const [jobId, job] of jobs.entries()) {
                // Remove jobs older than retention period that are complete or failed
                if ([JobStatus.COMPLETE, JobStatus.FAILED].includes(job.status)) {
                    if (now - job.updatedAt > JOB_RETENTION_MS) {
                        jobs.delete(jobId);
                        cleaned++;
                    }
                }
            }
            
            if (cleaned > 0) {
                console.log(`🧹 [NotesJobService] Cleaned up ${cleaned} old jobs`);
            }
        }, 60 * 60 * 1000); // Every hour
    }

    /**
     * Stop cleanup interval
     */
    stopCleanupInterval() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Get job count statistics
     */
    getStats() {
        const stats = {
            total: jobs.size,
            queued: 0,
            processing: 0,
            complete: 0,
            failed: 0
        };
        
        for (const job of jobs.values()) {
            switch (job.status) {
                case JobStatus.QUEUED:
                    stats.queued++;
                    break;
                case JobStatus.COMPLETE:
                    stats.complete++;
                    break;
                case JobStatus.FAILED:
                    stats.failed++;
                    break;
                default:
                    stats.processing++;
            }
        }
        
        return stats;
    }
}

// Export status constants
module.exports.JobStatus = JobStatus;

// Singleton instance
let notesJobServiceInstance = null;

function getNotesJobService() {
    if (!notesJobServiceInstance) {
        notesJobServiceInstance = new NotesJobService();
    }
    return notesJobServiceInstance;
}

module.exports.NotesJobService = NotesJobService;
module.exports.getNotesJobService = getNotesJobService;

