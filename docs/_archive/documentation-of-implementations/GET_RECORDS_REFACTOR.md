# getRecords() Refactor Implementation Plan

Due to the massive size of the `getRecords` function (~1900 lines), a complete inline replacement is impractical in a single operation.

## Implementation Strategy

### Approach: Create New Function, Side-by-Side Migration

1. **Create `getRecordsOptimized()` - new function with ES queries**
2. **Add feature flag** to switch between old/new
3. **Gradually test** all parameter combinations
4. **Once validated**, replace old function
5. **Update all callers** to use optimized version

## File to Create

`helpers/elasticsearch-optimized.js` - Contains:
- `getRecordsOptimized()` - Main optimized function
- Uses `buildElasticsearchQuery()` already added
- Uses `buildElasticsearchSort()` already added  
- Maintains all post-processing for complex filters
- ~500 lines instead of 1900

## Timeline

- **Phase 1**: ✅ Complete - Helper functions added
- **Phase 2**: Create `getRecordsOptimized()` in new file
- **Phase 3**: Update routes to use new function with flag
- **Phase 4**: Test all parameters
- **Phase 5**: Replace old function entirely

## Next Step

Creating `/helpers/elasticsearch-optimized.js` with the new implementation.

