# Intelligent Question Processor Guide

## Overview

The Intelligent Question Processor (IQP) is a sophisticated helper that enhances the AI Assistant's ability to understand and answer complex questions by intelligently extracting search terms, applying filters, and refining results using tag analysis.

## Key Features

### 1. Enhanced Subject and Modifier Detection
- **Smart Parsing**: Separates main subjects from descriptive modifiers
- **Context-Aware**: Adapts parsing based on question type (recipes, news, workouts, etc.)
- **Stop Word Filtering**: Removes question words to focus on meaningful content
- **Compound Term Recognition**: Handles multi-word subjects like "fort knox"

### 2. Multi-Step Search Refinement
- **Initial Search**: Broad search using extracted subject and record type
- **Tag Analysis**: Uses tag summarization to find relevant modifiers
- **Refinement**: Narrows results using AND logic with matching tags
- **Content Extraction**: Retrieves full text from post records when available

### 3. RAG-Ready Context Building
- **Full Text Retrieval**: Fetches complete article content from webUrl references
- **Structured Context**: Organizes information for optimal LLM processing
- **Source Attribution**: Maintains references to original records

## Example Workflow: Fort Knox Audit Question

**User Question**: "when is the last time the gold at fort knox was audited"

**Processing Steps**:

1. **Subject/Modifier Extraction**:
   - Subject: "fort knox"
   - Modifiers: ["gold"]
   - Record Type: "post" (detected from audit/news context)

2. **Initial Search**:
   ```javascript
   {
     search: "fort knox",
     recordType: "post", 
     resolveDepth: 2
   }
   ```

3. **Tag Refinement** (if multiple results):
   ```javascript
   {
     search: "fort knox",
     recordType: "post",
     summarizeTags: true,
     tagCount: 30
   }
   ```

4. **Enhanced Search** (with matching tags):
   ```javascript
   {
     search: "fort knox",
     recordType: "post",
     tags: "gold,audit",
     tagsMatchMode: "AND",
     resolveDepth: 2
   }
   ```

5. **Content Extraction**:
   - Extract `basic.name` and `basic.description`
   - Fetch full text from `post.articleText.data.text.webUrl`
   - Build structured context for RAG

6. **RAG Response**: 
   - Expected: "The last time anyone got a glimpse of the gold was during a staged audit in 1974..."

## Integration with AI Assistant

### Automatic Activation

The IQP automatically activates when:
- `include_filter_analysis: true` is set in the request
- No specific filters are provided (recordType, tags, creatorHandle)
- The question requires intelligent parsing

### Frontend Integration

In the reference client's AI Assistant (ALFRED drawer), questions are processed through the enhanced pipeline:

```javascript
// Enhanced request to /api/voice/chat
{
  text: userQuestion,
  include_filter_analysis: true,
  model: selectedModel
}
```

### Fallback Behavior

If IQP fails, the system gracefully falls back to the legacy RAG processing method, ensuring reliability.

## Record Type Detection

The IQP intelligently detects record types based on question context:

### Post Records (News/Information)
**Triggers**: `audit`, `investigation`, `when`, `where`, `who`, `what happened`, `last time`
**Examples**: 
- "when was fort knox last audited"
- "what happened with Iran recently"

### Recipe Records  
**Triggers**: `recipe`, `cook`, `grilled`, `baked`, cuisine names (`greek`, `italian`)
**Examples**:
- "how long does the grilled greek chicken recipe need to cook"
- "what ingredients are in the mediterranean salmon dish"

### Workout Records
**Triggers**: `workout`, `exercise`, `fitness`, difficulty levels (`beginner`, `advanced`)
**Examples**:
- "what equipment do I need for the beginner chest workout"
- "how many sets in the advanced cardio routine"

### Video Records
**Triggers**: `video`, `watch`, `film`, `youtube`, `documentary`
**Examples**:
- "show me the documentary about climate change"

## Subject and Modifier Examples

### Audit Questions
- **Input**: "when is the last time the gold at fort knox was audited"
- **Subject**: "fort knox"
- **Modifiers**: ["gold"]
- **Type**: "post"

### Recipe Questions  
- **Input**: "how long does the grilled greek chicken recipe need to cook"
- **Subject**: "chicken"
- **Modifiers**: ["grilled", "greek"]
- **Type**: "recipe"

