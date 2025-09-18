const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { getRecords } = require('../helpers/elasticsearch');
const { publishNewRecord } = require('../helpers/templateHelper');
const { searchKaggleExercise } = require('../lib/kaggle-exercise-fetcher');

// Exercise Resolution Endpoint (for workouts)
router.post('/resolve-exercises', authenticateToken, async (req, res) => {
  const { exerciseNames } = req.body;

  if (!exerciseNames || !Array.isArray(exerciseNames)) {
    return res.status(400).json({ error: 'Exercise names array is required' });
  }

  try {
    // Look up exercises in OIP index
    const queryParams = {
      recordType: 'exercise',
      search: exerciseNames.join(' '),
      searchMatchMode: 'OR', // Use OR mode to find exercises matching any of the names
      limit: 50
    };

    const recordsInDB = await getRecords(queryParams);
    
    // Build record map for matching
    const recordMap = {};
    recordsInDB.records.forEach(record => {
      const recordName = record.data.basic.name.toLowerCase();
      recordMap[recordName] = record;
    });

    const exerciseDidRefs = {};
    const missingExercises = [];

    // Find matches for each exercise
    for (const exerciseName of exerciseNames) {
      const normalizedName = exerciseName.toLowerCase().trim();
      const match = findBestExerciseMatch(normalizedName, recordMap);
      
      if (match) {
        exerciseDidRefs[normalizedName] = match.oip.did || match.oip.didTx;
      } else {
        exerciseDidRefs[normalizedName] = null;
        missingExercises.push(normalizedName);
      }
    }

    // Create missing exercises using Kaggle integration
    if (missingExercises.length > 0) {
      console.log(`Creating ${missingExercises.length} missing exercises from Kaggle dataset...`);
      
      for (const exerciseName of missingExercises) {
        try {
          const newExerciseRecord = await createNewExerciseRecord(exerciseName);
          if (newExerciseRecord) {
            exerciseDidRefs[exerciseName] = newExerciseRecord.oip.did || newExerciseRecord.oip.didTx;
          }
        } catch (error) {
          console.error(`Failed to create exercise record for ${exerciseName}:`, error);
        }
      }
    }

    res.json({ exerciseDidRefs });

  } catch (error) {
    console.error('Exercise resolution error:', error);
    res.status(500).json({ error: 'Failed to resolve exercises: ' + error.message });
  }
});

function findBestExerciseMatch(exerciseName, recordMap) {
  // Direct match
  if (recordMap[exerciseName]) {
    return recordMap[exerciseName];
  }

  // Fuzzy matching
  const searchTerms = exerciseName.split(/\s+/).filter(Boolean);
  const matches = Object.keys(recordMap)
    .filter(recordName => {
      return searchTerms.some(term => recordName.includes(term));
    })
    .map(recordName => recordMap[recordName]);

  if (matches.length > 0) {
    // Sort by best match (most overlapping terms)
    matches.sort((a, b) => {
      const aMatchCount = searchTerms.filter(term => 
        a.data.basic.name.toLowerCase().includes(term)
      ).length;
      const bMatchCount = searchTerms.filter(term => 
        b.data.basic.name.toLowerCase().includes(term)
      ).length;
      return bMatchCount - aMatchCount;
    });
    
    return matches[0];
  }

  return null;
}

async function createNewExerciseRecord(exerciseName, blockchain = 'arweave') {
  try {
    console.log(`Creating new exercise record for: ${exerciseName}`);

    // Use the Kaggle exercise fetcher
    const kaggleData = await searchKaggleExercise(exerciseName);
    
    if (!kaggleData) {
      console.log(`No Kaggle data found for ${exerciseName}, creating basic record`);
      
      // Create basic exercise record
      const exerciseData = {
        basic: {
          name: exerciseName,
          language: 'en',
          date: Math.floor(Date.now() / 1000),
          nsfw: false
        },
        exercise: {
          name: exerciseName,
          category: 'general',
          primary_muscles: [],
          secondary_muscles: [],
          equipment: 'bodyweight',
          difficulty: 'beginner'
        }
      };

      return await publishNewRecord(exerciseData, "exercise", false, false, false, null, blockchain);
    }

    // Create exercise record from Kaggle data
    const exerciseData = {
      basic: {
        name: kaggleData.name || exerciseName,
        language: 'en',
        date: Math.floor(Date.now() / 1000),
        description: kaggleData.instructions || '',
        nsfw: false
      },
      exercise: {
        name: kaggleData.name || exerciseName,
        category: kaggleData.category || 'general',
        primary_muscles: kaggleData.primary_muscles || [],
        secondary_muscles: kaggleData.secondary_muscles || [],
        equipment: kaggleData.equipment || 'bodyweight',
        difficulty: kaggleData.level || 'beginner',
        instructions: kaggleData.instructions || '',
        mechanic: kaggleData.mechanic || '',
        force: kaggleData.force || ''
      }
    };

    const result = await publishNewRecord(exerciseData, "exercise", false, false, false, null, blockchain);
    console.log(`Created exercise record for ${exerciseName}:`, result.did || result.didTx);
    
    return result.recordToIndex;

  } catch (error) {
    console.error(`Error creating exercise record for ${exerciseName}:`, error);
    return null;
  }
}

module.exports = router; 