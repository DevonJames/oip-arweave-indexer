# Fix: ALFRED Notes RAG Context Not Being Passed to LLM

## Problem Summary

The `/api/notes/converse` endpoint was hanging and not returning responses. The issue was NOT that Ollama wasn't running (it was running remotely), but that **the transcript and note context were not being properly passed to the LLM**.

## Root Cause Analysis

### The Flow

1. `routes/notes.js` builds a comprehensive `context` object with:
   - `currentNote`: title, type, date, summary, key points, decisions, action items
   - `transcript`: the full transcript text
   - `chunks`: array of transcript chunks
   - `relatedContent`: related notes/chunks

2. `routes/notes.js` also builds an `enhancedQuestion` string that formats all this context beautifully with the transcript

3. It calls `alfred.query()` passing:
   - `pinnedJsonData: context` (the structured object)
   - `existingContext: enhancedQuestion` (the formatted string)

4. `alfred.js` sees `pinnedJsonData` and calls `answerQuestionAboutPinnedData()`

5. That method wraps the context in a mockRecord and calls `extractAndFormatContent()`

6. `extractAndFormatContent()` calls `generateRAGResponse()` with `contentItems`

### The Problem

In `generateRAGResponse()` (lines 1566-1703 in alfred.js), the code loops through `contentItems` expecting objects with these properties:
- `title`
- `description`
- `fullText`
- `articleText`
- `type` (with specific handlers for 'recipe', 'exercise', 'workout', 'documentation')

But the notes `context` object has a completely different structure:
```javascript
{
  currentNote: { ... },
  transcript: "text",
  chunks: [...],
  relatedContent: [...]
}
```

This structure doesn't match ANY of the expected content item types, so the context-building loop produces **almost nothing**. The LLM receives an empty or nearly-empty context, so it can't answer the question.

Meanwhile, the beautifully formatted `enhancedQuestion` string (passed as `existingContext`) with ALL the transcript text was being **completely ignored**.

## The Fix

### Change 1: Use `existingContext` in `generateRAGResponse()`

**File**: `helpers/alfred.js`, line ~1563

Added a check at the beginning of the context-building section:

```javascript
// SPECIAL CASE: If existingContext is provided (e.g., from notes endpoint), use it directly
if (options.existingContext && typeof options.existingContext === 'string' && options.existingContext.length > 0) {
    console.log(`[ALFRED] 📋 Using pre-formatted existingContext (${options.existingContext.length} chars) instead of building from contentItems`);
    context = options.existingContext;
} else {
    // Build context from content items (normal flow)
    try {
        contentItems.forEach((item, index) => {
            // ... existing content building logic ...
        });
    } catch (error) {
        console.warn('[ALFRED] Error building context from contentItems:', error.message);
    }
}
```

This allows endpoints like `/api/notes/converse` to provide a pre-formatted context string that gets used directly in the LLM prompt, bypassing the contentItems-based context building.

### Change 2: Pass Context String Correctly from Notes Route

**File**: `routes/notes.js`, line ~1128

