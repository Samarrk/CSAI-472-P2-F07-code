# Tamakkan - تمكّن

Tamakkan is an AI-based driving evaluation platform that analyzes live dashcam video to detect unsafe driving behaviors and provide real-time feedback to drivers.

The current version focuses on individual licensed drivers by generating a driving score from 0 to 5, showing real-time alerts, and saving session results.

## Features

- Real-time dashcam video analysis
- Unsafe driving event detection
- Driving score generation
- Real-time alerts
- Session summary and history
- Mobile app connected to the onboard unit
- Supabase database integration

## Detected Events

- Lane departure
- Tailgating
- Red light ahead
- Ran red light
- Near-miss situations
- Speed-limit sign reading

## Models and Components

- YOLOv11s for object detection
- ByteTrack for object tracking
- Depth Anything V2 Small for depth estimation
- UFLD-v2 ResNet-18 for lane detection
- HSV classifier for traffic-light color detection
- EasyOCR for speed-limit sign reading

## Technologies Used

- Python
- FastAPI
- WebSocket
- OpenCV
- PyTorch
- TensorRT
- React Native
- Expo
- Supabase
- NVIDIA Jetson Orin NX

## External Repositories and Resources

- YOLO / Ultralytics: https://github.com/ultralytics/ultralytics
- UFLD-v2: https://github.com/cfzd/Ultra-Fast-Lane-Detection-v2
- Depth Anything V2: https://github.com/DepthAnything/Depth-Anything-V2
- EasyOCR: https://github.com/JaidedAI/EasyOCR
- BDD100K Dataset: http://bdd-data.berkeley.edu/download.html
- YOLO and ByteTrack Weights: Add Google Drive link here

## How to Run

Clone the repository:

```bash
git clone https://github.com/Samarrk/CSAI-472-P2-F07-code.git
cd tamakkan
```

Install the required Python packages:

```bash
pip install -r requirements.txt
```

Clone the external model repositories needed for the pipeline:

```bash
git clone https://github.com/DepthAnything/Depth-Anything-V2.git
git clone https://github.com/cfzd/Ultra-Fast-Lane-Detection-v2.git
```

Download the required model files:

* Download the YOLOv11s and ByteTrack weights from the provided Google Drive link.
* Download the Depth Anything V2 Small model file from the Depth Anything V2 repository.
* Download the UFLD-v2 ResNet-18 CULane model file from the UFLD-v2 repository.

Place the downloaded model files according to the paths used in the project code or configuration.

Run the backend server:

```bash
cd backend
uvicorn server.app:app --host 0.0.0.0 --port 8000
```

Run the mobile app:

```bash
cd frontend
npm install
npx expo start
```

## Current Scope

The current prototype supports the individual licensed driver workflow, including registration, device connection, live session alerts, final score, and session history.

Trainee evaluation, instructor approval, and license-test evaluation are planned as future work.

## Team Members

- Samar Rafat Kintab
- Lina Mohammad Bader
- Lamar Bandar Felemban
- Bashair Fahad Al-Jabri

Supervised by: Dr. Eiman Talal Al-Harby

## Project Status

This project is developed as a graduation project for the Bachelor of Science in Artificial Intelligence at Umm Al-Qura University.
