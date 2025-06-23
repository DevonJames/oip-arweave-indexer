#!/usr/bin/env python3
"""
Kaggle Fitness Exercise Data Fetcher
Integrates with the fitness exercises dataset from Kaggle
"""

import kagglehub
import pandas as pd
import json
import sys
import argparse
from kagglehub import KaggleDatasetAdapter

class FitnessExerciseFetcher:
    def __init__(self):
        self.dataset = None
        self.df = None
    
    def load_dataset(self):
        """Load the Kaggle fitness exercises dataset"""
        try:
            print("Loading Kaggle fitness exercises dataset...", file=sys.stderr)
            
            # Load the dataset using kagglehub
            self.df = kagglehub.load_dataset(
                KaggleDatasetAdapter.PANDAS,
                "edoardoba/fitness-exercises-with-animations",
                "", # Set file_path as needed
            )
            
            print(f"Dataset loaded successfully. Shape: {self.df.shape}", file=sys.stderr)
            print("Columns:", self.df.columns.tolist(), file=sys.stderr)
            return True
            
        except Exception as e:
            print(f"Error loading dataset: {e}", file=sys.stderr)
            return False
    
    def search_exercise(self, exercise_name):
        """Search for a specific exercise in the dataset"""
        if self.df is None:
            if not self.load_dataset():
                return None
        
        try:
            # Normalize the search term
            search_term = exercise_name.lower().strip()
            
            # Search in multiple columns (adjust column names based on actual dataset structure)
            possible_name_columns = ['name', 'exercise_name', 'title', 'exercise']
            search_results = pd.DataFrame()
            
            for col in possible_name_columns:
                if col in self.df.columns:
                    matches = self.df[self.df[col].str.lower().str.contains(search_term, na=False)]
                    if not matches.empty:
                        search_results = matches
                        break
            
            if search_results.empty:
                # Try broader search across all text columns
                for col in self.df.select_dtypes(include=['object']).columns:
                    matches = self.df[self.df[col].str.lower().str.contains(search_term, na=False)]
                    if not matches.empty:
                        search_results = matches.head(1)  # Take first match
                        break
            
            if search_results.empty:
                return None
            
            # Get the first (best) match
            exercise_row = search_results.iloc[0]
            
            # Map dataset columns to our expected format
            # Note: Column names will need to be adjusted based on actual dataset structure
            exercise_data = {
                "name": exercise_name,  # Use the searched name
                "instructions": self._extract_instructions(exercise_row),
                "muscle_groups": self._extract_muscle_groups(exercise_row),
                "difficulty": self._extract_difficulty(exercise_row),
                "category": self._extract_category(exercise_row),
                "equipment_required": self._extract_equipment(exercise_row),
                "alternative_equipment": [],  # May not be in dataset
                "is_bodyweight": self._is_bodyweight(exercise_row),
                "exercise_type": self._extract_exercise_type(exercise_row),
                "recommended_sets": self._extract_sets(exercise_row),
                "recommended_reps": self._extract_reps(exercise_row),
                "duration_minutes": 0,  # May not be in dataset
                "goal_tags": self._extract_goal_tags(exercise_row),
                "image_url": self._extract_image_url(exercise_row),
                "video_url": self._extract_video_url(exercise_row),
                "source_url": "https://www.kaggle.com/datasets/edoardoba/fitness-exercises-with-animations"
            }
            
            return exercise_data
            
        except Exception as e:
            print(f"Error searching for exercise '{exercise_name}': {e}", file=sys.stderr)
            return None
    
    def _extract_instructions(self, row):
        """Extract instructions from the row"""
        # Adjust column names based on actual dataset
        possible_cols = ['instructions', 'description', 'how_to', 'steps']
        for col in possible_cols:
            if col in row.index and pd.notna(row[col]):
                instructions = str(row[col])
                # Split into steps if it's a long text
                if len(instructions) > 100:
                    return instructions.split('. ')[:5]  # Take first 5 sentences
                else:
                    return [instructions]
        
        return ["Perform the exercise with proper form", "Follow standard movement pattern"]
    
    def _extract_muscle_groups(self, row):
        """Extract muscle groups from the row"""
        possible_cols = ['muscle_groups', 'muscles', 'target_muscles', 'primary_muscles']
        for col in possible_cols:
            if col in row.index and pd.notna(row[col]):
                muscles = str(row[col]).lower()
                # Handle comma-separated values
                if ',' in muscles:
                    return [m.strip() for m in muscles.split(',')]
                else:
                    return [muscles.strip()]
        
        return ["general"]
    
    def _extract_difficulty(self, row):
        """Extract difficulty level"""
        possible_cols = ['difficulty', 'level', 'difficulty_level']
        for col in possible_cols:
            if col in row.index and pd.notna(row[col]):
                diff = str(row[col]).lower()
                if diff in ['beginner', 'intermediate', 'advanced']:
                    return diff
        
        return "intermediate"
    
    def _extract_category(self, row):
        """Extract exercise category"""
        possible_cols = ['category', 'type', 'exercise_type', 'workout_type']
        for col in possible_cols:
            if col in row.index and pd.notna(row[col]):
                return str(row[col]).lower()
        
        return "strength"
    
    def _extract_equipment(self, row):
        """Extract required equipment"""
        possible_cols = ['equipment', 'equipment_needed', 'gear']
        for col in possible_cols:
            if col in row.index and pd.notna(row[col]):
                equipment = str(row[col]).lower()
                if ',' in equipment:
                    return [e.strip() for e in equipment.split(',')]
                else:
                    return [equipment.strip()]
        
        return []
    
    def _is_bodyweight(self, row):
        """Determine if exercise is bodyweight"""
        equipment = self._extract_equipment(row)
        bodyweight_indicators = ['bodyweight', 'none', 'no equipment', '']
        return any(indicator in str(equipment).lower() for indicator in bodyweight_indicators)
    
    def _extract_exercise_type(self, row):
        """Extract exercise type (compound/isolation)"""
        possible_cols = ['exercise_type', 'movement_type', 'type']
        for col in possible_cols:
            if col in row.index and pd.notna(row[col]):
                ex_type = str(row[col]).lower()
                if ex_type in ['compound', 'isolation']:
                    return ex_type
        
        return "compound"
    
    def _extract_sets(self, row):
        """Extract recommended sets"""
        possible_cols = ['sets', 'recommended_sets', 'reps_sets']
        for col in possible_cols:
            if col in row.index and pd.notna(row[col]):
                try:
                    return int(float(str(row[col])))
                except:
                    pass
        return 3
    
    def _extract_reps(self, row):
        """Extract recommended reps"""
        possible_cols = ['reps', 'recommended_reps', 'repetitions']
        for col in possible_cols:
            if col in row.index and pd.notna(row[col]):
                try:
                    return int(float(str(row[col])))
                except:
                    pass
        return 12
    
    def _extract_goal_tags(self, row):
        """Extract goal/target tags"""
        muscle_groups = self._extract_muscle_groups(row)
        category = self._extract_category(row)
        
        # Generate goal tags based on muscle groups and category
        goals = []
        if category == "strength":
            goals.append("strength training")
        if category == "cardio":
            goals.append("cardiovascular health")
        
        # Add muscle-specific goals
        for muscle in muscle_groups:
            goals.append(f"{muscle} development")
        
        return goals
    
    def _extract_image_url(self, row):
        """Extract image URL if available"""
        possible_cols = ['image_url', 'image', 'picture_url', 'gif_url']
        for col in possible_cols:
            if col in row.index and pd.notna(row[col]):
                return str(row[col])
        return ""
    
    def _extract_video_url(self, row):
        """Extract video URL if available"""
        possible_cols = ['video_url', 'video', 'animation_url', 'demo_url']
        for col in possible_cols:
            if col in row.index and pd.notna(row[col]):
                return str(row[col])
        return ""

def main():
    parser = argparse.ArgumentParser(description='Fetch exercise data from Kaggle dataset')
    parser.add_argument('exercise_name', help='Name of the exercise to search for')
    parser.add_argument('--format', choices=['json'], default='json', help='Output format')
    
    args = parser.parse_args()
    
    fetcher = FitnessExerciseFetcher()
    result = fetcher.search_exercise(args.exercise_name)
    
    if result:
        print(json.dumps(result, indent=2))
        sys.exit(0)
    else:
        print(json.dumps({"error": f"Exercise '{args.exercise_name}' not found"}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main() 