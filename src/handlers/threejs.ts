import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";

// Removed static static imports of three, GLTFLoader, OBJLoader

class threejsHandler implements FormatHandler {

  public name: string = "threejs";
  public supportedFormats = [
    {
      name: "GL Transmission Format Binary",
      format: "glb",
      extension: "glb",
      mime: "model/gltf-binary",
      from: true,
      to: false,
      internal: "glb",
      category: "model",
      lossless: false
    },
    {
      name: "GL Transmission Format",
      format: "gltf",
      extension: "gltf",
      mime: "model/gltf+json",
      from: true,
      to: false,
      internal: "glb",
      category: "model",
      lossless: false
    },
    {
      name: "Wavefront OBJ",
      format: "obj",
      extension: "obj",
      mime: "model/obj",
      from: true,
      to: false,
      internal: "obj",
      category: "model",
      lossless: false,
    },
    CommonFormats.PNG.supported("png", false, true),
    CommonFormats.JPEG.supported("jpeg", false, true),
    CommonFormats.WEBP.supported("webp", false, true)
  ];
  public ready: boolean = false;
  public requiresMainThread = true;

  private scene: any;
  private camera: any;
  private renderer: any;
  private THREE: any;

  async init() {
    // We defer the loading of THREE until convert time
    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {
    const outputFiles: FileData[] = [];

    if (!this.THREE) {
      this.THREE = await import('three');
      this.scene = new this.THREE.Scene();
      this.camera = new this.THREE.PerspectiveCamera(90, 16 / 9, 0.1, 4096);
      this.renderer = new this.THREE.WebGLRenderer({ preserveDrawingBuffer: true });
      this.renderer.setSize(960, 540);
    }

    const { THREE, scene, camera, renderer } = this;

    for (const inputFile of inputFiles) {

      const blob = new Blob([inputFile.bytes as BlobPart]);
      const url = URL.createObjectURL(blob);

      let object: any;

      switch (inputFormat.internal) {
        case "glb": {
          const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
          const gltf: any = await new Promise((resolve, reject) => {
            const loader = new GLTFLoader();
            loader.load(url, resolve, undefined, reject);
          });
          object = gltf.scene;
          break;
        }
        case "obj":
          const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
          object = await new Promise((resolve, reject) => {
            const loader = new OBJLoader();
            loader.load(url, resolve, undefined, reject);
          });
          break;
        default:
          throw new Error("Invalid input format");
      }

      const bbox = new THREE.Box3().setFromObject(object);
      bbox.getCenter(camera.position);
      camera.position.z = bbox.max.z * 2;

      URL.revokeObjectURL(url);

      scene.background = new THREE.Color(0x424242);
      scene.add(object);
      try {
        renderer.render(scene, camera);

        const bytes: Uint8Array = await new Promise((resolve, reject) => {
          this.renderer.domElement.toBlob((blob: Blob | null) => {
            if (!blob) return reject("Canvas output failed");
            blob.arrayBuffer().then((buf: ArrayBuffer) => resolve(new Uint8Array(buf)));
          }, outputFormat.mime);
        });
        const name = inputFile.name.split(".").slice(0, -1).join(".") + "." + outputFormat.extension;
        outputFiles.push({ bytes, name });
      } finally {
        // Release GPU resources held by the loaded model. Three.js doesn't
        // auto-dispose geometries/materials/textures — each call leaks them
        // until the tab closes. Traverse and release everything reachable
        // from the loaded object, regardless of whether the render succeeded.
        scene.remove(object);
        disposeObject3D(object);
      }
    }

    return outputFiles;
  }

}

// Recursively release GPU resources attached to a loaded three.js object.
function disposeObject3D(root: any): void {
    root.traverse?.((node: any) => {
        node.geometry?.dispose?.();
        const mat = node.material;
        if (Array.isArray(mat)) {
            for (const m of mat) disposeMaterial(m);
        } else if (mat) {
            disposeMaterial(mat);
        }
    });
}

function disposeMaterial(mat: any): void {
    // Dispose any Texture-typed properties (map, normalMap, emissiveMap, …).
    for (const key of Object.keys(mat)) {
        const v = mat[key];
        if (v && typeof v === "object" && typeof v.dispose === "function" && v.isTexture) {
            v.dispose();
        }
    }
    mat.dispose?.();
}

export default threejsHandler;
