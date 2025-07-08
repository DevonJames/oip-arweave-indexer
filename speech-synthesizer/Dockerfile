# Use Debian-based Python slim image
FROM python:3.10-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    git \
    chromium \
    chromium-driver \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxi6 \
    libxtst6 \
    libxrandr2 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatspi2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libffi-dev \
    libsoxr-dev \
    zlib1g-dev \
    libjpeg-dev \
    libtiff-dev \
    libfreetype6-dev \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip, setuptools, and wheel
RUN pip install --upgrade pip setuptools torch torchvision torchaudio wheel cython spacy==3.2.0

# Install Pillow with its dependencies
RUN pip install pillow==9.3.0

# Reinstall PyTorch, NumPy, SciPy, cffi, llvmlite, and soxr manually in the container
RUN pip install numpy==2.0 && pip install pandas numba scipy cffi llvmlite==0.39.0 soxr librosa matplotlib==3.5.3

# Install Rust for compiling dependencies like sudachipy
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Coqui TTS
RUN pip install TTS

# Set the path to LLVM to ensure llvmlite can find it
ENV LD_LIBRARY_PATH=/usr/lib/llvm-10/lib

# Copy your project files into the Docker container
WORKDIR /app
COPY . /app

# Copy pre-installed Python packages from the virtual environment (site-packages)
# COPY ./myenv/lib/python3.10/site-packages /app/site-packages

# Remove potentially incompatible PyTorch, NumPy, SciPy, and cffi versions
# RUN rm -rf /app/site-packages/numpy /app/site-packages/torch /app/site-packages/torchaudio /app/site-packages/torchvision /app/site-packages/scipy /app/site-packages/cffi /app/site-packages/_cffi_backend /app/site-packages/numba /app/site-packages/llvmlite /app/site-packages/soxr /app/site-packages/soxr_ext /app/site-packages/pandas /app/site-packages/matplotlib


# Set the PYTHONPATH to include your application files
ENV PYTHONPATH=/app

# Expose the port your application will run on
EXPOSE 8082

# Set the command to run your application
CMD ["python", "coqui_tts.py"]