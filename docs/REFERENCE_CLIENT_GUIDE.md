# OIP Publishing Platform - Reference Client Guide

## Overview

The OIP Publishing Platform Reference Client is a comprehensive web application for interacting with the OIP (Open Index Protocol) publishing system. It provides a user-friendly interface for managing creators, templates, and publishing various types of records to the Arweave blockchain.

## Features

### 1. User Authentication
- **Registration**: Create new user accounts with email/password
- **Login**: Authenticate existing users with JWT tokens
- **Session Management**: Automatic token storage and session persistence

### 2. Creator Registration
- Register new creators on the platform
- Provide creator information including name, description, email, and website
- Publish creator registration records to Arweave

### 3. Template Creation
- Create custom templates for different record types
- Define template fields with various data types (string, number, boolean, enum, array)
- Dynamic field management with add/remove functionality

### 4. Record Publishing
Support for publishing the following record types:
- **Post**: Blog posts and articles with rich content
- **Recipe**: Cooking recipes with ingredients and instructions
- **Workout**: Exercise routines with duration, difficulty, and equipment
- **Video**: Video content with YouTube integration
- **Image**: Image records with metadata

## Getting Started

### Accessing the Client
1. Open your web browser
2. Navigate to `http://localhost:3000/reference-client.html` (or your server URL)

### User Registration/Login
1. **New Users**: Click "Register" and provide email/password
2. **Existing Users**: Enter email/password and click "Login"
3. **Session**: The client automatically saves your authentication token

## Using the Platform

### 1. Creator Registration
After logging in:
1. Click "Register Creator"
2. Fill in creator details:
   - **Name**: Your creator name/handle
   - **Description**: Brief description of your content
   - **Email**: Contact email (defaults to login email)
   - **Website**: Optional website URL
3. Click "Register Creator"
4. View the transaction ID upon successful registration

### 2. Template Creation
1. Click "Create Template"
2. Provide template information:
   - **Template Name**: Descriptive name for your template
   - **Record Type**: The type of records this template will create
3. Add template fields:
   - **Field Name**: Name of the data field
   - **Field Type**: Data type (string, number, boolean, enum, array)
   - Use "Add Field" to add more fields
   - Use "Remove" to delete fields
4. Click "Create Template"

### 3. Publishing Records

#### General Process
1. Click "Publish Record"
2. Select the record type from the dropdown
3. Choose a template (defaults to platform templates)
4. Fill in the record fields
5. Click "Publish Record"

#### Record Type Specific Fields

**Post Records:**
- Basic fields: name, description, tags, etc.
- Web URL: URL where the post is published
- Byline Writer: Author name
- Byline Writer's Title: Author's professional title
- Byline Writer's Location: Author's location
- Article Text: Main article content (required)
- Featured Image: Featured image URL or DID reference
- Image Items: Additional images (comma-separated URLs or DIDs)
- Image Caption Items: Captions for images (comma-separated)
- Video Items: Video content (comma-separated URLs or DIDs)
- Audio Items: Audio content (comma-separated URLs or DIDs)
- Audio Caption Items: Captions for audio (comma-separated)
- Reply To: DID reference if replying to another post

**Recipe Records:**
- Basic fields
- Ingredients: JSON format with sections, ingredients, amounts, and units
- Instructions: Step-by-step cooking instructions

**Workout Records:**
- Basic fields
- Duration: Workout length in minutes
- Difficulty: Beginner, intermediate, or advanced
- Equipment: Required equipment (comma-separated)
- Target Muscle Groups: Muscles targeted (comma-separated)
- Exercises: JSON format with exercise details

**Video Records:**
- Basic fields
- Video URL: YouTube URL or direct video link
- Duration: Video length in seconds

**Image Records:**
- Basic fields
- Image URL: Direct link to image
- Content Type: Image format (JPEG, PNG, GIF, WebP)

## API Endpoints Used

The reference client interacts with the following API endpoints:

- `POST /api/user/register` - User registration
- `POST /api/user/login` - User authentication
- `POST /api/creators/newCreator` - Creator registration
- `POST /api/templates/newTemplate` - Template creation
- `GET /api/templates` - Template retrieval
- `POST /api/publish/newPost` - Post publishing
- `POST /api/publish/newRecipe` - Recipe publishing
- `POST /api/publish/newWorkout` - Workout publishing
- `POST /api/publish/newVideo` - Video publishing
- `POST /api/publish/newImage` - Image publishing

## Data Formats

### Ingredient JSON Format (Recipes)
```json
[
  {
    "section": "Main Ingredients",
    "ingredient": ["flour", "sugar", "eggs"],
    "ingredient_amount": [2, 1, 3],
    "ingredient_unit": ["cups", "cup", "large"]
  }
]
```

### Exercise JSON Format (Workouts)
```json
[
  {
    "section": "Warm-up",
    "exercises": [
      {
        "name": "jumping jacks",
        "sets": 1,
        "reps": 20,
        "duration": 60
      }
    ]
  }
]
```

## Technical Details

### Authentication
- Uses JWT tokens for authentication
- Tokens stored in localStorage for session persistence
- Authorization header: `Bearer <token>`

### Template System
- Default templates loaded from `/config/templates.config.js`
- Template DIDs formatted as `did:arweave:<transactionId>`
- Custom templates can be created and used

### Blockchain Integration
- All records published to Arweave blockchain
- Transaction IDs returned for verification
- Records indexed in Elasticsearch for search

## Troubleshooting

### Common Issues
1. **Login Failed**: Verify email/password or check registration status
2. **Publishing Errors**: Ensure all required fields are filled
3. **JSON Format Errors**: Validate JSON syntax for recipes/workouts
4. **Network Errors**: Check server connection and API availability

### Error Messages
- The client provides detailed error messages for various failure scenarios
- Success messages include transaction IDs for tracking

## Support

For technical issues or questions about the OIP Publishing Platform, please refer to the main project documentation or contact the development team.

---

*This reference client demonstrates the full capabilities of the OIP Publishing Platform and serves as both a functional tool and implementation example for developers.* 