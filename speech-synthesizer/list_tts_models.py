from TTS.utils.manage import ModelManager

# Initialize the model manager
manager = ModelManager()

# List available TTS models
models = manager.list_models_by_type("tts")
for model in models:
    print(model)
