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
    FAILED: 'failed',
    CANCELLED: 'cancelled'
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
     * @param {object} params - Job parameters
     * @returns {string} Job ID
     */
    createJob(params) {
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const job = {
            id: jobId,
            status: JobStatus.QUEUED,
            progress: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            userId: params.userId,
            userPublicKey: params.userPublicKey,
            userEmail: params.userEmail,
            params: { ...params },
            tempFilePath: params.tempFilePath,
            token: params.token,
            currentStep: 'Job created, waiting to start',
            error: null,
            result: null,
            // Metadata for display
            audioFilename: params.audioFilename,
            audioSize: params.audioSize,
            durationSec: params.durationSec
        };
        
        jobs.set(jobId, job);
        
        console.log(`📋 [NotesJobService] Created job ${jobId} for user ${params.userEmail || params.userId}`);
        this.emit('jobCreated', job);
        
        return jobId;
    }

    /**
     * Get job by ID
     * @param {string} jobId - Job ID
     * @returns {object|null} Job or null if not found
     */
    getJob(jobId) {
        return jobs.get(jobId) || null;
    }

    /**
     * Get job status for polling endpoint
     * @param {string} jobId - Job ID
     * @returns {object|null} Status object or null
     */
    getJobStatus(jobId) {
        const job = jobs.get(jobId);
        if (!job) return null;
        
        return {
            jobId: job.id,
            status: job.status,
            progress: job.progress,
            currentStep: job.currentStep,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            audioFilename: job.audioFilename,
            durationSec: job.durationSec,
            result: job.status === JobStatus.COMPLETE ? job.result : null,
            error: job.status === JobStatus.FAILED ? job.error : null
        };
    }

    /**
     * Update job status and progress
     * @param {string} jobId - Job ID
     * @param {object} updates - Updates to apply
     */
    updateJob(jobId, updates) {
        const job = jobs.get(jobId);
        if (!job) {
            console.warn(`⚠️ [NotesJobService] Job ${jobId} not found for update`);
            return false;
        }
        
        Object.assign(job, updates, { updatedAt: new Date().toISOString() });
        
        console.log(`📊 [Job ${jobId}] ${job.status} - ${job.progress}% - ${job.currentStep}`);
        this.emit('jobUpdated', job);
        
        return true;
    }

    /**
     * Mark job as complete
     * @param {string} jobId - Job ID
     * @param {object} result - Processing result
     */
    completeJob(jobId, result) {
        const job = jobs.get(jobId);
        if (!job) return false;
        
        job.status = JobStatus.COMPLETE;
        job.progress = 100;
        job.currentStep = 'Processing complete';
        job.result = result;
        job.completedAt = new Date().toISOString();
        job.updatedAt = new Date().toISOString();
        
        // Clear sensitive data
        job.token = null;
        job.tempFilePath = null;
        
        console.log(`✅ [Job ${jobId}] Complete! Note hash: ${result.noteHash}`);
        this.emit('jobComplete', job);
        
        return true;
    }

    /**
     * Mark job as failed
     * @param {string} jobId - Job ID
     * @param {Error|string} error - Error that caused failure
     */
    failJob(jobId, error) {
        const job = jobs.get(jobId);
        if (!job) return false;
        
        job.status = JobStatus.FAILED;
        job.currentStep = 'Processing failed';
        job.error = {
            message: error.message || String(error),
            code: error.code || 'PROCESSING_ERROR'
        };
        job.failedAt = new Date().toISOString();
        job.updatedAt = new Date().toISOString();
        
        // Clear sensitive data
        job.token = null;
        job.tempFilePath = null;
        
        console.error(`❌ [Job ${jobId}] Failed:`, error.message || error);
        this.emit('jobFailed', job);
        
        return true;
    }

    /**
     * Cancel a job
     * @param {string} jobId - Job ID
     * @returns {boolean} Whether cancellation succeeded
     */
    cancelJob(jobId) {
        const job = jobs.get(jobId);
        if (!job) return false;
        
        // Can only cancel queued or in-progress jobs
        if (job.status === JobStatus.COMPLETE || job.status === JobStatus.FAILED) {
            return false;
        }
        
        job.status = JobStatus.CANCELLED;
        job.currentStep = 'Cancelled by user';
        job.cancelledAt = new Date().toISOString();
        job.updatedAt = new Date().toISOString();
        
        // Clear sensitive data
        job.token = null;
        job.tempFilePath = null;
        
        console.log(`🚫 [Job ${jobId}] Cancelled`);
        this.emit('jobCancelled', job);
        
        return true;
    }

    /**
     * List jobs for a user
     * @param {string} userId - User ID
     * @param {object} options - Filter options
     * @returns {array} Jobs
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
        userJobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        return userJobs.slice(0, limit);
    }

    /**
     * Get service statistics
     * @returns {object} Stats
     */
    getStats() {
        const stats = {
            totalJobs: jobs.size,
            byStatus: {}
        };
        
        for (const status of Object.values(JobStatus)) {
            stats.byStatus[status] = 0;
        }
        
        for (const job of jobs.values()) {
            stats.byStatus[job.status] = (stats.byStatus[job.status] || 0) + 1;
        }
        
        return stats;
    }

    /**
     * Start cleanup interval for old jobs
     * @private
     */
    startCleanupInterval() {
        // Run cleanup every hour
        this.cleanupInterval = setInterval(() => {
            this.cleanupOldJobs();
        }, 60 * 60 * 1000);
    }

    /**
     * Clean up old completed/failed jobs
     * @private
     */
    cleanupOldJobs() {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [jobId, job] of jobs.entries()) {
            const jobAge = now - new Date(job.createdAt).getTime();
            
            // Clean up completed/failed jobs older than retention period
            if (jobAge > JOB_RETENTION_MS && 
                (job.status === JobStatus.COMPLETE || 
                 job.status === JobStatus.FAILED ||
                 job.status === JobStatus.CANCELLED)) {
                jobs.delete(jobId);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`🧹 [NotesJobService] Cleaned up ${cleanedCount} old jobs`);
        }
    }

    /**
     * Stop the cleanup interval
     */
    stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// Singleton instance
let notesJobServiceInstance = null;

function getNotesJobService() {
    if (!notesJobServiceInstance) {
        notesJobServiceInstance = new NotesJobService();
    }
    return notesJobServiceInstance;
}

module.exports = {
    NotesJobService,
    getNotesJobService,
    JobStatus
};

