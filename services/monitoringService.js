/**
 * Monitoring Service
 * Advanced monitoring with Prometheus metrics, alerting, and performance tracking
 */

class MonitoringService {
    constructor() {
        this.metrics = new Map(); // metric_name -> metric_data
        this.alerts = new Map(); // alert_name -> alert_config
        this.healthChecks = new Map(); // check_name -> check_function
        this.performanceCounters = new Map(); // counter_name -> value
        
        // Monitoring configuration
        this.metricsRetentionDays = 7;
        this.alertCheckInterval = 30000; // 30 seconds
        this.performanceLogInterval = 60000; // 1 minute
        this.healthCheckInterval = 30000; // 30 seconds
        
        // Initialize core metrics
        this.initializeMetrics();
        
        // Start monitoring loops
        this.startMonitoring();
    }

    initializeMetrics() {
        // Counter metrics (monotonically increasing)
        this.createCounter('media_uploads_total', 'Total number of media uploads');
        this.createCounter('media_downloads_total', 'Total number of media downloads');
        this.createCounter('peer_connections_total', 'Total peer connections established');
        this.createCounter('replications_completed_total', 'Total successful replications');
        this.createCounter('replications_failed_total', 'Total failed replications');
        this.createCounter('encryption_operations_total', 'Total encryption operations');
        this.createCounter('decryption_operations_total', 'Total decryption operations');
        
        // Gauge metrics (current value)
        this.createGauge('active_peers', 'Number of active peers');
        this.createGauge('seeding_torrents', 'Number of torrents being seeded');
        this.createGauge('replication_queue_size', 'Size of replication queue');
        this.createGauge('memory_usage_bytes', 'Memory usage in bytes');
        this.createGauge('disk_usage_bytes', 'Disk usage in bytes');
        this.createGauge('network_health_score', 'Network health score (0-100)');
        
        // Histogram metrics (distribution of values)
        this.createHistogram('upload_duration_seconds', 'Upload duration in seconds', [0.1, 0.5, 1, 2, 5, 10, 30]);
        this.createHistogram('download_duration_seconds', 'Download duration in seconds', [0.1, 0.5, 1, 2, 5, 10, 30]);
        this.createHistogram('replication_duration_seconds', 'Replication duration in seconds', [1, 5, 10, 30, 60, 300]);
        this.createHistogram('file_size_bytes', 'File size distribution', [1024, 10240, 102400, 1048576, 10485760, 104857600]);
        
        console.log('📊 Monitoring metrics initialized');
    }

    createCounter(name, help, labels = []) {
        this.metrics.set(name, {
            type: 'counter',
            help,
            labels,
            value: 0,
            createdAt: Date.now()
        });
    }

    createGauge(name, help, labels = []) {
        this.metrics.set(name, {
            type: 'gauge',
            help,
            labels,
            value: 0,
            createdAt: Date.now()
        });
    }

    createHistogram(name, help, buckets, labels = []) {
        this.metrics.set(name, {
            type: 'histogram',
            help,
            labels,
            buckets: buckets.map(le => ({ le, count: 0 })),
            sum: 0,
            count: 0,
            createdAt: Date.now()
        });
    }

    // Metric recording methods
    incrementCounter(name, value = 1, labelValues = {}) {
        const metric = this.metrics.get(name);
        if (metric && metric.type === 'counter') {
            metric.value += value;
            metric.lastUpdated = Date.now();
            this.recordMetricEvent(name, 'increment', value, labelValues);
        }
    }

    setGauge(name, value, labelValues = {}) {
        const metric = this.metrics.get(name);
        if (metric && metric.type === 'gauge') {
            metric.value = value;
            metric.lastUpdated = Date.now();
            this.recordMetricEvent(name, 'set', value, labelValues);
        }
    }

    observeHistogram(name, value, labelValues = {}) {
        const metric = this.metrics.get(name);
        if (metric && metric.type === 'histogram') {
            // Update buckets
            metric.buckets.forEach(bucket => {
                if (value <= bucket.le) {
                    bucket.count++;
                }
            });
            
            metric.sum += value;
            metric.count++;
            metric.lastUpdated = Date.now();
            this.recordMetricEvent(name, 'observe', value, labelValues);
        }
    }

