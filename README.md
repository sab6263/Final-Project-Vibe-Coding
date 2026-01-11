# Contexture - Qualitative Research & Transcription

Contexture is a powerful, privacy-first web application designed for qualitative researchers to conduct interviews, transcribe audio in real-time, and perform advanced coding and analysis—all within a premium, modern interface.


## 🚀 Key Features

*   **Live Transcription**: Real-time speech-to-text using the Web Speech API with multi-language support.
*   **Precision Notes**: Take inline notes and highlights directly on the live transcript without interrupting the recording or losing words.
*   **Qualitative Coding**: Create, organize, and apply axial codes to your research data.
*   **Analysis Tools**: Visualize connections between codes with interactive network graphs (Vis.js).
*   **PDF Import**: Import existing interview transcripts from PDF for coding and analysis.
*   **Privacy-First Architecture**: Uses Firebase Anonymous Authentication—zero personal data required. Your data is tied to your browser session.

## 📥 Getting Started

Contexture is designed to work **immediately** after cloning for trial and demonstration purposes.

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/sab6263/Final-Project-Vibe-Coding.git
    cd Final-Project-Vibe-Coding
    ```

2.  **Run locally**:
    Using npm:
    ```bash
    npm install
    npm start
    ```
    Alternatively, using npx:
    ```bash
    npx serve .
    ```

### ☁️ Custom Firebase Setup (Recommended for Research)
By default, the app uses a shared demonstration database. For actual research projects where you need to **own and protect your data**, you should set up your own Firebase instance:
1.  Create a project in the [Firebase Console](https://console.firebase.google.com/).
2.  Follow the instructions in `FIREBASE_SETUP.md` to enable Anonymous Auth and Firestore.
3.  Update `firebase-config.js` with your own credentials.

### Why not just open index.html?
Browsers (especially Chrome) have strict security policies for the `file://` protocol. Running the app directly from a file may cause:
*   Repeated microphone permission prompts.
*   Speech recognition failure.
*   Firebase Authentication issues.

## 🎙 Browser Support
*   **Google Chrome**: (Highly Recommended) Full support for Web Speech API and the most stable experience.
*   **Microsoft Edge**: Supported (Chromium-based).
*   **Safari/Firefox**: Limited support for real-time transcription features.

## 📄 License
This project was developed as part of the MXD Semester 2 - Vibe Coding curriculum.
