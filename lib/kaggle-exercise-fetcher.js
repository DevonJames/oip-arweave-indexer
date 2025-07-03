const path = require('path');

/**
 * Search for exercise in Kaggle dataset
 */
async function searchKaggleExercise(exerciseName) {
    try {
        console.log(`Searching Kaggle dataset for exercise: ${exerciseName}`);
        
        const { spawn } = require('child_process');
        const pythonScript = path.join(__dirname, '..', 'kaggle-exercise-fetcher.py');
        
        return new Promise((resolve, reject) => {
            const python = spawn('python3', [pythonScript, exerciseName, '--format', 'json']);
            
            let stdout = '';
            let stderr = '';
            
            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            python.on('close', (code) => {
                if (code === 0) {
                    try {
                        const exerciseData = JSON.parse(stdout);
                        console.log(`Found exercise data for ${exerciseName}:`, exerciseData);
                        resolve(exerciseData);
                    } catch (parseError) {
                        console.error('Error parsing exercise data JSON:', parseError);
                        resolve(null);
                    }
                } else {
                    console.log(`Python script exited with code ${code}`);
                    console.log('stderr:', stderr);
                    
                    // Fallback to mock data if Python script fails
                    console.log('Falling back to mock exercise data...');
                    const mockExerciseData = {
                        name: exerciseName,
                        instructions: [
                            "Set up in starting position",
                            "Perform the movement with proper form", 
                            "Return to starting position"
                        ],
                        muscle_groups: ["general"],
                        difficulty: "intermediate",
                        category: "strength",
                        equipment_required: [],
                        alternative_equipment: [],
                        is_bodyweight: true,
                        exercise_type: "compound",
                        recommended_sets: 3,
                        recommended_reps: 12,
                        duration_minutes: 0,
                        goal_tags: ["general fitness"],
                        image_url: "",
                        video_url: "",
                        source_url: "https://www.kaggle.com/datasets/edoardoba/fitness-exercises-with-animations"
                    };
                    resolve(mockExerciseData);
                }
            });
            
            python.on('error', (error) => {
                console.error('Error running Python script:', error);
                // Resolve with null to trigger fallback
                resolve(null);
            });
        });
        
    } catch (error) {
        console.error(`Error searching for exercise ${exerciseName}:`, error);
        return null;
    }
}

module.exports = { searchKaggleExercise }; 