# Template Cleanup Guide

## Overview

The Template Cleanup system provides tools to identify and delete unused templates to resolve Elasticsearch field limit issues. When your system hits the default 1000-field limit per index, cleaning up unused templates is often a better solution than simply increasing limits.

## Problem Background

### The Field Limit Issue
Elasticsearch has a default limit of **1000 fields per index** to prevent performance issues. Complex templates with many fields (especially those with enums, nested objects, and dynamic mappings) can quickly consume this limit.

**Common Error:**
```
illegal_argument_exception: Limit of total fields [1000] has been exceeded while adding new fields [14]
```

### Why Templates Accumulate
- **Development iterations**: Creating multiple versions while refining templates
- **Mistakes and corrections**: Publishing templates with errors, then creating corrected versions
- **Testing**: Creating templates for testing that are never used in production
- **Complex field structures**: Fitness templates, organization templates, etc. with many enum values

## Solution Architecture

### Core Components

1. **Analysis Engine** (`/api/cleanup/analyze-templates`)
   - Scans all templates in the database
   - Checks record usage for each template
   - Calculates field usage and potential savings

2. **Deletion System** (`/api/cleanup/delete-unused-templates`)
   - Safely removes unused templates
   - Publishes proper delete messages to Arweave
   - Provides detailed operation results

3. **Web Interface** (`/template-cleanup.html`)
   - User-friendly dashboard for template management
   - Real-time analysis with visual statistics
   - Secure JWT-based authentication

### Safety Mechanisms

#### Usage Verification
```javascript
async function checkTemplateUsage(templateTxId) {
    // Gets all records and templates
    const result = await getRecordsInDB();
    const templatesData = await getTemplatesInDB();
    
    // Finds template by TxId
    const targetTemplate = templates.find(t => t.data.TxId === templateTxId);
    const templateName = targetTemplate.data.template;
    
    // Filters records that use this template
    const recordsUsingTemplate = records.filter(record => {
        return Object.keys(record.data).includes(templateName);
    });
    
    return recordsUsingTemplate.length > 0;
}
```

#### Authorization Checks
- Only template creators can delete their templates
- JWT authentication required for all operations
- Creator DID verification: `creatorDid === 'did:arweave:' + transaction.creator`

#### Delete Message Publishing
Templates are deleted by publishing delete messages to Arweave:
```json
{
    "delete": {
        "didTx": "did:arweave:TEMPLATE_TRANSACTION_ID"
    }
}
```

## API Reference

### Authentication
All cleanup endpoints require JWT authentication:
```http
Authorization: Bearer YOUR_JWT_TOKEN
```

### GET /api/cleanup/analyze-templates

Analyzes template usage and identifies unused templates.

**Response:**
```json
{
    "success": true,
    "message": "Template analysis completed",
    "analysis": {
        "totalTemplates": 45,
        "usedTemplates": 12,
        "unusedTemplates": 33,
        "totalFields": 1247,
        "unusedFields": 892,
        "potentialSavings": "892 fields (72% reduction)",
        "templates": {
            "used": [...],
            "unused": [
                {
                    "name": "organization",
                    "txId": "ABC123...",
                    "did": "did:arweave:ABC123...",
                    "creator": "Librarian7",
                    "createdAt": "2025-01-15T10:30:00Z",
                    "fieldCount": 14,
                    "blockHeight": 1754285
                }
            ]
        }
    }
}
```

### POST /api/cleanup/delete-unused-templates

Deletes all unused templates (requires confirmation).

**Request:**
```json
{
    "confirm": true,
    "maxToDelete": 10  // Optional: limit deletions
}
```

**Response:**
```json
{
    "success": true,
    "message": "Template deletion process completed. 8/10 templates deleted.",
    "results": {
        "totalUnused": 33,
        "attempted": 10,
        "successful": 8,
        "totalFieldsFreed": 156,
        "deletions": [
            {
                "template": "organization",
                "did": "did:arweave:ABC123...",
                "fieldCount": 14,
                "deleteTransactionId": "XYZ789...",
                "status": "success"
            }
        ]
    }
}
```

### POST /api/cleanup/delete-template

Deletes a specific template by DID.

**Request:**
```json
{
    "templateDid": "did:arweave:TEMPLATE_DID_HERE",
    "confirm": true
}
```

**Response:**
```json
{
    "success": true,
    "message": "Template deletion message published successfully",
    "templateDid": "did:arweave:TEMPLATE_DID_HERE",
    "deleteTransactionId": "DELETE_TX_ID"
}
```

## Web Interface Guide

### Accessing the Interface

Navigate to: `https://your-server.com/template-cleanup.html`

### Step-by-Step Usage

#### 1. Authentication
- Enter your JWT token in the authentication section
- Click "Set Token" to enable cleanup features
- Status indicator shows authentication success

#### 2. Template Analysis
- Click "🔍 Analyze Templates" to scan your database
- Review the statistics dashboard:
  - **Total Templates**: All templates in database
  - **Unused Templates**: Templates with no records
  - **Unused Fields**: Total fields that can be freed
  - **Potential Savings**: Percentage reduction possible

#### 3. Review Template Lists
- **Unused Templates**: Red-tagged templates safe to delete
- **Used Templates**: Green-tagged templates currently in use
- Each template shows:
  - Template name and creator
  - Creation date and DID
  - Field count contribution

#### 4. Cleanup Options

**Bulk Deletion:**
- Delete all unused templates at once
- Optional: Set maximum number to delete per batch
- Confirmation dialog prevents accidents

**Individual Deletion:**
- Enter specific template DID
- Useful for targeted cleanup
- Immediate confirmation required

### Interface Features

