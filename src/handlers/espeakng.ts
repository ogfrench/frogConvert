import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import { SimpleTTS } from "./espeakng.js/js/espeakng-simple.js";
import { WaveFile } from "wavefile";

const SimpleTTSConstructor = SimpleTTS as unknown as {
  new(options: { defaultVoice: string; defaultRate: number; defaultPitch: number; enhanceAudio: boolean }): {
    sampleRate: number;
    onReady(callback: () => void): void;
    speak(text: string, callback: (audio: Float32Array, sampleRate: number) => void): void;
  };
  createAudioBuffer(audio: Float32Array, sampleRate: number): AudioBuffer | null;
};

type TTSInstance = InstanceType<typeof SimpleTTSConstructor>;

class espeakngHandler implements FormatHandler {
  public name: string = "espeakng";
  public ready: boolean = true;
  public requiresMainThread = true;
  #tts: TTSInstance | undefined = undefined;

  public supportedFormats: FileFormat[] = [
    CommonFormats.TEXT.supported("text", true, false),
    CommonFormats.WAV.supported("wav", false, true)
  ];

  async init() {
    this.ready = true;
  }

  // here so we lazy load the TTS instead of waiting for it in `init`
  async getTTS(): Promise<TTSInstance> {
    if(this.#tts == undefined) {
      await new Promise<void>(resolve => {
        this.#tts = new SimpleTTSConstructor({
          defaultVoice: "en",
          defaultRate: 220,
          defaultPitch: 200,
          enhanceAudio: true
        });
        this.#tts.onReady(() => {
          resolve();
        })
      });
    }
    return this.#tts!;
  }

  async doConvert (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {
    const tts = await this.getTTS();
    return Promise.all(inputFiles.map(async(file) => {
      const audio = await new Promise<AudioBuffer>(resolve => {
        tts.speak(new TextDecoder().decode(file.bytes), (audio: Float32Array, sampleRate: number) => {
          resolve(SimpleTTSConstructor.createAudioBuffer(audio, tts.sampleRate) as AudioBuffer);
        })
      });
      const samples = audio.getChannelData(0);
      const wav = new WaveFile();
      // Increasing pitch doesn't seem to do anything, so instead we
      // decrease playback rate and increase playback sample rate
      wav.fromScratch(1, tts.sampleRate * 1.4, "32f", samples);
      return {
        name: file.name.split(".").slice(0, -1).join(".")+".wav",
        bytes: wav.toBuffer()
      }
    }))
  }
}

export default espeakngHandler;
