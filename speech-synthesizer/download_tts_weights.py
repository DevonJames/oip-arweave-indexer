from TTS.api import TTS

# Specify the TTS model name
model_name = "tts_models/en/ljspeech/tacotron2-DDC"

# Download the model
print(f"Downloading TTS model: {model_name}")
tts = TTS(model_name=model_name, progress_bar=False)

print("TTS model downloaded successfully!")