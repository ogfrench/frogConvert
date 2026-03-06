import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import { buildMidi, addNote } from './midi/midifilelib.js';

class VexFlowHandler implements FormatHandler {

  public name: string = "VexFlow";
  public supportedFormats?: FileFormat[];
  public ready: boolean = false;
  public requiresMainThread = true;
  private static fontsLoaded = false;

  async init() {
    this.supportedFormats = [
      CommonFormats.MUSICXML.builder("musicxml").allowFrom(),
      CommonFormats.MXL.builder("mxl").allowFrom(),
      CommonFormats.HTML.builder("html").allowTo(),
      { name: "MIDI", format: "mid", extension: "mid", mime: "audio/midi", from: false, to: true, internal: "mid", category: "audio", lossless: false }
    ];

    // Load VexFlow fonts (required for VexFlow 5)
    if (!VexFlowHandler.fontsLoaded) {
      try {
        const { default: VexFlow } = await import('vexflow');
        await VexFlow.loadFonts('Bravura', 'Academico');
        VexFlowHandler.fontsLoaded = true;
        console.log('VexFlow fonts loaded successfully');
      } catch (e) {
        console.warn('Error loading VexFlow fonts:', e);
        // Try to continue anyway
      }
    }

    this.ready = true;
  }

  /**
   * Convert MusicXML to MIDI event table
   */
  private musicXMLToMidiEvents(xmlString: string): any[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "application/xml");