Modified to:
1. Build a `contextString` instead of `enhancedQuestion`
2. Remove the question from the context (it's added separately in the prompt)
3. Include the FULL transcript (removed 4000 char truncation)
4. Pass it as `existingContext` option
5. Add logging to show context length

```javascript
const contextString = `You are answering questions about a specific meeting note.

Note Title: ${context.currentNote.title}
Note Type: ${context.currentNote.type}
Date: ${context.currentNote.date}
...

Full Transcript:
${transcriptText}

...`;

const alfredOptions = {
    model: model,
    conversationHistory: conversationHistory,
    pinnedJsonData: context, // Pass structured context (for metadata)
    existingContext: contextString, // Pass formatted context string (for LLM prompt)
    useFieldExtraction: true
};
```

### Change 3: Better Error Handling (Bonus)

**File**: `helpers/alfred.js`, line ~1770

Already improved in previous commit:
- Reduced Ollama timeout from 25s to 15s for faster failure detection
- Added specific error messages for connection issues
- Better logging before making Ollama API calls

## How It Works Now

### Request Flow

1. iOS app → `/api/notes/converse` with `noteDid` and `question`
2. `routes/notes.js`:
   - Fetches note record with transcript (resolveDepth=1)
   - Extracts transcript text from resolved reference
   - Builds context object with summary, decisions, action items
   - Formats everything into a `contextString`
3. `routes/notes.js` calls `alfred.query()` with:
   - `question`: the user's question
   - `options.existingContext`: the formatted context string
   - `options.pinnedJsonData`: the structured context object
4. `alfred.js`:
   - Sees `pinnedJsonData`, calls `answerQuestionAboutPinnedData()`
   - That calls `extractAndFormatContent()`
   - That calls `generateRAGResponse()`
5. `generateRAGResponse()`:
   - Sees `options.existingContext` is provided
   - **Uses it directly** instead of trying to build context from contentItems
   - Constructs prompt with the pre-formatted context
   - Calls Ollama with model `llama3.2:3b`
6. Ollama processes the prompt and returns answer
7. Response flows back through the stack to iOS app

### Prompt Structure

The final prompt sent to Ollama looks like:

```
You are ALFRED, an AI assistant that answers questions directly and clearly...

Information available:
You are answering questions about a specific meeting note.

Note Title: MEETING: This is my meeting...
Note Type: MEETING
Date: 2025-11-21T01:41:01.223Z

Key Points from Summary:
1. Legos
2. sweatshirts
3. Grandma's trip

Decisions Made:
1. Not going to Grandma's house today, but it will probably happen soon

Action Items:
1. Build Legos together (Assignee: unassigned, Due: no date)

Full Transcript:
This is my meeting. I am meeting with Mr. Matthew James and we are talking about Legos and sweatshirts and sounds and going to Grandma's house and he would very much like to go to Grandma's house. That is what his goal is. But I think the decision is that that won't be happening today, but it will probably be happening soon but maybe not necessarily tomorrow because Grandma is going to be going on a trip. Otherwise, next steps are we're going to build some Legos together and he really wants to put on his new sweatshirt so we're gonna go ahead and put on his new sweatshirt now.

User's Question: why can't matty goto grandmas house tomorrow?

CRITICAL INSTRUCTIONS:
1. Answer the user's question DIRECTLY using the information provided above
...

Answer the question directly and conversationally:
```

Now the LLM has ALL the context it needs to answer: "Matty can't go to Grandma's house tomorrow because Grandma is going to be going on a trip."

## Testing

### Test Case 1: With the Fix

```bash
curl -X POST http://api.oip.onl/api/notes/converse \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "noteDid": "did:gun:647f79c2a338:72aa9736fa968ac2dbdecd7753dece2035a9c30cf527b58a47ed6406fc3ffdea",
    "question": "why cant matty goto grandmas house tomorrow?",
    "model": "llama3.2:3b"
  }'
```

**Expected Output:**
```json
{
  "success": true,
  "answer": "Matty can't go to Grandma's house tomorrow because Grandma is going to be going on a trip.",
  "context": {
    "note": {
      "did": "did:gun:647f79c2a338:...",
      "title": "MEETING: This is my meeting...",
      "type": "MEETING"
    },
    "chunks_count": 0,
    "related_content_count": 1,
    "transcript_length": 583
  },
  "model": "llama3.2:3b"
}
```

### Logs to Expect

```
[ALFRED Notes RAG] Step 5: Building context for ALFRED...
[ALFRED Notes RAG] Context built:
  - Transcript: 583 chars
  - Chunks: 0
  - Related content: 1 items
[ALFRED Notes RAG] Step 6: Calling ALFRED for response...
[ALFRED Notes RAG] Context string length: 1200 chars
[ALFRED] 🔍 Processing query: "why can't matty goto grandmas house tomorrow?"
[ALFRED] 📄 Pinned data detected, answering about provided content
[ALFRED] 📄 Processing pinned data for question: "why can't matty goto grandmas house tomorrow?"
[ALFRED] 📄 Data type: unknown, Content length: N/A
[ALFRED] 📄 Processing as general content
[ALFRED] Generating RAG response for question: "why can't matty goto grandmas house tomorrow?"
[ALFRED] 📋 Using pre-formatted existingContext (1200 chars) instead of building from contentItems
[ALFRED] 🎯 Using specific model (no racing): llama3.2:3b
[ALFRED] 📡 Calling Ollama at http://ollama:11434 with model llama3.2:3b...
[ALFRED] ✅ Ollama responded with 87 chars
[ALFRED Notes RAG] ✅ Response generated (87 chars)
```

## Benefits of This Fix

1. **✅ Correct Context**: Transcript and note metadata are now properly passed to the LLM
2. **✅ Full Transcript**: No more 4000 char truncation (was arbitrary)
3. **✅ Better Logging**: Can see context string length and track flow
4. **✅ Flexible**: The `existingContext` option can be used by other endpoints too
5. **✅ Backward Compatible**: Normal RAG flow (without `existingContext`) still works
6. **✅ Efficient**: Avoids unnecessary contentItems processing for notes

## Related Changes

- Error handling improvements (Ollama connection errors)
- Timeout reduction (25s → 15s for faster failure detection)
- Better log messages throughout the flow

## Files Modified

1. `helpers/alfred.js`:
   - Added `existingContext` support in `generateRAGResponse()`
   - Improved error handling for Ollama calls
   - Better logging

2. `routes/notes.js`:
   - Fixed context string building
   - Removed arbitrary transcript truncation
   - Added context length logging
   - Clarified option names

## Lessons Learned

1. **Data Structure Mismatch**: When integrating new endpoints with existing systems, check that data structures match expected formats
2. **Options Should Be Used**: If you're passing an option, make sure it's actually used somewhere
3. **Debug Strategically**: The logs said "Processing as general content" and "Content length: N/A" - these were clues that the context wasn't being extracted
4. **Test the Full Flow**: End-to-end testing would have caught this immediately

## Future Improvements

Consider adding:
1. A `notes` content type handler in `extractAndFormatContent()`
2. Validation that `contentItems` has expected structure
3. Warnings when context string is empty or very short
4. Unit tests for context building from different data structures

