# X (Twitter) API Setup for Tweet Archiving

The OIP system can archive X (formerly Twitter) posts, but X.com now requires login to view most content, making web scraping unreliable. To solve this, you need to use the official X API v2.

## 🔑 Why X API is Required

- X.com blocks unauthenticated access to tweets
- Web scraping is unreliable and may violate terms of service
- X API provides official, reliable access to tweet data
- Supports rate limiting and proper authentication

## 📋 Step-by-Step Setup

### 1. Create X Developer Account

1. Go to [developer.twitter.com](https://developer.twitter.com/en/portal/dashboard)
2. Sign in with your X account
3. Apply for a developer account (free tier available)
4. Wait for approval (usually instant for basic access)

### 2. Create an App

1. In the developer dashboard, click "Create App"
2. Fill in required information:
   - **App Name**: Choose any name (e.g., "OIP Tweet Archiver")
   - **Description**: "Archives tweets for personal/research use"
   - **Website**: Your domain or `https://github.com/your-username/oip-arweave-indexer`
3. Save the app

### 3. Get Bearer Token

1. In your app dashboard, go to "Keys and Tokens"
2. Under "Authentication Tokens" section
3. Click "Generate" next to "Bearer Token"
4. **IMPORTANT**: Copy and save this token immediately (you can't view it again)

### 4. Configure OIP Server

1. Copy your Bearer Token
2. Add it to your environment variables:

**Option A: Environment File (.env)**
```bash
# Add this line to your .env file
X_BEARER_TOKEN=your_bearer_token_here
```

**Option B: System Environment Variable**
```bash
export X_BEARER_TOKEN="your_bearer_token_here"
```

**Option C: Docker Compose**
```yaml
environment:
  - X_BEARER_TOKEN=your_bearer_token_here
```

### 5. Restart Server

After adding the token, restart your OIP server:
```bash
# If running with npm
npm restart

# If running with Docker
docker-compose restart

# If running with Docker (individual container)
docker restart oip-arweave-indexer
```

## ✅ Testing

1. Try archiving an X post in the ΛLΞXΛNDRIΛ interface
2. Check server logs - you should see "Using X API v2 for tweet extraction..."
3. If successful, you'll get complete tweet data including author, text, images, and metadata

## 🚫 Rate Limits

X API has rate limits:
- **Free Tier**: 500,000 tweets per month
- **Basic Tier**: 10,000 tweets per month (Twitter API v2)
- Rate limit errors will show helpful messages

## 🔧 Troubleshooting

### Error: "X API Bearer Token not configured"
- Make sure `X_BEARER_TOKEN` is set in your environment
- Restart the server after setting the token
- Check for typos in the environment variable name

### Error: "X API authentication failed"
- Verify your Bearer Token is correct
- Make sure the token hasn't expired
- Check that your X developer account is still active

### Error: "Tweet not found"
- The tweet may be deleted
- The account may be protected/private
- The tweet ID extraction may have failed

### Error: "Rate limit exceeded"
- Wait for the rate limit to reset (usually 15 minutes)
- Consider upgrading your X API plan if you need higher limits
- The system will automatically retry after rate limit periods

## 🆓 Free Tier Limitations

The free X API tier includes:
- 500,000 tweet lookups per month
- Basic tweet data (text, author, date, media)
- Standard rate limits

This is sufficient for most personal archiving needs.

## 🔐 Security Notes

- Keep your Bearer Token secret - don't commit it to version control
- Use environment variables, not hardcoded values
- Regenerate the token if you suspect it's compromised
- Only grant access to trusted applications

## 📚 Additional Resources

- [X API v2 Documentation](https://developer.twitter.com/en/docs/twitter-api)
- [Authentication Guide](https://developer.twitter.com/en/docs/authentication/overview)
- [Rate Limits Reference](https://developer.twitter.com/en/docs/twitter-api/rate-limits)

## 🆘 Still Need Help?

If you're still having issues:
1. Check the server logs for detailed error messages
2. Verify your X developer account status
3. Test your Bearer Token with a simple API call
4. Consider using the fallback web scraping (less reliable) by not setting the token

---

*With X API properly configured, you'll have reliable, fast tweet archiving that respects X's terms of service and provides complete tweet metadata.* 