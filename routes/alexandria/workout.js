/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WORKOUT ROUTES - Alexandria Service
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Exercise resolution and creation for workout tracking.
 * Uses oipClient to communicate with oip-daemon-service for data operations.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { searchKaggleExercise } = require('../../lib/kaggle-exercise-fetcher');
const OIPClient = require('../../helpers/oipClient');

/**
 * Helper to get oipClient from request context
 * @param {object} req - Express request with user token
 * @returns {OIPClient} Configured client
 */
function getOIPClient(req) {
    const token = req.headers.authorization?.replace('Bearer ', '') || null;
    return new OIPClient(token);
}

// Exercise Resolution Endpoint (for workouts)
router.post('/resolve-exercises', authenticateToken, async (req, res) => {
    const { exerciseNames } = req.body;

    if (!exerciseNames || !Array.isArray(exerciseNames)) {
        return res.status(400).json({ error: 'Exercise names array is required' });
    }

    const oipClient = getOIPClient(req);

    try {
        // Look up exercises in OIP index via daemon
        const queryParams = {
            recordType: 'exercise',
            search: exerciseNames.join(' '),
            searchMatchMode: 'OR', // Use OR mode to find exercises matching any of the names
            limit: 50
        };

        const recordsInDB = await oipClient.getRecords(queryParams);
        
        // Build record map for matching
        const recordMap = {};
        (recordsInDB.records || []).forEach(record => {
            const recordName = record.data?.basic?.name?.toLowerCase();
            if (recordName) {
                recordMap[recordName] = record;
            }
        });

        const exerciseDidRefs = {};
        const missingExercises = [];

        // Find matches for each exercise
        for (const exerciseName of exerciseNames) {
            const normalizedName = exerciseName.toLowerCase().trim();
            const match = findBestExerciseMatch(normalizedName, recordMap);
            
            if (match) {
                exerciseDidRefs[normalizedName] = match.oip?.did || match.oip?.didTx;
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
                    const newExerciseRecord = await createNewExerciseRecord(exerciseName, oipClient);
                    if (newExerciseRecord) {
                        exerciseDidRefs[exerciseName] = newExerciseRecord.oip?.did || newExerciseRecord.oip?.didTx;
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
                a.data?.basic?.name?.toLowerCase()?.includes(term)
            ).length;
            const bMatchCount = searchTerms.filter(term => 
                b.data?.basic?.name?.toLowerCase()?.includes(term)
            ).length;
            return bMatchCount - aMatchCount;
        });
        
        return matches[0];
    }

    return null;
}

/**
 * Create a new exercise record via oipClient
 * @param {string} exerciseName - Name of the exercise
 * @param {OIPClient} oipClient - Configured OIP client
 * @param {string} blockchain - Storage blockchain (default: 'arweave')
 * @returns {Promise<object|null>} Created record or null
 */
async function createNewExerciseRecord(exerciseName, oipClient, blockchain = 'arweave') {
    try {
        console.log(`Creating new exercise record for: ${exerciseName}`);

        // Use the Kaggle exercise fetcher
        const kaggleData = await searchKaggleExercise(exerciseName);
        
        let exerciseData;
        
        if (!kaggleData) {
            console.log(`No Kaggle data found for ${exerciseName}, creating basic record`);
            
            // Create basic exercise record
            exerciseData = {
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
        } else {
            // Create exercise record from Kaggle data
            exerciseData = {
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
        }

        // Publish via oipClient
        const result = await oipClient.publishRecord(exerciseData, {
            recordType: 'exercise',
            storage: blockchain
        });
        
        console.log(`Created exercise record for ${exerciseName}:`, result.did || result.didTx);
        
        return result.recordToIndex || result;

    } catch (error) {
        console.error(`Error creating exercise record for ${exerciseName}:`, error);
        return null;
    }
}

module.exports = router;
