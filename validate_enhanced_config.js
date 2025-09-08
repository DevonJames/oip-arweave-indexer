#!/usr/bin/env node

/**
 * Enhanced Voice Pipeline Configuration Validator
 * Validates environment variables and feature flags for Week 4
 */

const axios = require('axios');
const fs = require('fs');

class ConfigValidator {
    constructor() {
        this.results = {
            valid: 0,
            invalid: 0,
            warnings: 0,
            details: []
        };
        
        this.serviceUrls = {
            MAIN_APP: process.env.MAIN_APP_URL || 'http://localhost:3000',
            STT_SERVICE: process.env.STT_SERVICE_URL || 'http://localhost:8003',
            TTS_SERVICE: process.env.TTS_SERVICE_URL || 'http://localhost:5002',
            SMART_TURN: process.env.SMART_TURN_URL || 'http://localhost:8010'
        };
    }

    log(message, level = 'info') {
        const prefix = {
            'info': 'ℹ️',
            'success': '✅',
            'error': '❌',
            'warning': '⚠️'
        }[level] || 'ℹ️';
        
        console.log(`${prefix} ${message}`);
    }

    validate(name, condition, message, level = 'error') {
        if (condition) {
            this.results.valid++;
            this.results.details.push({ name, status: 'VALID', message: null });
            this.log(`${name}: VALID`, 'success');
        } else {
            if (level === 'warning') {
                this.results.warnings++;
                this.results.details.push({ name, status: 'WARNING', message });
                this.log(`${name}: WARNING - ${message}`, 'warning');
            } else {
                this.results.invalid++;
                this.results.details.push({ name, status: 'INVALID', message });
                this.log(`${name}: INVALID - ${message}`, 'error');
            }
        }
    }

    async validateServiceConnectivity() {
        this.log('\n🔗 Validating Service Connectivity', 'info');
        this.log('===================================');

        for (const [serviceName, url] of Object.entries(this.serviceUrls)) {
            try {
                const response = await axios.get(`${url}/health`, { timeout: 10000 });
                this.validate(
                    `${serviceName} Connectivity`,
                    response.status === 200,
                    `Service unreachable at ${url}`
                );
                
                if (response.status === 200 && response.data) {
                    this.log(`  ${serviceName}: ${JSON.stringify(response.data.status || 'healthy')}`, 'info');
                }
            } catch (error) {
                this.validate(
                    `${serviceName} Connectivity`,
                    false,
                    `Service unreachable: ${error.message}`
                );
            }
        }
    }

    async validateEnhancedFeatures() {
        this.log('\n🚀 Validating Enhanced Pipeline Features', 'info');
        this.log('========================================');

        try {
            // Check main app enhanced features
            const healthResponse = await axios.get(`${this.serviceUrls.MAIN_APP}/api/voice/health`);
            
            if (healthResponse.data) {
                // Check for Smart Turn integration
                this.validate(
                    'Smart Turn Integration',
                    'smart_turn' in healthResponse.data,
                    'Smart Turn service not detected in health check',
                    'warning'
                );
                
                // Check enhanced services
                this.validate(
                    'Enhanced STT Service',
                    healthResponse.data.stt && healthResponse.data.stt.url,
                    'STT service configuration missing'
                );
                
                this.validate(
                    'Enhanced TTS Service',
                    healthResponse.data.tts && healthResponse.data.tts.engine,
                    'TTS service configuration missing'
                );
            }

            // Check STT service enhanced features
            try {
                const sttHealthResponse = await axios.get(`${this.serviceUrls.STT_SERVICE}/health`);
                if (sttHealthResponse.data) {
                    this.validate(
                        'VAD Integration',
                        'vad_enabled' in sttHealthResponse.data || 'vad_status' in sttHealthResponse.data,
                        'VAD features not detected in STT service',
                        'warning'
                    );
                    
                    this.validate(
                        'Enhanced STT Features',
                        'features' in sttHealthResponse.data,
                        'Enhanced features not detected in STT service',
                        'warning'
                    );
                }
            } catch (error) {
                this.log(`Could not validate STT enhanced features: ${error.message}`, 'warning');
            }

            // Check TTS service enhanced features
            try {
                const ttsHealthResponse = await axios.get(`${this.serviceUrls.TTS_SERVICE}/health`);
                if (ttsHealthResponse.data) {
                    this.validate(
                        'Multi-Engine TTS',
                        'available_engines' in ttsHealthResponse.data && Array.isArray(ttsHealthResponse.data.available_engines),
                        'Multi-engine TTS not detected'
                    );
                    
                    this.validate(
                        'Kokoro TTS Engine',
                        ttsHealthResponse.data.available_engines && ttsHealthResponse.data.available_engines.includes('kokoro'),
                        'Kokoro TTS engine not available',
                        'warning'
                    );
                }
            } catch (error) {
                this.log(`Could not validate TTS enhanced features: ${error.message}`, 'warning');
            }

        } catch (error) {
            this.validate(
                'Enhanced Features Check',
                false,
                `Could not validate enhanced features: ${error.message}`
            );
        }
    }

