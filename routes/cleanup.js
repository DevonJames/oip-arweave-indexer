const express = require('express');
const router = express.Router();
const { checkTemplateUsage, getTemplatesInDB } = require('../helpers/elasticsearch');
const { publishNewRecord } = require('../helpers/templateHelper');
const { authenticateToken } = require('../helpers/utils');

/**
 * GET /api/cleanup/analyze-templates
 * Analyze template usage to identify unused templates
 */
router.get('/analyze-templates', authenticateToken, async (req, res) => {
    try {
        console.log('🔍 Starting template usage analysis...');
        
        // Get all templates
        const templatesData = await getTemplatesInDB();
        const templates = templatesData.templatesInDB;
        
        console.log(`📋 Found ${templates.length} templates in database`);
        
        const unusedTemplates = [];
        const usedTemplates = [];
        let totalFields = 0;
        let unusedFields = 0;
        
        // Check usage for each template
        for (const template of templates) {
            const templateTxId = template.data.TxId;
            const templateName = template.data.template;
            const templateDid = template.oip.didTx;
            const fieldCount = template.data.fieldsInTemplateCount || 0;
            
            totalFields += fieldCount;
            
            console.log(`🔍 Checking template: ${templateName} (${fieldCount} fields)`);
            
            const isInUse = await checkTemplateUsage(templateTxId);
            
            const templateInfo = {
                name: templateName,
                txId: templateTxId,
                did: templateDid,
                creator: template.oip.creator?.creatorHandle || 'Unknown',
                createdAt: template.oip.indexedAt,
                fieldCount: fieldCount,
                blockHeight: template.oip.inArweaveBlock
            };
            
            if (isInUse) {
                usedTemplates.push(templateInfo);
                console.log(`✅ Template "${templateName}" is in use`);
            } else {
                unusedTemplates.push(templateInfo);
                unusedFields += fieldCount;
                console.log(`❌ Template "${templateName}" is NOT in use (${fieldCount} fields)`);
            }
        }
        
        // Sort unused templates by field count (highest first) to prioritize deletion
        unusedTemplates.sort((a, b) => b.fieldCount - a.fieldCount);
        
        const analysis = {
            totalTemplates: templates.length,
            usedTemplates: usedTemplates.length,
            unusedTemplates: unusedTemplates.length,
            totalFields: totalFields,
            unusedFields: unusedFields,
            potentialSavings: `${unusedFields} fields (${Math.round(unusedFields/totalFields*100)}% reduction)`,
            templates: {
                used: usedTemplates,
                unused: unusedTemplates
            }
        };
        
        res.json({
            success: true,
            message: 'Template analysis completed',
            analysis: analysis
        });
        
    } catch (error) {
        console.error('Error analyzing templates:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to analyze templates',
            details: error.message
        });
    }
});

/**
 * POST /api/cleanup/delete-unused-templates
 * Delete all unused templates (requires confirmation)
 */