#### Real-time Statistics
```
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│ Total Templates │ Unused Templates│  Unused Fields  │ Potential Savings│
│       45        │       33        │      892        │       72%       │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┘
```

#### Template Status Indicators
- 🗑️ **UNUSED**: Safe to delete, no records using it
- ✅ **IN USE**: Has records, cannot be deleted
- Field count badges show impact of each template

#### Operation Results
- Real-time progress updates
- Detailed transaction IDs for audit trail
- Success/failure status for each operation
- Total field savings calculations

## Best Practices

### When to Run Cleanup

1. **Before hitting field limits**: Proactive maintenance
2. **After development cycles**: Clean up test/development templates
3. **Regular maintenance**: Monthly or quarterly cleanup
4. **Before major deployments**: Ensure clean slate for new templates

### Recommended Workflow

1. **Start Small**: Delete 5-10 templates first to test
2. **Monitor Results**: Check that indexing errors stop
3. **Gradual Scaling**: Increase batch sizes as confidence grows
4. **Document Changes**: Keep track of what was deleted

### Safety Guidelines

- ✅ **Always run analysis first** to understand impact
- ✅ **Review unused template list** before bulk deletion
- ✅ **Start with small batches** (5-10 templates)
- ✅ **Monitor system logs** during and after cleanup
- ✅ **Keep audit trail** of deletion transaction IDs
- ❌ **Don't delete templates without analysis**
- ❌ **Don't ignore confirmation dialogs**
- ❌ **Don't run cleanup during high-traffic periods**

## Troubleshooting

### Common Issues

#### "Template is in use" Error
```json
{
    "error": "Template is in use by existing records and cannot be deleted"
}
```
**Solution**: This is working correctly - the template has records using it and should not be deleted.

#### Authentication Failures
```json
{
    "error": "Unauthorized: only the template creator can delete this template"
}
```
**Solution**: Ensure you're using the JWT token of the template creator.

#### Network Timeouts
**Solution**: 
- Reduce batch size (`maxToDelete` parameter)
- Wait between operations
- Check server logs for processing status

### Verification Steps

After cleanup, verify success:

1. **Check Elasticsearch logs** for field limit errors
2. **Monitor template indexing** for new templates
3. **Run analysis again** to confirm field reduction
4. **Test new template creation** to ensure system works

### Recovery Procedures

If templates are accidentally deleted:
- **Templates cannot be recovered** once delete messages are processed
- **Recreate templates** from backup or source definitions
- **Re-publish any records** that used the deleted templates

## Technical Implementation

### Database Integration

The cleanup system integrates with existing Elasticsearch indices:

```javascript
// Template existence check
const searchResponse = await elasticClient.search({
    index: 'templates',
    body: {
        query: {
            match: { "oip.didTx": templateDid }
        }
    }
});

// Template deletion
const response = await elasticClient.delete({
    index: 'templates',
    id: templateId
});
```

### Delete Message Flow

1. **Client Request**: User initiates deletion via API/UI
2. **Usage Verification**: System checks if template is used
3. **Authorization Check**: Verifies creator permissions
4. **Delete Message Creation**: Builds Arweave delete message
5. **Publishing**: Publishes delete message to Arweave
6. **Processing**: Background indexer processes delete message
7. **Cleanup**: Template removed from Elasticsearch

### Field Limit Calculation

```javascript
// Calculate total fields across all templates
let totalFields = 0;
templates.forEach(template => {
    totalFields += template.data.fieldsInTemplateCount || 0;
});

// Calculate potential savings
const unusedFields = unusedTemplates.reduce((sum, template) => {
    return sum + (template.fieldCount || 0);
}, 0);

const potentialSavings = Math.round(unusedFields / totalFields * 100);
```

## Configuration

### Environment Variables

No additional environment variables required - uses existing Elasticsearch and authentication configuration.

### Route Registration

Templates cleanup routes are automatically registered in `index.js`:
```javascript
const cleanupRoutes = require('./routes/cleanup');
app.use('/api/cleanup', cleanupRoutes);
```

### Dependencies

- Express.js for API endpoints
- Elasticsearch client for database operations
- JWT authentication middleware
- Template helper for delete message publishing

## Monitoring and Metrics

### Key Metrics to Track

1. **Field Usage**: Monitor total fields vs limit
2. **Template Growth**: Track new template creation rate
3. **Cleanup Frequency**: How often cleanup is needed
4. **Success Rate**: Percentage of successful deletions
5. **Field Savings**: Total fields freed over time

### Log Messages

Look for these log entries:
```
✅ Template deletion message published: TX_ID
🗑️ Template deleted: TEMPLATE_NAME (X fields)
📊 Records using template: 0
⚠️ Template is in use by existing records
```

## Future Enhancements

### Planned Features

1. **Automated Cleanup**: Scheduled cleanup of old unused templates
2. **Template Analytics**: Usage patterns and lifecycle analysis  
3. **Backup Integration**: Export templates before deletion
4. **Bulk Template Import**: Restore templates from backups
5. **Field Usage Alerts**: Proactive notifications before limits

### API Extensions

1. **Template Export**: `GET /api/cleanup/export-templates`
2. **Template Import**: `POST /api/cleanup/import-templates`
3. **Usage Analytics**: `GET /api/cleanup/template-analytics`
4. **Cleanup History**: `GET /api/cleanup/deletion-history`

---

## Conclusion

The Template Cleanup system provides a surgical approach to managing Elasticsearch field limits by removing unused templates rather than simply increasing limits. This maintains system performance while providing the flexibility needed for template development and iteration.

Regular use of this system as part of maintenance workflows will prevent field limit issues and keep your OIP deployment running smoothly.
