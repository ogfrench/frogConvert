import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import CommonFormats from "../core/CommonFormats/CommonFormats.ts";
import { Decrypter } from "./rpgmvp-decrypter/scripts/Decrypter.js";
import { RPGFile } from "./rpgmvp-decrypter/scripts/RPGFile.js";

class rpgmvpHandler implements FormatHandler {

    public name: string = "rpgmvp";
    public supportedFormats?: FileFormat[];
    public ready: boolean = false;
    public requiresMainThread = true; // uses FileReader + window

    async init() {
        this.supportedFormats = [
            {
                name: "RPG Maker MV PNG (RPGMVP)",
                format: "rpgmvp",
                extension: "rpgmvp",
                mime: "application/x-rpgmvp",
                from: true,
                to: false,
                internal: "rpgmvp",
                category: "image",
                lossless: true
            },
            CommonFormats.PNG.builder("png")
                .markLossless().allowFrom(false).allowTo(true),
        ];
        this.ready = true;
    }

    async doConvert(
        inputFiles: FileData[],
        inputFormat: FileFormat,
        outputFormat: FileFormat
    ): Promise<FileData[]> {
        const outputFiles: FileData[] = [];

        if (inputFormat.internal !== "rpgmvp" || outputFormat.internal !== "png") {
            throw Error("Invalid input/output format.");
        }

        for (const inputFile of inputFiles) {
            const as_buffer = inputFile.bytes.slice().buffer;

            const encryption_key = Decrypter.getKeyFromPNG(16, as_buffer);
            const decrypter = new Decrypter(encryption_key);

            const rpgFile = new RPGFile(new File([as_buffer], inputFile.name), null);
            await new Promise<void>((resolve, reject) => {
                decrypter.decryptFile(rpgFile, (decrypted: RPGFile, e: Error) => {
                    if (e) { reject(e); return; }
                    const bytes = new Uint8Array(decrypted.content);
                    const name = inputFile.name.split(".").slice(0, -1).join(".") + "." + outputFormat.extension;
                    outputFiles.push({ bytes, name });
                    resolve();
                });
            });
        }

        return outputFiles;
    }

}

export default rpgmvpHandler;