router.post('/delete-unused-templates', authenticateToken, async (req, res) => {
    try {
        const { confirm, maxToDelete } = req.body;
        
        if (!confirm) {
            return res.status(400).json({
                success: false,
                error: 'Confirmation required. Send {"confirm": true} to proceed.'
            });
        }
        
        console.log('🗑️  Starting unused template deletion...');
        
        // Get all templates and find unused ones
        const templatesData = await getTemplatesInDB();
        const templates = templatesData.templatesInDB;
        
        const unusedTemplates = [];
        
        for (const template of templates) {
            const templateTxId = template.data.TxId;
            const templateName = template.data.template;
            const templateDid = template.oip.didTx;
            const fieldCount = template.data.fieldsInTemplateCount || 0;
            
            const isInUse = await checkTemplateUsage(templateTxId);
            
            if (!isInUse) {
                unusedTemplates.push({
                    name: templateName,
                    txId: templateTxId,
                    did: templateDid,
                    fieldCount: fieldCount,
                    creator: template.oip.creator?.creatorHandle || 'Unknown'
                });
            }
        }
        
        // Limit deletion count if specified
        const templatesToDelete = maxToDelete ? 
            unusedTemplates.slice(0, maxToDelete) : 
            unusedTemplates;
        
        console.log(`🗑️  Found ${unusedTemplates.length} unused templates, deleting ${templatesToDelete.length}...`);
        
        const deletionResults = [];
        let totalFieldsFreed = 0;
        
        for (const template of templatesToDelete) {
            try {
                console.log(`🗑️  Deleting template: ${template.name} (${template.fieldCount} fields)`);
                
                const deleteMessage = {
                    delete: {
                        didTx: template.did
                    }
                };
                
                // Publish delete message to Arweave
                const result = await publishNewRecord(
                    deleteMessage, 
                    'deleteMessage', 
                    false, // publishFiles
                    true,  // addMediaToArweave
                    false, // addMediaToIPFS
                    null,  // youtubeUrl
                    'arweave' // blockchain
                );
                
                if (result && result.transactionId) {
                    deletionResults.push({
                        template: template.name,
                        did: template.did,
                        fieldCount: template.fieldCount,
                        deleteTransactionId: result.transactionId,
                        status: 'success'
                    });
                    totalFieldsFreed += template.fieldCount;
                    console.log(`✅ Delete message published: ${result.transactionId}`);
                } else {
                    deletionResults.push({
                        template: template.name,
                        did: template.did,
                        fieldCount: template.fieldCount,
                        status: 'failed',
                        error: 'No transaction ID returned'
                    });
                    console.log(`❌ Failed to publish delete message for ${template.name}`);
                }
                
                // Wait between deletions to avoid overwhelming the system
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                deletionResults.push({
                    template: template.name,
                    did: template.did,
                    fieldCount: template.fieldCount,
                    status: 'error',
                    error: error.message
                });
                console.error(`❌ Error deleting template ${template.name}:`, error);
            }
        }
        
        const successCount = deletionResults.filter(r => r.status === 'success').length;
        
        res.json({
            success: true,
            message: `Template deletion process completed. ${successCount}/${templatesToDelete.length} templates deleted.`,
            results: {
                totalUnused: unusedTemplates.length,
                attempted: templatesToDelete.length,
                successful: successCount,
                totalFieldsFreed: totalFieldsFreed,
                deletions: deletionResults
            }
        });
        
    } catch (error) {
        console.error('Error deleting unused templates:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete unused templates',
            details: error.message
        });
    }
});

/**
 * POST /api/cleanup/delete-template
 * Delete a specific template by DID (requires confirmation)
 */
router.post('/delete-template', authenticateToken, async (req, res) => {
    try {
        const { templateDid, confirm } = req.body;
        
        if (!templateDid) {
            return res.status(400).json({
                success: false,
                error: 'templateDid is required'
            });
        }
        
        if (!confirm) {
            return res.status(400).json({
                success: false,
                error: 'Confirmation required. Send {"confirm": true} to proceed.'
            });
        }
        
        console.log(`🗑️  Deleting specific template: ${templateDid}`);
        
        const deleteMessage = {
            delete: {
                didTx: templateDid
            }
        };
        
        // Publish delete message to Arweave
        const result = await publishNewRecord(
            deleteMessage, 
            'deleteMessage', 
            false, // publishFiles
            true,  // addMediaToArweave
            false, // addMediaToIPFS
            null,  // youtubeUrl
            'arweave' // blockchain
        );
        
        if (result && result.transactionId) {
            res.json({
                success: true,
                message: 'Template deletion message published successfully',
                templateDid: templateDid,
                deleteTransactionId: result.transactionId
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to publish delete message',
                templateDid: templateDid
            });
        }
        
    } catch (error) {
        console.error('Error deleting specific template:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete template',
            details: error.message
        });
    }
});

module.exports = router;