    // Check for parsing errors
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      throw new Error("Failed to parse MusicXML: " + parserError.textContent);
    }

    // Check for score-partwise or score-timewise root element
    const scorePartwise = doc.querySelector("score-partwise");
    const scoreTimewise = doc.querySelector("score-timewise");

    if (!scorePartwise && !scoreTimewise) {
      console.error("XML structure:", doc.documentElement?.tagName);
      throw new Error("Invalid MusicXML: missing score-partwise or score-timewise element");
    }

    const events: any[] = [];
    const ticksPerBeat = 480; // Standard MIDI resolution
    let currentTick = 0;
    let currentTempo = 120; // Default BPM

    // Note name to MIDI number mapping
    const noteToMidi = (step: string, octave: number, alter: number = 0): number => {
      const noteMap: Record<string, number> = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
      const baseNote = noteMap[step.toUpperCase()];
      if (baseNote === undefined) return 60; // Default to middle C
      return baseNote + (octave + 1) * 12 + alter;
    };

    // Parse divisions (ticks per quarter note in MusicXML)
    // Divisions can be in different places in the structure
    let divisionsEl = doc.querySelector("divisions");
    if (!divisionsEl) {
      // Try looking in attributes
      divisionsEl = doc.querySelector("attributes divisions");
    }
    const divisions = divisionsEl ? parseInt(divisionsEl.textContent || "1") : 1;
    const ticksPerDivision = ticksPerBeat / divisions;

    // Parse tempo from sound or direction elements
    const soundEl = doc.querySelector("sound[tempo]");
    if (soundEl) {
      const tempoStr = soundEl.getAttribute("tempo");
      if (tempoStr) {
        currentTempo = parseFloat(tempoStr);
      }
    }

    // Get all parts (tracks) - they are direct children of score-partwise
    const parts = scorePartwise ?
      scorePartwise.querySelectorAll(":scope > part") :
      scoreTimewise ? scoreTimewise.querySelectorAll(":scope > part") : [];

    if (parts.length === 0) {
      throw new Error("No parts found in MusicXML. The file may be empty or have an unsupported structure.");
    }

    parts.forEach((part, partIndex) => {
      let partTick = 0;
      const channel = partIndex % 16; // MIDI has 16 channels
      const track = 0; // Use single track (format 0) for better compatibility

      // Set program (instrument) if available
      const instrumentEl = part.querySelector("score-instrument");
      if (instrumentEl) {
        events.push({
          track: track,
          tick: 0,
          absoluteSec: null,
          type: "program_change",
          channel: channel,
          program: 0 // Default to Acoustic Grand Piano
        });
      }

      const measures = part.querySelectorAll("measure");

      measures.forEach((measure, measureIndex) => {
        const notes = measure.querySelectorAll("note");

        notes.forEach((note) => {
          const isRest = note.querySelector("rest") !== null;
          const isChord = note.querySelector("chord") !== null;

          // Get duration
          const durationEl = note.querySelector("duration");
          const duration = durationEl ? parseInt(durationEl.textContent || "0") : 0;
          const durationTicks = Math.round(duration * ticksPerDivision);

          // For non-chord notes, this is where the note starts
          // For chord notes, we need to use the previous note's start time
          let noteStartTick = partTick;

          if (!isRest) {
            const pitchEl = note.querySelector("pitch");
            if (pitchEl) {
              const stepEl = pitchEl.querySelector("step");
              const octaveEl = pitchEl.querySelector("octave");
              const alterEl = pitchEl.querySelector("alter");

              if (stepEl && octaveEl) {
                const step = stepEl.textContent || "C";
                const octave = parseInt(octaveEl.textContent || "4");
                const alter = alterEl ? parseInt(alterEl.textContent || "0") : 0;
                const midiNote = noteToMidi(step, octave, alter);

                // Validate MIDI note is in valid range (21-108 for standard piano)
                if (midiNote < 0 || midiNote > 127) {
                  console.warn(`Invalid MIDI note ${midiNote} (${step}${octave}${alter}), skipping`);
                  return;
                }

                // Skip extremely low notes that might be parsing errors
                if (midiNote < 21) {
                  console.warn(`Suspiciously low MIDI note ${midiNote} (${step}${octave}), skipping`);
                  return;
                }

                // Get velocity from dynamics (default to 80)
                let velocity = 80;
                const dynamicsEl = note.querySelector("dynamics");
                if (dynamicsEl) {
                  // Map dynamics to velocity (simplified)
                  if (dynamicsEl.querySelector("pp")) velocity = 40;
                  else if (dynamicsEl.querySelector("p")) velocity = 60;
                  else if (dynamicsEl.querySelector("mp")) velocity = 70;
                  else if (dynamicsEl.querySelector("mf")) velocity = 85;
                  else if (dynamicsEl.querySelector("f")) velocity = 100;
                  else if (dynamicsEl.querySelector("ff")) velocity = 115;
                }

                addNote(events, track, channel, noteStartTick, midiNote, durationTicks, velocity);
              }
            }
          }

          // Only advance time if this is not a chord note
          if (!isChord) {
            partTick += durationTicks;
          }
        });
      });
    });

    // Important: Don't call initTrack - we'll manually create the header
    // to ensure proper format 0 MIDI file structure

    // Add header manually
    const usedTracks = new Set(events.filter(e => e.track >= 0).map(e => e.track));
    events.unshift(
      {
        track: -1,
        tick: 0,
        absoluteSec: null,
        type: "header",
        format: 0,  // Force format 0 (single track)
        numTracks: 1,  // Force single track
        division: ticksPerBeat,
        ticksPerBeat: ticksPerBeat
      },
      {
        track: 0,
        tick: 0,
        absoluteSec: null,
        type: "meta",
        metaType: 0x51,
        metaName: "Set Tempo",
        tempo: Math.round(60_000_000 / currentTempo),
        bpm: currentTempo
      },
    );

    return events;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {
    if (inputFormat.internal !== "musicxml" && inputFormat.internal !== "mxl") {
      throw "Invalid input format. Expected MusicXML or MXL.";
    }
    if (outputFormat.internal !== "html" && outputFormat.internal !== "mid") {
      throw "Invalid output format. Expected HTML or MIDI.";
    }

    const outputFiles: FileData[] = [];

    for (const inputFile of inputFiles) {
      try {
        // Get the MusicXML string
        let xmlString: string;

        if (inputFormat.internal === "mxl" || inputFile.name.toLowerCase().endsWith('.mxl')) {
          // MXL format (compressed) - need to decompress
          const JSZip = (await import('jszip')).default;
          const zip = new JSZip();
          await zip.loadAsync(inputFile.bytes);

          // Find the main MusicXML file (usually in rootfiles from META-INF/container.xml)
          let xmlFile = null;

          // First, try to read container.xml
          const containerFile = zip.file("META-INF/container.xml");
          if (containerFile) {
            try {
              const containerXml = await containerFile.async("string");
              const containerDoc = new DOMParser().parseFromString(containerXml, "application/xml");
              const rootfileEl = containerDoc.querySelector("rootfile");
              if (rootfileEl) {
                const fullPath = rootfileEl.getAttribute("full-path");
                if (fullPath) {
                  const foundFile = zip.file(fullPath);
                  if (foundFile) {
                    xmlFile = foundFile;
                  }
                }
              }
            } catch (e) {
              console.warn("Error reading container.xml:", e);
            }
          }

          // If no container.xml or it didn't work, look for XML files
          if (!xmlFile) {
            const xmlFiles = zip.file(/\.xml$/i);
            // Skip META-INF files and container.xml
            xmlFile = xmlFiles.find(f => !f.name.includes("META-INF") && !f.name.includes("container.xml"));
            if (!xmlFile && xmlFiles.length > 0) {
              xmlFile = xmlFiles[0];
            }
          }

          if (!xmlFile) {
            throw new Error("Could not find MusicXML file in MXL archive");
          }

          xmlString = await xmlFile.async("string");
        } else {
          // Uncompressed MusicXML format
          xmlString = new TextDecoder().decode(inputFile.bytes);
        }

        // Handle MIDI output
        if (outputFormat.internal === "mid") {
          const events = this.musicXMLToMidiEvents(xmlString);

          // Validate that we have some notes
          const noteEvents = events.filter(e => e.type === "note_on" || e.type === "note_off");
          if (noteEvents.length === 0) {
            throw new Error("No notes found in MusicXML file");
          }

          const midiBytes = buildMidi(events);

          // Validate MIDI header
          if (midiBytes.length < 14 ||
            midiBytes[0] !== 0x4d || midiBytes[1] !== 0x54 ||
            midiBytes[2] !== 0x68 || midiBytes[3] !== 0x64) {
            throw new Error("Failed to generate valid MIDI file");
          }

          const name = inputFile.name.replace(/\.(musicxml|mxl|xml)$/i, ".mid");
          outputFiles.push({ bytes: midiBytes, name });
          continue;
        }

        // Handle HTML output
        // Ensure fonts are loaded before rendering
        const { default: VexFlow } = await import('vexflow');
        if (!VexFlowHandler.fontsLoaded) {
          await VexFlow.loadFonts('Bravura', 'Academico');
          VexFlowHandler.fontsLoaded = true;
        }
        VexFlow.setFonts('Bravura', 'Academico');

        // Configure vexml with proper width for multi-line rendering
        const vexml = await import('@stringsync/vexml');
        const config = {
          ...vexml.DEFAULT_CONFIG,
          WIDTH: 800, // Page width - controls line wrapping
          VIEWPORT_SCALE: 1.0,
          DRAWING_BACKEND: 'canvas' as const, // Use canvas to avoid font loading issues
        };

        // Create a temporary div element for vexml to render into
        const div = document.createElement("div");
        div.style.width = "800px";
        div.style.backgroundColor = "white";
        div.style.padding = "20px";

        // Render using vexml - we already have xmlString from above
        const score = vexml.renderMusicXML(xmlString, div, { config });

        // Wait a bit for rendering to complete
        await new Promise(resolve => setTimeout(resolve, 100));

        // Extract the rendered content (canvas elements with music notation)
        const canvases = div.querySelectorAll('canvas');
        if (canvases.length === 0) {
          throw new Error("Failed to render MusicXML - no canvases generated");
        }

        // Convert canvases to base64 images for embedding in HTML
        const imageDataPromises = Array.from(canvases).map(canvas => {
          return new Promise<string>((resolve) => {
            canvas.toBlob((blob) => {
              if (blob) {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              } else {
                resolve(canvas.toDataURL('image/png'));
              }
            }, 'image/png');
          });
        });

        const imageDataUrls = await Promise.all(imageDataPromises);

        // Create HTML with embedded images
        const imagesHtml = imageDataUrls.map((dataUrl, idx) =>
          `<img src="${dataUrl}" alt="Music notation page ${idx + 1}" style="display: block; width: 100%; margin-bottom: 20px;" />`
        ).join('\n    ');

        // Create a complete HTML document with embedded images
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Music Score</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: white;
      font-family: Arial, sans-serif;
    }
    .vexml-container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      padding: 20px;
    }
    img {
      display: block;
      width: 100%;
      height: auto;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="vexml-container">
    ${imagesHtml}
  </div>
</body>
</html>`;

        // Convert HTML to Uint8Array
        const bytes = new TextEncoder().encode(html);
        const name = inputFile.name.replace(/\.(musicxml|mxl|xml)$/i, ".html");

        outputFiles.push({ bytes, name });
      } catch (error) {
        console.error("Error converting MusicXML to HTML:", error);
        throw error;
      }
    }

    return outputFiles;
  }
}

export default VexFlowHandler;
