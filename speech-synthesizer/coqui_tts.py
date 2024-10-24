from TTS.api import TTS, ModelManager
from flask import Flask, request, send_file, jsonify
import os
import uuid

app = Flask(__name__)

# Initialize the model manager
manager = ModelManager()

# Load TTS model
# tts = TTS(model_name="tts_models/en/ljspeech/tacotron2-DDC", progress_bar=False)

@app.route("/listModels", methods=["POST"])
def list_voice_models():
    try:
        models = manager.list_models()
        return jsonify(models)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# # works with API but only makes a single sylable with interface, trying a chunked approach
# @app.route("/synthesize", methods=["POST"])
# def synthesize_speech():
#     data = request.json

#     # Check if 'text' and 'model_name' are provided in the request
#     if not data or "text" not in data or "model_name" not in data:
#         return jsonify({"error": "Text or model name not provided"}), 400
    
#     text = data.get("text")
#     model_name = data.get("model_name", "tts_models/en/ljspeech/tacotron2-DDC")  # default model
#     vocoder_name = data.get("vocoder_name", None)  # Vocoder is optional, default to None

#     output_filename = f"output_{uuid.uuid4()}.wav"  # Generate a unique filename for each request

#     try:
#         # Dynamically load the requested TTS model
#         print(f"Loading model: {model_name}")
#         tts = TTS(model_name=model_name, progress_bar=False)

#         # Generate the speech to a WAV file
        # print(f"Generating speech for: {text}")
#         tts.tts_to_file(text=text, file_path=output_filename)

#         # Return the WAV file with proper headers
#         return send_file(output_filename, mimetype="audio/wav", as_attachment=True,
#                          download_name="synthesized_speech.wav")
#     except Exception as e:
#         print(f"Error in synthesis: {str(e)}")  # Logging the error
#         return jsonify({"error": str(e)}), 500
#     finally:
#         # Clean up the generated WAV file
#         if os.path.exists(output_filename):
#             os.remove(output_filename)

@app.route("/synthesize", methods=["POST"])
def synthesize_speech():
    data = request.json

    # Check if 'text' and 'model_name' are provided in the request
    if not data or "text" not in data or "model_name" not in data:
        return jsonify({"error": "Text or model name not provided"}), 400

    text = data.get("text")
    model_name = data.get("model_name", "tts_models/en/ljspeech/tacotron2-DDC")  # default model

    output_filename = f"output_{uuid.uuid4()}.wav"

    try:
        # Load and synthesize the speech
        print(f"Loading model: {model_name}")
        tts = TTS(model_name=model_name, progress_bar=False)
    
        print(f"Generating speech for: {text}")
        tts.tts_to_file(text=text, file_path=output_filename)

        # Stream the file in chunks as Base64
        # return app.response_class(generate_audio_stream(output_filename),
        #                           mimetype='text/plain')
        return send_file(output_filename, mimetype="audio/wav", as_attachment=True,
                download_name="synthesized_speech.wav")

    except Exception as e:
        print(f"Error in synthesis: {str(e)}")  # Logging the error
        return jsonify({"error": str(e)}), 500
    finally:
        if os.path.exists(output_filename):
            os.remove(output_filename)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8082)
