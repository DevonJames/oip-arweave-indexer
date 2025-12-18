Let me explore the codebase to understand how templates are currently processed and how Elasticsearch mappings are created.

[5 tools called]

Let me look at the full `processNewTemplate` function to understand the complete template indexing flow:

[3 tools called]

Now I have a complete picture of the flow. Let me look at how templates are fetched to understand how we can get the canonical template's fields:

[1 tool called]

I now understand the full problem and have a solution. Let me implement it.

## Solution Overview

Your approach is exactly right. The key insight is to **decouple the ES mapping creation from the template being indexed**. We should:

1. **Index the template as-is** (preserving block height tracking)
2. **Generate ES mapping using canonical template's field types** (from `templates.config.js`)

Here's the implementation:

[1 tool called]

Now let me update `generateElasticsearchMappings.js` to use the canonical resolver:

[3 tools called]

Let me also add logic to detect when the canonical template itself is being processed:

[1 tool called]

I need to add a function that can fetch the canonical template directly from Arweave when it's not yet in ES. Let me update the resolver:

[6 tools called]

Now let me update the call in `processNewTemplate` to pass the txid:

[5 tools called]

I've implemented a complete solution. Here's a summary of what was done:

## Summary: Canonical Template Resolver

### Problem
When building the index from scratch, templates are processed chronologically from Arweave. If an early version of a template (like `recipe`) had incorrect field types (e.g., `ingredient_unit: repeated float` instead of `repeated string`), the ES mapping gets created with the wrong type. Later corrected versions can't change the mapping, and records using correct types fail to index.

### Solution
Created a **canonical template resolver** that:

1. **Checks `templates.config.js`** - When generating ES mappings for a template, it checks if there's a canonical (correct) version defined in the config

2. **Fetches canonical field types** - Gets the canonical template's field definitions from:
   - Elasticsearch (if already indexed)
   - **Arweave directly** (if not yet in ES - crucial for initial sync!)

3. **Overrides incorrect types** - For any field where the template being indexed has a different type than the canonical, uses the canonical type for the ES mapping

4. **Detects canonical templates** - When the canonical template itself is being processed, it's recognized and its types are used directly (and cached for future reference)

### Files Created/Modified

**New file: `helpers/canonicalTemplateResolver.js`**
- `getCanonicalTemplateTxid()` - Gets canonical txid from config
- `fetchTemplateFromArweave()` - Fetches template directly from Arweave  
- `getCanonicalTemplateFields()` - Gets canonical fields (ES first, then Arweave)
- `mergeWithCanonicalFieldTypes()` - Merges template fields with canonical types
- `isCanonicalTemplate()` - Detects if a template IS the canonical one

**Modified: `helpers/generateElasticsearchMappings.js`**
- `updateRecordsMappingForTemplate()` now uses canonical types
- `updateMappingForNewTemplate()` accepts template txid

**Modified: `helpers/elasticsearch.js` and `helpers/core/elasticsearch.js`**
- `processNewTemplate()` now passes txid to mapping function

### How It Works (Example)

```
Processing template: recipe (txid: ABC123 - incorrect version)
   - ingredient_unit: repeated float ❌

📋 [Mapping] Template 'recipe' has canonical version - checking for type overrides...
[CanonicalResolver] Canonical template for 'recipe' not in ES, fetching from Arweave...
[CanonicalResolver] Fetched template SLsJ91-Z82rRBPkDrZlG87aIpbw6zOlmK96nh5uf6G4 from https://arweave.net

🔄 [CanonicalResolver] Field type overrides for template 'recipe':
   📋 ingredient_unit: repeated float → repeated string (using canonical)

✅ Elasticsearch mapping auto-generated for new template: recipe
   - ingredient_unit: text (correct!) ✅
```

### Key Features

1. **Proactive resolution** - Fetches canonical template from Arweave even before it's indexed
2. **Caching** - Caches canonical fields to avoid repeated network calls
3. **Preserves block height tracking** - Templates are still indexed as-is; only ES mappings use canonical types
4. **Graceful fallback** - If canonical can't be fetched, uses template's own types

### Testing

To test this, you can:
1. Clear your ES indices and rebuild from scratch
2. Watch the logs for `[CanonicalResolver]` messages showing type overrides
3. After sync completes, verify that records with corrected templates are now indexed correctly