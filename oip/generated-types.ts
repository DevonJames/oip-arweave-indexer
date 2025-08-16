// Auto-generated TypeScript types from OIP Arweave templates
// Generated on 2025-08-16T04:35:08.951Z

export interface Recipe {
  prep_time_mins: number;
  cook_time_mins: number;
  total_time_mins: number;
  servings: number;
  ingredient_amount: number[];
  ingredient_unit: string[];
  ingredient: string[];
  ingredient_comment: string;
  instructions: string;
  course: string;
  cuisine: string;
  notes: string;
  author: string;
  authorDRef: string;
}

export interface Podcast {
  show: string;
  episodeNum: number;
  seasonNum: number;
  duration: number;
  hosts: string[];
  guests: string[];
  explicit: boolean;
  transcript: string;
  chapters: string;
  episodeArtwork: string[];
  podcastArtwork: string;
  license: string;
  copyright: string;
  sponsors: string[];
  rssFeedUrl: string;
}

export interface Post {
  webUrl: string;
  bylineWriter: string;
  bylineWritersTitle: string;
  bylineWritersLocation: string;
  articleText: string;
  featuredImage: string;
  imageItems: string[];
  imageCaptionItems: string[];
  videoItems: string[];
  audioItems: string[];
  audioCaptionItems: string[];
  replyTo: string;
}

export interface Video {
  webUrl: string;
  arweaveAddress: string;
  ipfsAddress: string;
  bittorrentAddress: string;
  filename: string;
  size: number;
  width: number;
  height: number;
  duration: number;
  contentType: string;
  thumbnails: string[];
  creator: string;
}

export interface Audio {
  webUrl: string;
  arweaveAddress: string;
  ipfsAddress: string;
  bittorrentAddress: string;
  filename: string;
  size: number;
  duration: number;
  contentType: string;
  thumbnails: string[];
  creator: string;
}

export interface Image {
  webUrl: string;
  arweaveAddress: string;
  ipfsAddress: string;
  bittorrentAddress: string;
  filename: string;
  contentType: string;
  size: number;
  width: number;
  height: number;
  creator: string;
}

export interface CreatorRegistration {
  address: string;
  publicKey: string;
  handle: string;
  surname: string;
  youtube: string;
  x: string;
  instagram: string;
  tiktok: string;
}

export interface Text {
  webUrl: string;
  arweaveAddress: string;
  ipfsAddress: string;
  bittorrentAddress: string;
  filename: string;
  size: number;
  contentType: string;
}

export interface Basic {
  name: string;
  description: string;
  date: number;
  language: string;
  avatar: string;
  license: string;
  nsfw: boolean;
  creatorItems: string[];
  tagItems: string[];
  noteItems: string[];
  urlItems: string[];
  citations: string[];
  webUrl: string;
}

export interface NutritionalInfo {
  standardAmount: number;
  standardUnit: string;
  calories: number;
  proteinG: number;
  fatG: number;
  saturatedFatG: number;
  transFatG: number;
  cholesterolMg: number;
  sodiumMg: number;
  carbohydratesG: number;
  dietaryFiberG: number;
  sugarsG: number;
  addedSugarsG: number;
  vitaminDMcg: number;
  calciumMg: number;
  ironMg: number;
  potassiumMg: number;
  vitaminAMcg: number;
  vitaminCMg: number;
  allergens: string[];
  glutenFree: boolean;
  organic: boolean;
}

export interface Exercise {
  instructions: string[];
  muscleGroups: string[];
  difficulty: string;
  category: string;
  imageUrl: string;
  videoUrl: string;
  gitUrl: string;
  equipmentRequired: string[];
  alternativeEquipment: string[];
  isBodyweight: boolean;
  exercise_type: string;
  measurement_type: string;
  est_duration_minutes: unknown;
  target_duration_seconds: unknown;
  recommended_sets: unknown;
  recommended_reps: unknown;
}

export interface Workout {
  total_duration_minutes: number;
  estimated_calories_burned: number;
  includesWarmup: boolean;
  includesMain: boolean;
  includesCooldown: boolean;
  nonStandardWorkout: boolean;
  exercise_amount: number[];
  exercise_unit: string[];
  exercise: string[];
  exercise_comment: string[];
  instructions: string;
  goalTags: string[];
  author: string;
  authorDRef: string;
  notes: string;
}

export interface PodcastShow {
  hosts: string[];
  producers: string[];
  network: string;
  rssFeedUrl: string;
  defaultLicense: string;
  defaultCopyright: string;
  defaultArtwork: string;
  defaultSponsors: string[];
  category: string;
}

export interface AFourthTestTemplate {
  someField: string[];
  anotherField: string[];
}