    recordMetricEvent(metricName, operation, value, labels) {
        // Store recent metric events for debugging
        if (!this.metrics.get(metricName).events) {
            this.metrics.get(metricName).events = [];
        }
        
        const events = this.metrics.get(metricName).events;
        events.push({
            operation,
            value,
            labels,
            timestamp: Date.now()
        });
        
        // Keep only last 100 events per metric
        if (events.length > 100) {
            events.splice(0, events.length - 100);
        }
    }

    // Performance tracking
    startTimer(name) {
        const startTime = Date.now();
        return {
            end: (labelValues = {}) => {
                const duration = (Date.now() - startTime) / 1000;
                this.observeHistogram(name, duration, labelValues);
                return duration;
            }
        };
    }

    recordPerformanceCounter(name, value) {
        this.performanceCounters.set(name, {
            value,
            timestamp: Date.now()
        });
    }

    // Health checks
    registerHealthCheck(name, checkFunction, config = {}) {
        this.healthChecks.set(name, {
            name,
            check: checkFunction,
            interval: config.interval || this.healthCheckInterval,
            timeout: config.timeout || 5000,
            critical: config.critical || false,
            lastCheck: null,
            lastResult: null,
            consecutiveFailures: 0
        });
        
        console.log(`🏥 Registered health check: ${name}`);
    }

    async runHealthCheck(name) {
        const healthCheck = this.healthChecks.get(name);
        if (!healthCheck) return null;

        const startTime = Date.now();
        let result = {
            name,
            status: 'unknown',
            message: '',
            duration: 0,
            timestamp: startTime
        };

        try {
            const checkPromise = healthCheck.check();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Health check timeout')), healthCheck.timeout)
            );

            const checkResult = await Promise.race([checkPromise, timeoutPromise]);
            
            result.status = checkResult.status || 'healthy';
            result.message = checkResult.message || 'OK';
            result.data = checkResult.data || {};
            result.duration = Date.now() - startTime;

            healthCheck.consecutiveFailures = result.status === 'healthy' ? 0 : healthCheck.consecutiveFailures + 1;

        } catch (error) {
            result.status = 'unhealthy';
            result.message = error.message;
            result.duration = Date.now() - startTime;
            healthCheck.consecutiveFailures++;
        }

        healthCheck.lastCheck = Date.now();
        healthCheck.lastResult = result;

