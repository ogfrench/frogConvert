// Shared WebGL bootstrap for Three.js handlers.
//
// CI runners, VMs, RDP sessions and Chrome with hardware-accel disabled all
// fall back to ANGLE → Microsoft Basic Render Driver, where WebGL context
// creation throws and three.js logs three internal errors before bubbling
// up. Pre-flighting with a cheap getContext() probe short-circuits that
// noise and lets us surface a single, actionable error to the user.

export function createWebGLRenderer(THREE: any, params?: Record<string, unknown>): any {
    if (typeof document !== "undefined") {
        const probe = document.createElement("canvas");
        const gl = probe.getContext("webgl2") || probe.getContext("webgl");
        if (!gl) {
            throw new Error(
                "WebGL is not available in this environment. 3D conversions need a GPU-capable browser. " +
                "On Windows, enable hardware acceleration in browser settings; on a VM or remote-desktop session, run locally."
            );
        }
    }
    try {
        return new THREE.WebGLRenderer(params);
    } catch (err: any) {
        const reason = err?.message ?? "unknown error";
        throw new Error(
            `Could not create a WebGL context (${reason}). 3D conversions need a GPU-capable browser. ` +
            `If the renderer fell back to the Microsoft Basic Render Driver, hardware acceleration is disabled or the GPU driver is unavailable.`
        );
    }
}
