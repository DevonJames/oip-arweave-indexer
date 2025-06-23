# Workout & Exercise Publishing System

This document describes the new workout and exercise publishing system that mirrors the recipe/nutritionalInfo pattern.

## Overview

The system allows publishing workouts that automatically resolve exercise references:

1. **FitnessAlly App** → Generates workout → Approves for rotation → **OIP Publishing**
2. **Exercise Resolution** → Missing exercises fetched from Kaggle → Published to OIP  
3. **Workout Publishing** → Exercise names replaced with didTx references → Final workout published

## API Endpoints

### Workout Publishing
```
POST /api/publish/newWorkout
```

**Authentication:** Required (JWT Bearer token)

### Exercise Search  
```
GET https://api.oip.onl/api/records?recordType=exercise&search=push-up
```

## Request Format

### Standard Workout (with exercise resolution)
```json
{
  "basic": {
    "name": "Morning Strength Routine",
    "description": "A comprehensive morning workout targeting major muscle groups",
    "language": "en",
    "webUrl": "https://fitnessally.com/workouts/morning-routine",
    "tagItems": ["morning", "strength", "full-body"]
  },
  "workout_duration_minutes": 45,
  "workout_difficulty": "intermediate", 
  "workout_category": "strength",
  "equipment_required": ["dumbbells", "resistance bands"],
  "target_muscle_groups": ["chest", "back", "legs"],
  "goal_tags": ["muscle building", "strength"],
  "notes": "Focus on proper form throughout",
  "created_by": "FitnessAlly",
  "workout": [
    {
      "section_name": "Warm-up",
      "exercises": [
        {
          "name": "jumping jacks",
          "sets": 1,
          "reps": 20,
          "duration_seconds": 30,
          "rest_seconds": 10
        },
        {
          "name": "arm circles", 
          "sets": 1,
          "reps": 10,
          "duration_seconds": 20,
          "rest_seconds": 10
        }
      ]
    },
    {
      "section_name": "Main Workout",
      "exercises": [
        {
          "name": "push ups",
          "sets": 3,
          "reps": 12,
          "rest_seconds": 60
        },
        {
          "name": "squats",
          "sets": 3, 
          "reps": 15,
          "rest_seconds": 60
        },
        {
          "name": "dumbbell rows",
          "sets": 3,
          "reps": 10,
          "rest_seconds": 60
        }
      ]
    }
  ],
  "blockchain": "arweave"
}
```

### Non-Standard Workout (no exercise resolution)
```json
{
  "basic": {
    "name": "Custom Flexibility Routine",
    "description": "Personal flexibility routine"
  },
  "nonStandardWorkout": true,
  "workout": [
    {
      "section_name": "Stretching",
      "exercises": [
        {
          "name": "Personal stretch routine",
          "duration_minutes": 10,
          "notes": "Custom sequence"
        }
      ]
    }
  ],
  "blockchain": "arweave"
}
```

## System Workflow

### 1. Standard Workout Processing

When `nonStandardWorkout` is **NOT** included:

1. **Extract Exercise Names** → From all workout sections
2. **Search OIP** → Query existing exercise records
3. **Match Exercises** → Find best matches using fuzzy search
4. **Create Missing** → Query Kaggle dataset → Publish new exercise records
5. **Replace References** → Exercise names → didTx references  
6. **Publish Workout** → With all exercise references resolved

### 2. Non-Standard Workout Processing

When `nonStandardWorkout: true`:

1. **Skip Exercise Resolution** → No lookups or creation
2. **Publish As-Is** → Workout published with original exercise names
3. **Return didTx** → For FitnessAlly database storage

## Exercise Data Source

Exercise data comes from the **Kaggle Fitness Exercises Dataset**:
- Dataset: `edoardoba/fitness-exercises-with-animations`  
- URL: https://www.kaggle.com/datasets/edoardoba/fitness-exercises-with-animations
- Contains: 1300+ exercises with animations and detailed metadata