### News Questions
- **Input**: "what happened with Iran's nuclear program recently"  
- **Subject**: "iran"
- **Modifiers**: ["nuclear", "program"]
- **Type**: "post"

## Configuration Options

### IQP Options
```javascript
{
  resolveDepth: 2,           // How deeply to resolve record references
  limit: 20,                 // Maximum records to retrieve
  maxTagsToAnalyze: 30,      // Maximum tags to consider for refinement
  maxRecordsForTagAnalysis: 50 // Maximum records to analyze for tags
}
```

### RAG Integration Options
```javascript
{
  include_filter_analysis: true,  // Enable IQP processing
  useIntelligentProcessing: true, // Legacy flag for compatibility
  searchParams: {                 // Direct search parameters (bypasses IQP)
    recordType: "post",
    tags: "specific,tags",
    creatorHandle: "creator_name"
  }
}
```

## Testing

Run the test suite to verify IQP functionality:

```bash
node test/test-intelligent-question-processor.js
```

This tests:
- Subject/modifier extraction accuracy
- Record type detection
- Filter generation
- Tag matching algorithms

## Advanced Features

### Compound Term Recognition
Handles multi-word subjects like:
- "fort knox" 
- "federal reserve"
- "social security"
- "climate change"

### Context-Aware Parsing
Adapts parsing strategy based on:
- Question type (when, where, who, what, how)
- Domain context (cooking, fitness, news, etc.)
- Temporal indicators (recently, last time, latest)

### Smart Fallbacks
- If no compound terms found, uses first meaningful word
- If no modifiers detected, uses broader search
- If tag refinement fails, uses initial results
- If IQP fails entirely, falls back to legacy RAG

## Performance Considerations

### Optimization Features
- **Early Termination**: Stops processing when perfect match found
- **Selective Analysis**: Only analyzes tags when multiple results exist
- **Content Caching**: Caches fetched full-text content
- **Parallel Processing**: Fetches multiple content sources simultaneously

### Resource Management
- **Content Limits**: Truncates full text to 8KB to prevent memory issues
- **Request Timeouts**: 10-second timeout for external content fetching
- **Cache Size**: Limits full-text cache to 50 entries

## Troubleshooting

### Common Issues

1. **No Results Found**
   - Check if subject extraction is working correctly
   - Verify record type detection
   - Ensure target records exist in the database

2. **Poor Refinement**
   - Check if modifiers are being extracted properly
   - Verify tag summary contains relevant tags
   - Consider adjusting tag analysis limits

3. **Content Extraction Failures**
   - Verify webUrl fields exist in post records
   - Check if URLs are accessible
   - Monitor timeout and content size limits

### Debug Logging

Enable detailed logging by monitoring console output with `[IQP]` prefix:

```
[IQP] Processing question: "when is the last time the gold at fort knox was audited"
[IQP] Extracted - Subject: "fort knox", Modifiers: [gold], RecordType: "post"
[IQP] Initial search found 15 records
[IQP] Found matching tags for refinement: [gold, audit]
[IQP] ✅ Successfully refined from 15 to 1 results
```

## Integration with Voice Assistant

The IQP seamlessly integrates with the voice chat system in `routes/voice.js`:

1. **Voice Input**: User speaks question to microphone
2. **STT Processing**: Speech converted to text
3. **IQP Analysis**: Text analyzed for subject, modifiers, and context
4. **Enhanced Search**: Multi-step search refinement performed  
5. **Content Extraction**: Full text content retrieved
6. **RAG Processing**: Context-aware response generated
7. **TTS Output**: Response spoken back to user

This creates a complete conversational AI experience that can handle complex, nuanced questions with high accuracy and relevant responses.

## Future Enhancements

### Planned Improvements
- **Semantic Similarity**: Use embedding-based tag matching
- **Learning System**: Learn from user feedback to improve extraction
- **Cross-Type Queries**: Handle questions spanning multiple record types
- **Fuzzy Matching**: Handle spelling variations and synonyms
- **Context Memory**: Remember previous conversation context for follow-up questions

### Performance Optimizations
- **Predictive Caching**: Pre-fetch content for likely follow-up questions
- **Batch Processing**: Process multiple questions simultaneously
- **Smart Indexing**: Create specialized indices for common query patterns
- **Response Compression**: Optimize response size for faster delivery 