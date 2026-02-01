import * as fs from "fs";
import * as path from "path";
import { getAudioDurationInSeconds } from "get-audio-duration";
import { ChildProcess, spawn } from "child_process";
import dotenv from "dotenv";
import { ttsDir } from "../../utils/dir";
import { TTSResult } from "../../type";

dotenv.config();

const piperHttpHost = process.env.PIPER_HTTP_HOST || "localhost";
const piperHttpPort = process.env.PIPER_HTTP_PORT || defaultPortMap.piperHttp.toString();
const piperHttpLengthScale = process.env.PIPER_HTTP_LENGTH_SCALE || "1.0";

const piperHttpTTS = async (text: string): Promise<TTSResult> => {
  return new Promise((resolve) => {
    const now = Date.now();
    const tempWavFile = path.join(ttsDir, `piper_http_${now}.wav`);
    const convertedWavFile = path.join(ttsDir, `piper_http_${now}_converted.wav`);

    // Use GET request with URL encoding. 
    // This is the most compatible way for the Piper HTTP Python server.
    const piperProcess = spawn('curl', [
      "-s", 
      "-G",                                        // Use GET
      "--data-urlencode", `text=${text}`,          // Encode Romanian chars correctly
      "--data-urlencode", `length_scale=${piperHttpLengthScale}`,
      "-o", tempWavFile,
      `http://${piperHttpHost}:${piperHttpPort}/`
    ]);

    piperProcess.on("close", async (code: number) => {
      // Check if file exists and is a real audio file (RIFF header)
      if (code !== 0 || !fs.existsSync(tempWavFile) || fs.statSync(tempWavFile).size < 1000) {
        if (fs.existsSync(tempWavFile)) {
            const content = fs.readFileSync(tempWavFile, 'utf8');
            if (content.includes("html")) console.error("Server returned HTML Error. Check Docker logs.");
            fs.unlinkSync(tempWavFile);
        }
        resolve({ duration: 0 });
        return;
      }

      try {
        // Sox: Convert to a standard format that the Pi HAT definitely supports
        const soxProcess = spawn("sox", [
          tempWavFile,
          "-r", "22050",
          "-c", "1",
          "-b", "16",
          convertedWavFile
        ]);

        soxProcess.on("close", async (soxCode: number) => {
          if (soxCode !== 0) {
            console.error("Sox failed to convert audio.");
            resolve({ duration: 0 });
            return;
          }
          
          const duration = (await getAudioDurationInSeconds(convertedWavFile)) * 1000;
          fs.unlinkSync(tempWavFile);
          resolve({ filePath: convertedWavFile, duration });
        });
      } catch (e) {
        console.error("TTS processing error:", e);
        resolve({ duration: 0 });
      }
    });
  });
};

export default piperHttpTTS;
