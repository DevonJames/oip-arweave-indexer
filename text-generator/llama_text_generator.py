from transformers import LlamaForCausalLM, LlamaTokenizer
from flask import Flask, request, jsonify

app = Flask(__name__)

# Load the LLaMA2 model and tokenizer
tokenizer = LlamaTokenizer.from_pretrained("meta-llama/Llama-2-7b")
model = LlamaForCausalLM.from_pretrained("meta-llama/Llama-2-7b", device_map="auto")

@app.route("/generate", methods=["POST"])
def generate_text():
    data = request.json
    prompt = data.get("prompt")
    inputs = tokenizer(prompt, return_tensors="pt").to("cuda")
    outputs = model.generate(inputs["input_ids"], max_length=512)
    response = tokenizer.decode(outputs[0], skip_special_tokens=True)
    return jsonify({"generated_text": response})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8081)