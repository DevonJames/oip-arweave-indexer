# AI Model Context Windows

This reference document outlines the context window sizes for various AI models to help determine the appropriate model for document analysis based on token requirements.

## Model Context Windows

| Model | Context Window (Tokens) | Input Price | Output Price | Notes |
|-------|------------------------|-------------|-------------|-------|
| Gemini 1.5 Pro | 2,000,000 | $7/MTok | $7/MTok | Google's model with largest context window |
| Grok-3 | 1,000,000 | - | - | xAI's largest context model |
| Claude 3.7 Sonnet | 200,000 | $3/MTok | $15/MTok | Most intelligent Claude model with step-by-step reasoning |
| Claude 3.5 Haiku | 200,000 | $0.80/MTok | $4/MTok | Fastest, most cost-effective Claude model |
| Claude 3 Opus | 200,000 | $15/MTok | $75/MTok | Powerful Claude model for complex tasks |
| GPT-4 Turbo | 128,000 | $10/MTok | $30/MTok | OpenAI's largest context model |
| Llama 3.1-70B | 128,000 | - | - | Meta's open-source model |
| Grok-2 | 128,000 | - | - | xAI's standard model |

## Usage Guidelines

- For basic document analysis, start with smaller models (Grok-2, GPT-4 Turbo) which are sufficient for most use cases.
- For medium-sized document collections, use Claude 3.7 Sonnet or Claude 3.5 Haiku (up to 200K tokens).
- For large document collections, consider Grok-3 (up to 1M tokens).
- For extremely large document sets, use Gemini 1.5 Pro (up to 2M tokens).
- When all documents cannot fit in even the largest context window, implement document chunking strategies.

## API Fallback Strategy

```javascript
function selectModelByTokenCount(tokenCount) {
  if (tokenCount <= 128000) {
    return { provider: "xai", model: "grok-2-latest", maxTokens: 128000 };
  } else if (tokenCount <= 200000) {
    return { provider: "anthropic", model: "claude-3-7-sonnet-20250219", maxTokens: 200000 };
  } else if (tokenCount <= 200000 && costSensitive) {
    return { provider: "anthropic", model: "claude-3-5-haiku-20240307", maxTokens: 200000 };
  } else if (tokenCount <= 1000000) {
    return { provider: "xai", model: "grok-3", maxTokens: 1000000 };
  } else if (tokenCount <= 2000000) {
    return { provider: "google", model: "gemini-1.5-pro", maxTokens: 2000000 };
  } else {
    return { provider: "chunking_required", model: "chunk-documents", maxTokens: 0 };
  }
}
```

## Cost Considerations

When handling large document sets, consider the trade-offs:
- Smaller models with document chunking may be more cost-effective but could miss cross-document connections
- Larger context models provide better holistic analysis but at higher cost
- Claude models offer a balance of context size and cost, with options for both performance (Sonnet) and economy (Haiku)

Sources:
- [Anthropic Claude Models](https://www.anthropic.com/api)
- [Google Gemini Models](https://ai.google.dev/models/gemini)
- [xAI Grok Models](https://x.ai)
- [OpenAI GPT Models](https://openai.com/api)

Always estimate token usage before sending requests to avoid API errors and unexpected costs. 