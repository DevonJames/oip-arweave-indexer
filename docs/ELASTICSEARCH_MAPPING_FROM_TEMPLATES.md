# Elasticsearch Mapping from OIP Templates

## Problem

Elasticsearch uses **dynamic mapping** - it infers field types from the first value it sees. This causes issues when OIP templates define field types that don't match what Elasticsearch auto-detects:

### Example Issue:
```javascript
// Template defines:
{
  "item_amounts": {
    "type": "repeated float",  // Should be float array
    "index": 6
  }
}

// But if first value happens to be [1, 2, 3], Elasticsearch maps it as long
// Future values like [1.5, 2.3] will fail!
```

## Solution

The system now **automatically generates Elasticsearch mappings from OIP template field types**.

### How It Works

1. **Template Field Types** → **Elasticsearch Types**:
   ```
   string         → text with keyword subfield
   float          → float
   repeated float → float (ES handles arrays automatically)
   long/uint64    → long
   bool           → boolean
   dref           → text with keyword subfield
   enum           → text with keyword subfield
   ```

2. **Auto-generation**: When a new template is published, the system automatically:
   - Reads the `fieldsInTemplate` from the template
   - Converts OIP types to Elasticsearch types
   - Updates the records index mapping
   - Logs the update for verification

3. **Manual Update**: For existing templates, run:
   ```bash
   node config/updateElasticsearchMappings.js
   ```

## Usage

### For New Templates

**Automatic** - No action needed! When you publish a new template via:
```bash
POST /api/templates/newTemplate
```

The system will automatically:
1. Index the template
2. Generate Elasticsearch mapping from field types
3. Update the records index
4. Log the mapping update

### For Existing Templates

Run the mapping generator script:

```bash
# From project root
node config/updateElasticsearchMappings.js
```

This will:
- ✅ Process all 55+ templates in your system
- ✅ Generate mappings for each template's fields
- ✅ Update the records index
- ✅ Reindex existing records to apply mappings
- ✅ Show summary of what was updated

### After Migration

If you've just migrated Elasticsearch data, run:

```bash
# 1. Update mappings from templates
node config/updateElasticsearchMappings.js

# 2. Restart your application
docker-compose restart oip-gpu
```

## Field Type Mapping Reference

| OIP Type | Elasticsearch Type | Notes |
|----------|-------------------|-------|
| `string` | `text` + `.keyword` | Full-text search + exact match |
| `float` | `float` | Decimal numbers |
| `repeated float` | `float` | ES handles arrays automatically |
| `long` | `long` | Integers |
| `uint64` | `long` | Large integers |
| `bool` | `boolean` | true/false |
| `repeated bool` | `boolean` | Array of booleans |
| `dref` | `text` + `.keyword` | Record references |
| `repeated dref` | `text` + `.keyword` | Array of references |
| `enum` | `text` + `.keyword` | Enumerated values |
| `repeated string` | `text` + `.keyword` | Array of strings |

## Integration Points

### 1. Template Publishing (Automatic)

In `helpers/elasticsearch.js` → `processNewTemplate()`:
```javascript
// After template is indexed (line 4363-4370)
const { updateMappingForNewTemplate } = require('./generateElasticsearchMappings');
await updateMappingForNewTemplate(templateName, fieldsInTemplate);
```

### 2. Manual Updates

```bash
node config/updateElasticsearchMappings.js
```

### 3. Docker Integration

Can be added to container startup or Makefile:

```makefile
update-es-mappings: ## Update Elasticsearch mappings from templates
	docker-compose exec oip-gpu node config/updateElasticsearchMappings.js
```

## Benefits

✅ **Type Safety**: Fields maintain correct types regardless of first value  
✅ **Automatic**: New templates automatically get correct mappings  
✅ **Retroactive**: Existing templates can be fixed with one command  
✅ **Consistent**: All nodes use same mappings from shared templates  
✅ **Documented**: Template types serve as mapping documentation  

## Troubleshooting

### Mapping Update Fails

```bash
# Check Elasticsearch logs
docker logs fitnessally-elasticsearch-1 --tail 50

# Verify template has fieldsInTemplate
curl -s 'http://localhost:9210/templates/_search?q=template:shoppingList' | \
  jq '.hits.hits[0]._source.data.fieldsInTemplate'
```

### Types Still Wrong After Update

```bash
# Reindex to apply mapping changes
curl -X POST 'http://localhost:9210/records/_update_by_query?refresh=true&conflicts=proceed'
```

### Check Current Mapping

```bash
# Check a specific template's mapping
curl -s 'http://localhost:9210/records/_mapping' | \
  jq '.records.mappings.properties.data.properties.shoppingList'
```

## Example: Shopping List Template

**Template Definition**:
```json
{
  "item_amounts": {
    "type": "repeated float",
    "index": 6
  },
  "total_cost": {
    "type": "float",
    "index": 3
  }
}
```

**Generated Elasticsearch Mapping**:
```json
{
  "properties": {
    "data": {
      "properties": {
        "shoppingList": {
          "properties": {
            "item_amounts": {
              "type": "float"
            },
            "total_cost": {
              "type": "float"
            }
          }
        }
      }
    }
  }
}
```

**Result**: First value can be `[1, 2, 3]` OR `[1.5, 2.3]` - both work correctly!

## Future Enhancements

Potential improvements:
- Add validation during record publishing to catch type mismatches
- Support for date types and custom analyzers
- Mapping versioning for template updates
- Dry-run mode to preview changes

## Related Files

- `helpers/generateElasticsearchMappings.js` - Core mapping generation logic
- `config/updateElasticsearchMappings.js` - CLI script
- `helpers/elasticsearch.js` - Template processing integration
- `docs/OIP_TECHNICAL_OVERVIEW.md` - Template system documentation