    validateEnvironmentVariables() {
        this.log('\n🔧 Validating Environment Variables', 'info');
        this.log('====================================');

        const requiredEnvVars = {
            // Service URLs
            'STT_SERVICE_URL': process.env.STT_SERVICE_URL,
            'TTS_SERVICE_URL': process.env.TTS_SERVICE_URL,
            'SMART_TURN_URL': process.env.SMART_TURN_URL,
            
            // Enhanced pipeline flags
            'SMART_TURN_ENABLED': process.env.SMART_TURN_ENABLED,
            'VAD_ENABLED': process.env.VAD_ENABLED,
            'ENHANCED_PIPELINE_ENABLED': process.env.ENHANCED_PIPELINE_ENABLED
        };

        const optionalEnvVars = {
            // Model configuration
            'WHISPER_MODEL': process.env.WHISPER_MODEL,
            'TTS_PRIMARY_ENGINE': process.env.TTS_PRIMARY_ENGINE,
            'DEFAULT_VOICE': process.env.DEFAULT_VOICE,
            
            // Performance settings
            'CACHE_ENABLED': process.env.CACHE_ENABLED,
            'MODEL_STORAGE_PATH': process.env.MODEL_STORAGE_PATH
        };

        // Validate required environment variables
        for (const [varName, value] of Object.entries(requiredEnvVars)) {
            this.validate(
                `ENV: ${varName}`,
                value !== undefined && value !== '',
                `Required environment variable not set`
            );
        }

        // Check optional environment variables
        for (const [varName, value] of Object.entries(optionalEnvVars)) {
            this.validate(
                `ENV: ${varName}`,
                value !== undefined,
                `Optional environment variable not set (using defaults)`,
                'warning'
            );
        }

        // Validate boolean environment variables
        const booleanVars = ['SMART_TURN_ENABLED', 'VAD_ENABLED', 'CACHE_ENABLED'];
        for (const varName of booleanVars) {
            const value = process.env[varName];
            if (value !== undefined) {
                this.validate(
                    `ENV: ${varName} (boolean)`,
                    value === 'true' || value === 'false',
                    `Boolean environment variable should be 'true' or 'false', got '${value}'`,
                    'warning'
                );
            }
        }
    }

    async validateModelConfiguration() {
        this.log('\n🤖 Validating Model Configuration', 'info');
        this.log('=================================');

        try {
            // Check STT model configuration
            const sttModelsResponse = await axios.get(`${this.serviceUrls.STT_SERVICE}/models`, { timeout: 10000 });
            if (sttModelsResponse.data) {
                this.validate(
                    'STT Models Available',
                    true,
                    null
                );
                this.log(`  Available STT models: ${JSON.stringify(sttModelsResponse.data)}`, 'info');
            }
        } catch (error) {
            this.validate(
                'STT Models Check',
                false,
                `Could not retrieve STT models: ${error.message}`,
                'warning'
            );
        }

        try {
            // Check TTS engines configuration
            const ttsEnginesResponse = await axios.get(`${this.serviceUrls.TTS_SERVICE}/engines`, { timeout: 10000 });
            if (ttsEnginesResponse.data) {
                this.validate(
                    'TTS Engines Available',
                    true,
                    null
                );
                this.log(`  Available TTS engines: ${Object.keys(ttsEnginesResponse.data.engines || {})}`, 'info');
            }
        } catch (error) {
            this.validate(
                'TTS Engines Check',
                false,
                `Could not retrieve TTS engines: ${error.message}`,
                'warning'
            );
        }
    }

    async validatePipelineIntegration() {
        this.log('\n🔄 Validating Pipeline Integration', 'info');
        this.log('==================================');

        try {
            // Test a simple text-only request to validate pipeline
            const response = await axios.post(`${this.serviceUrls.MAIN_APP}/api/voice/chat`, {
                text: "Configuration validation test",
                return_audio: false
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });

            if (response.data) {
                // Check Week 4 enhanced response format
                this.validate(
                    'Enhanced Response Format',
                    'processing_metrics' in response.data,
                    'Enhanced response format not detected'
                );
                
                this.validate(
                    'Pipeline Version',
                    response.data.pipeline_version === "2.0",
                    `Expected pipeline version 2.0, got ${response.data.pipeline_version}`
                );
                
                this.validate(
                    'Processing Metrics',
                    response.data.processing_metrics && 'total_time_ms' in response.data.processing_metrics,
                    'Processing metrics not available'
                );

                if (response.data.processing_metrics) {
                    this.log(`  Pipeline processing time: ${response.data.processing_metrics.total_time_ms}ms`, 'info');
                }
            }

        } catch (error) {
            this.validate(
                'Pipeline Integration Test',
                false,
                `Pipeline integration test failed: ${error.message}`
            );
        }
    }