        return result;
    }

    async runAllHealthChecks() {
        const results = [];
        for (const [name] of this.healthChecks) {
            const result = await this.runHealthCheck(name);
            if (result) results.push(result);
        }
        return results;
    }

    // Alert management
    createAlert(name, config) {
        this.alerts.set(name, {
            name,
            condition: config.condition, // Function that returns true if alert should fire
            message: config.message,
            severity: config.severity || 'warning', // 'info', 'warning', 'error', 'critical'
            cooldownMs: config.cooldownMs || 300000, // 5 minutes
            lastTriggered: null,
            triggerCount: 0,
            active: false
        });
        
        console.log(`🚨 Created alert: ${name} (${config.severity})`);
    }

    async checkAlerts() {
        const triggeredAlerts = [];
        
        for (const [name, alert] of this.alerts) {
            try {
                const shouldTrigger = await alert.condition();
                const now = Date.now();
                const cooldownExpired = !alert.lastTriggered || (now - alert.lastTriggered) > alert.cooldownMs;
                
                if (shouldTrigger && cooldownExpired) {
                    alert.lastTriggered = now;
                    alert.triggerCount++;
                    alert.active = true;
                    
                    const alertEvent = {
                        name,
                        message: alert.message,
                        severity: alert.severity,
                        timestamp: now,
                        triggerCount: alert.triggerCount
                    };
                    
                    triggeredAlerts.push(alertEvent);
                    console.log(`🚨 ALERT [${alert.severity.toUpperCase()}]: ${alert.message}`);
                    
                } else if (!shouldTrigger && alert.active) {
                    alert.active = false;
                    console.log(`✅ Alert resolved: ${name}`);
                }
                
            } catch (error) {
                console.error(`Alert check failed for ${name}:`, error);
            }
        }
        
        return triggeredAlerts;
    }

    // Prometheus metrics export
    generatePrometheusMetrics() {
        let output = '';
        
        for (const [name, metric] of this.metrics) {
            // Add help comment
            output += `# HELP ${name} ${metric.help}\n`;
            output += `# TYPE ${name} ${metric.type}\n`;
            
            if (metric.type === 'counter' || metric.type === 'gauge') {
                output += `${name} ${metric.value}\n`;
                
            } else if (metric.type === 'histogram') {
                // Histogram buckets
                metric.buckets.forEach(bucket => {
                    output += `${name}_bucket{le="${bucket.le}"} ${bucket.count}\n`;
                });
                output += `${name}_bucket{le="+Inf"} ${metric.count}\n`;
                output += `${name}_sum ${metric.sum}\n`;
                output += `${name}_count ${metric.count}\n`;
            }
            
            output += '\n';
        }
        
        return output;
    }

    // System metrics collection
    async collectSystemMetrics() {
        try {
            const memUsage = process.memoryUsage();
            this.setGauge('memory_usage_bytes', memUsage.heapUsed);
            
            // Collect disk usage (simplified)
            const fs = require('fs');
            try {
                const stats = fs.statSync('./data');
                this.recordPerformanceCounter('data_directory_size', stats.size);
            } catch (error) {
                // Data directory might not exist yet
            }
            
            // Record process uptime
            this.recordPerformanceCounter('process_uptime_seconds', process.uptime());
            
        } catch (error) {
            console.warn('Failed to collect system metrics:', error);
        }
    }

    // Monitoring loop control
    startMonitoring() {
        console.log('🔄 Starting monitoring services...');
        
        // Health checks
        setInterval(async () => {
            await this.runAllHealthChecks();
        }, this.healthCheckInterval);
        
        // Alert checks
        setInterval(async () => {
            await this.checkAlerts();
        }, this.alertCheckInterval);
        
        // Performance logging
        setInterval(async () => {
            await this.collectSystemMetrics();
            this.logPerformanceSummary();
        }, this.performanceLogInterval);
        
        console.log('✅ Monitoring services started');
    }

    logPerformanceSummary() {
        const summary = {
            timestamp: new Date().toISOString(),
            metrics: {
                uploads: this.metrics.get('media_uploads_total')?.value || 0,
                downloads: this.metrics.get('media_downloads_total')?.value || 0,
                activePeers: this.metrics.get('active_peers')?.value || 0,
                seedingTorrents: this.metrics.get('seeding_torrents')?.value || 0,
                replicationQueue: this.metrics.get('replication_queue_size')?.value || 0,
                networkHealth: this.metrics.get('network_health_score')?.value || 0
            },
            performance: Object.fromEntries(this.performanceCounters),
            alerts: {
                active: Array.from(this.alerts.values()).filter(a => a.active).length,
                total: this.alerts.size
            }
        };
        
        console.log('📈 Performance Summary:', JSON.stringify(summary, null, 2));
    }

    // API methods
    getMetrics() {
        const metricsData = {};
        for (const [name, metric] of this.metrics) {
            metricsData[name] = {
                type: metric.type,
                value: metric.value,
                help: metric.help,
                lastUpdated: metric.lastUpdated
            };
            
            if (metric.type === 'histogram') {
                metricsData[name].buckets = metric.buckets;
                metricsData[name].sum = metric.sum;
                metricsData[name].count = metric.count;
            }
        }
        return metricsData;
    }

    getHealthStatus() {
        const healthResults = [];
        const overallHealth = { healthy: 0, unhealthy: 0, unknown: 0 };
        
        for (const [name, check] of this.healthChecks) {
            const status = check.lastResult?.status || 'unknown';
            overallHealth[status]++;
            
            healthResults.push({
                name,
                status,
                message: check.lastResult?.message || 'Not checked yet',
                lastCheck: check.lastCheck,
                consecutiveFailures: check.consecutiveFailures,
                critical: check.critical
            });
        }
        
        return {
            overall: overallHealth,
            checks: healthResults,
            timestamp: Date.now()
        };
    }

    getActiveAlerts() {
        return Array.from(this.alerts.values())
            .filter(alert => alert.active)
            .map(alert => ({
                name: alert.name,
                message: alert.message,
                severity: alert.severity,
                lastTriggered: alert.lastTriggered,
                triggerCount: alert.triggerCount
            }));
    }

    getPerformanceStats() {
        return {
            counters: Object.fromEntries(this.performanceCounters),
            metrics: this.getMetrics(),
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            timestamp: Date.now()
        };
    }
}

module.exports = MonitoringService;