### Exercise Fields (Auto-Generated)
```json
{
  "basic": {
    "name": "Push Ups",
    "description": "Push Ups - strength exercise targeting chest, triceps", 
    "webUrl": "https://www.kaggle.com/datasets/edoardoba/fitness-exercises-with-animations"
  },
  "exercise": {
    "instructions": ["Set up in push-up position", "Lower body to ground", "Push back up"],
    "muscleGroups": ["chest", "triceps", "shoulders"],
    "difficulty": "intermediate",
    "category": "strength", 
    "equipmentRequired": [],
    "alternativeEquipment": ["resistance bands"],
    "isBodyweight": true,
    "exercise_type": "compound",
    "recommended_sets": 3,
    "recommended_reps": 12,
    "goalTags": ["upper body strength", "chest development"]
  }
}
```

## Response Format

### Successful Workout Publication
```json
{
  "transactionId": "H9yER_vA4LBL2gP2R_qTa4j0lekVckiV3cYbvH1sy8c",
  "recordToIndex": {
    "data": { /* workout data */ },
    "oip": {
      "didTx": "did:arweave:H9yER_vA4LBL2gP2R_qTa4j0lekVckiV3cYbvH1sy8c"
    }
  },
  "blockchain": "arweave",
  "exerciseDidRefs": {
    "push ups": "did:arweave:ABC123...",
    "squats": "did:arweave:DEF456...",
    "dumbbell rows": "did:arweave:GHI789..."
  },
  "message": "Workout published successfully with exercise references"
}
```

## Installation Requirements

### Node.js Dependencies
Already included in existing `package.json`

### Python Dependencies
```bash
pip install kagglehub pandas
```

### Kaggle API Setup
1. Create Kaggle account
2. Generate API token at https://www.kaggle.com/settings  
3. Place `kaggle.json` in `~/.kaggle/` directory
4. Set permissions: `chmod 600 ~/.kaggle/kaggle.json`

## Usage Examples

### Publishing from FitnessAlly
```javascript
// FitnessAlly workout data
const workout = {
  basic: {
    name: "Upper Body Blast",
    description: "Intensive upper body strength training"
  },
  workout: [/* workout sections */],
  // nonStandardWorkout: false (default)
};

// POST to OIP
const response = await fetch('/api/publish/newWorkout', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(workout)
});

const result = await response.json();
// Store result.transactionId in FitnessAlly database
```

### Querying Published Exercises
```bash
# Search for specific exercises
curl "https://api.oip.onl/api/records?recordType=exercise&search=push+up"

# Get all exercises
curl "https://api.oip.onl/api/records?recordType=exercise&limit=50"
```

### Querying Published Workouts  
```bash
# Search for workouts
curl "https://api.oip.onl/api/records?recordType=workout&search=strength"

# Get all workouts
curl "https://api.oip.onl/api/records?recordType=workout&limit=50"
```

## Error Handling

The system includes comprehensive fallbacks:

1. **Kaggle API Failure** → Falls back to mock exercise data
2. **Python Script Error** → Uses simplified exercise structure  
3. **Exercise Creation Failure** → Logs error, continues with available exercises
4. **Authentication Failure** → Returns 401 error

## Performance Considerations

- **Exercise Caching** → Found exercises cached for subsequent workouts
- **Batch Processing** → Multiple exercises resolved in parallel
- **Kaggle Rate Limits** → Python script handles rate limiting
- **Async Processing** → Non-blocking exercise resolution

## Future Enhancements

1. **Template Publishing** → Publish exercise/workout templates to OIP
2. **Enhanced Matching** → Machine learning-based exercise matching
3. **Real-time Sync** → Live sync between FitnessAlly and OIP
4. **Exercise Validation** → Validate exercise names before publishing
5. **Bulk Import** → Import entire Kaggle dataset to OIP

## Related Documentation

- [Template System](./TEMPLATE_SYSTEM.md)
- [Publishing API](./PUBLISHING_API.md) 
- [Recipe/NutritionalInfo System](./RECIPE_SYSTEM.md) 