    async validateDockerConfiguration() {
        this.log('\n🐳 Validating Docker Configuration', 'info');
        this.log('===================================');

        // Check if docker-compose file exists and is valid
        const composeFiles = [
            'docker-compose-voice-enhanced.yml',
            'docker-compose.yml'
        ];

        let foundComposeFile = false;
        for (const file of composeFiles) {
            if (fs.existsSync(file)) {
                foundComposeFile = true;
                this.validate(
                    `Docker Compose File (${file})`,
                    true,
                    null
                );
                
                // Read and validate compose file
                try {
                    const composeContent = fs.readFileSync(file, 'utf8');
                    
                    // Check for enhanced services
                    const hasSmartTurn = composeContent.includes('smart-turn');
                    const hasEnhancedSTT = composeContent.includes('speech-to-text');
                    const hasKokoroTTS = composeContent.includes('kokoro') || composeContent.includes('text-to-speech');
                    
                    this.validate(
                        'Smart Turn Service in Compose',
                        hasSmartTurn,
                        'Smart Turn service not found in docker-compose',
                        'warning'
                    );
                    
                    this.validate(
                        'Enhanced STT Service in Compose',
                        hasEnhancedSTT,
                        'Enhanced STT service not found in docker-compose'
                    );
                    
                    this.validate(
                        'Enhanced TTS Service in Compose',
                        hasKokoroTTS,
                        'Enhanced TTS service not found in docker-compose'
                    );
                    
                } catch (error) {
                    this.validate(
                        `Docker Compose File Validation (${file})`,
                        false,
                        `Could not read compose file: ${error.message}`,
                        'warning'
                    );
                }
                break;
            }
        }

        this.validate(
            'Docker Compose File Exists',
            foundComposeFile,
            'No docker-compose file found'
        );
    }

    async runAllValidations() {
        this.log('🔍 Enhanced Voice Pipeline Configuration Validator');
        this.log('================================================');
        
        // Run all validations
        this.validateEnvironmentVariables();
        await this.validateServiceConnectivity();
        await this.validateEnhancedFeatures();
        await this.validateModelConfiguration();
        await this.validatePipelineIntegration();
        await this.validateDockerConfiguration();
        
        // Generate report
        this.generateReport();
    }

    generateReport() {
        this.log('\n📊 Configuration Validation Results', 'info');
        this.log('====================================');
        
        const total = this.results.valid + this.results.invalid + this.results.warnings;
        const validRate = total > 0 ? (this.results.valid / total * 100).toFixed(1) : 0;
        
        this.log(`Total Checks: ${total}`, 'info');
        this.log(`Valid: ${this.results.valid}`, 'success');
        this.log(`Invalid: ${this.results.invalid}`, this.results.invalid > 0 ? 'error' : 'info');
        this.log(`Warnings: ${this.results.warnings}`, this.results.warnings > 0 ? 'warning' : 'info');
        this.log(`Valid Rate: ${validRate}%`, validRate >= 90 ? 'success' : 'warning');
        
        if (this.results.invalid > 0) {
            this.log('\n❌ Invalid Configurations:', 'error');
            this.results.details
                .filter(check => check.status === 'INVALID')
                .forEach(check => {
                    this.log(`  - ${check.name}: ${check.message}`, 'error');
                });
        }
        
        if (this.results.warnings > 0) {
            this.log('\n⚠️ Configuration Warnings:', 'warning');
            this.results.details
                .filter(check => check.status === 'WARNING')
                .forEach(check => {
                    this.log(`  - ${check.name}: ${check.message}`, 'warning');
                });
        }
        
        if (this.results.invalid === 0) {
            this.log('\n🎉 Configuration validation passed! Enhanced Voice Pipeline is properly configured.', 'success');
        } else {
            this.log('\n⚠️ Configuration issues found. Please review and fix before deployment.', 'warning');
        }
        
        // Save detailed results
        const reportFile = `config_validation_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        fs.writeFileSync(reportFile, JSON.stringify({
            summary: {
                total: total,
                valid: this.results.valid,
                invalid: this.results.invalid,
                warnings: this.results.warnings,
                valid_rate: validRate
            },
            details: this.results.details,
            timestamp: new Date().toISOString(),
            pipeline_version: "2.0"
        }, null, 2));
        
        this.log(`📄 Detailed results saved to: ${reportFile}`, 'info');
        
        // Exit with appropriate code
        process.exit(this.results.invalid > 0 ? 1 : 0);
    }
}

// Run validation if called directly
if (require.main === module) {
    const validator = new ConfigValidator();
    validator.runAllValidations().catch(error => {
        console.error('💥 Configuration validation crashed:', error);
        process.exit(1);
    });
}

module.exports = ConfigValidator;
