// Auto-generated TypeScript types from OIP Arweave templates
// Generated on 2025-08-16T19:57:12.189Z

export interface RecipeTemplate {
  prep_time_mins: number;
  cook_time_mins: number;
  total_time_mins: number;
  servings: number;
  ingredient_amount: number[];
  ingredient_unit: string[];
  ingredient: (string)[];
  ingredient_comment: string;
  instructions: string;
  course: "brk" | "lnc" | "dnr" | "snk" | "wrk" | "bkt" | "aft" | "ntm" | "pre" | "pst";
  cuisine: string;
  notes: string;
  author: string;
  authorDRef: string | CreatorRegistrationTemplate;
}

export interface PodcastTemplate {
  show: string;
  episodeNum: number;
  seasonNum: number;
  duration: number;
  hosts: (string)[];
  guests: (string)[];
  explicit: boolean;
  transcript: string;
  chapters: string;
  episodeArtwork: (string | ImageTemplate)[];
  podcastArtwork: string | ImageTemplate;
  license: string;
  copyright: string;
  sponsors: string[];
  rssFeedUrl: string;
}

export interface PostTemplate {
  webUrl: string;
  bylineWriter: string;
  bylineWritersTitle: string;
  bylineWritersLocation: string;
  articleText: string | TextTemplate;
  featuredImage: string | ImageTemplate;
  imageItems: (string | ImageTemplate)[];
  imageCaptionItems: string[];
  videoItems: (string | VideoTemplate)[];
  audioItems: (string | AudioTemplate)[];
  audioCaptionItems: string[];
  replyTo: string | PostTemplate;
}

export interface VideoTemplate {
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
  thumbnails: (string | ImageTemplate)[];
  creator: CreatorReference;
}

export interface AudioTemplate {
  webUrl: string;
  arweaveAddress: string;
  ipfsAddress: string;
  bittorrentAddress: string;
  filename: string;
  size: number;
  duration: number;
  contentType: string;
  thumbnails: (string | ImageTemplate)[];
  creator: CreatorReference;
}

export interface ImageTemplate {
  webUrl: string;
  arweaveAddress: string;
  ipfsAddress: string;
  bittorrentAddress: string;
  filename: string;
  contentType: string;
  size: number;
  width: number;
  height: number;
  creator: CreatorReference;
}

export interface CreatorRegistrationTemplate {
  address: string;
  publicKey: string;
  handle: string;
  surname: string;
  youtube: string;
  x: string;
  instagram: string;
  tiktok: string;
}

export interface TextTemplate {
  webUrl: string;
  arweaveAddress: string;
  ipfsAddress: string;
  bittorrentAddress: string;
  filename: string;
  size: number;
  contentType: string;
}

export interface BasicTemplate {
  name: string;
  description: string;
  date: number;
  language: "aa" | "ab" | "ae" | "af" | "ak" | "am" | "an" | "ar" | "as" | "av" | "ay" | "az" | "ba" | "be" | "bg" | "bh" | "bi" | "bm" | "bn" | "bo" | "br" | "bs" | "ca" | "ce" | "ch" | "co" | "cr" | "cs" | "cu" | "cv" | "cy" | "da" | "de" | "dv" | "dz" | "ee" | "el" | "en" | "eo" | "es" | "et" | "eu" | "fa" | "ff" | "fi" | "fj" | "fo" | "fr" | "fy" | "ga" | "gd" | "gl" | "gn" | "gu" | "gv" | "ha" | "he" | "hi" | "ho" | "hr" | "ht" | "hu" | "hy" | "hz" | "ia" | "id" | "ie" | "ig" | "ii" | "ik" | "io" | "is" | "it" | "iu" | "ja" | "jv" | "ka" | "kg" | "ki" | "kj" | "kk" | "kl" | "km" | "kn" | "ko" | "kr" | "ks" | "ku" | "kv" | "kw" | "ky" | "la" | "lb" | "lg" | "li" | "ln" | "lo" | "lt" | "lu" | "lv" | "mg" | "mh" | "mi" | "mk" | "ml" | "mn" | "mr" | "ms" | "mt" | "my" | "na" | "nb" | "nd" | "ne" | "ng" | "nl" | "nn" | "no" | "nr" | "nv" | "ny" | "oc" | "oj" | "om" | "or" | "os" | "pa" | "pi" | "pl" | "ps" | "pt" | "qu" | "rm" | "rn" | "ro" | "ru" | "rw" | "sa" | "sc" | "sd" | "se" | "sg" | "si" | "sk" | "sl" | "sm" | "sn" | "so" | "sq" | "sr" | "ss" | "st" | "su" | "sv" | "sw" | "ta" | "te" | "tg" | "th" | "ti" | "tk" | "tl" | "tn" | "to" | "tr" | "ts" | "tt" | "tw" | "ty" | "ug" | "uk" | "ur" | "uz" | "ve" | "vi" | "vo" | "wa" | "wo" | "xh" | "yi" | "yo" | "za" | "zh" | "zu";
  avatar: string | ImageTemplate;
  license: string;
  nsfw: boolean;
  creatorItems: (string)[];
  tagItems: string[];
  noteItems: string[];
  urlItems: (string)[];
  citations: (string)[];
  webUrl: string;
}

export interface NutritionalInfoTemplate {
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

export interface ExerciseTemplate {
  instructions: string[];
  muscleGroups: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
  category: "strength" | "cardio" | "flexibility";
  imageUrl: string;
  videoUrl: string;
  gitUrl: string;
  equipmentRequired: string[];
  alternativeEquipment: string[];
  isBodyweight: boolean;
  exercise_type: "warmup" | "main" | "cooldown";
  measurement_type: "reps" | "timed" | "hold" | "maxdur";
  est_duration_minutes: number;
  target_duration_seconds: number;
  recommended_sets: number;
  recommended_reps: number;
}

export interface WorkoutTemplate {
  total_duration_minutes: number;
  estimated_calories_burned: number;
  includesWarmup: boolean;
  includesMain: boolean;
  includesCooldown: boolean;
  nonStandardWorkout: boolean;
  exercise_amount: number[];
  exercise_unit: string[];
  exercise: (string | ExerciseTemplate)[];
  exercise_comment: string[];
  instructions: string;
  goalTags: string[];
  author: string;
  authorDRef: string | CreatorRegistrationTemplate;
  notes: string;
}

export interface PodcastShowTemplate {
  hosts: (string)[];
  producers: (string)[];
  network: string;
  rssFeedUrl: string;
  defaultLicense: string;
  defaultCopyright: string;
  defaultArtwork: string;
  defaultSponsors: string[];
  category: string;
}

export interface AFourthTestTemplateTemplate {
  someField: string[];
  anotherField: string[];
}
