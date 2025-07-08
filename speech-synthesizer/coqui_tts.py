from TTS.api import TTS, ModelManager
from flask import Flask, request, send_file, jsonify
import os
import uuid
import torch
import logging
import traceback

app = Flask(__name__)
app.debug = True

# Initialize the TTS model and set up the health status
model_name = "tts_models/en/jenny/jenny"
# model_name="tts_models/en/ljspeech/tacotron2-DDC"
device = 'cuda' if torch.cuda.is_available() else 'cpu'

# THIS IS DIFF FROM WHAT IS MARKED AS WORKING ON SERVER BUT GOING TO TRY IT FOR NOW
tts = None
model_loaded = False

# Initialize the model manager
manager = ModelManager()

def load_model():
    global tts, model_loaded
    try:
        tts = TTS(model_name=model_name, progress_bar=False)
        model_loaded = True
        print("Model loaded and ready.")
    except Exception as e:
        model_loaded = False
        logging.error("Error loading model: %s", traceback.format_exc())

# Load the model at startup
load_model()

@app.route("/health", methods=["GET"])
def health_check():
    """Simple health check endpoint to ensure model readiness."""
    if model_loaded:
        return jsonify({"status": "ready"}), 200
    else:
        return jsonify({"status": "loading"}), 503  # Service Unavailable if not loaded

@app.route("/listModels", methods=["POST"])
def list_voice_models():
    try:
        models = manager.list_models()
        return jsonify(models)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/synthesize", methods=["POST"])
def synthesize_speech():
    if not model_loaded:
        return jsonify({"error": "Model is not loaded"}), 503  # Return if model is not ready

    data = request.json
    if not data or "text" not in data:
        return jsonify({"error": "Text not provided"}), 400

    # Check if 'text' and 'model_name' are provided in the request
    # if not data or "text" not in data or "model_name" not in data:
    #     return jsonify({"error": "Text or model name not provided"}), 400
    text = data["text"]
    output_filename = f"output_{uuid.uuid4()}.wav"
# # works but trying a diff way
#     text = data.get("text")
#     model_name = data.get("model_name", "tts_models/en/ljspeech/tacotron2-DDC")  # default model

#     output_filename = f"output_{uuid.uuid4()}.wav"

    try:
        # Synthesize speech
        logging.info(f"Generating speech for: {text}")
        print(f"Generating speech for: {text}")
        tts.tts_to_file(text=text, file_path=output_filename)

        # print(f"Generating speech for: {text}")
        # tts.tts_to_file(text=text, file_path=output_filename)

        # Stream the file in chunks as Base64
        # return app.response_class(generate_audio_stream(output_filename),
        #                           mimetype='text/plain')
        return send_file(output_filename, mimetype="audio/wav", as_attachment=True,
                download_name="synthesized_speech.wav")

    except Exception as e:
        print(f"Error in synthesis: {str(e)}")  # Logging the error
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            if os.path.exists(output_filename):
                os.remove(output_filename)
        except Exception as cleanup_error:
            logging.warning("Failed to remove file %s: %s", output_filename, cleanup_error)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8082)
