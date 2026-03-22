const BASE_FRAME = "ദ്ദി₍𝄐⩌𝄐₎";
const FROG_FRAMES = [
    "/₍𝄐⩌𝄐₎/",
    "ヽ₍𝄐⩌𝄐₎ﾉ",
    "ﾉ₍𝄐⩌𝄐₎ヽ",
    "₍𝄐⩌𝄐₎",
    "₍𝄐-𝄐₎",
    "\\₍𝄐⩌𝄐₎/",
    "/₍𝄐~𝄐₎/",
    "₍𝄐~𝄐₎",
];

/** Creates a crossfading frog animation element for the success popup. */
export function createDancingFrog(): HTMLElement {
    const frogDiv = document.createElement("div");
    frogDiv.className = "dancing-frog";
    const spanA = document.createElement("span");
    const spanB = document.createElement("span");
    spanA.textContent = BASE_FRAME;
    spanB.textContent = BASE_FRAME;
    spanA.style.opacity = "1";
    spanB.style.opacity = "0";
    frogDiv.appendChild(spanA);
    frogDiv.appendChild(spanB);
    let frameIndex = 0;
    let curSpan = spanA, nxtSpan = spanB;
    let frogInterval: ReturnType<typeof setInterval> | null = null;
    const crossfadeTo = (text: string) => {
        nxtSpan.textContent = text;
        nxtSpan.style.opacity = "1";
        curSpan.style.opacity = "0";
        [curSpan, nxtSpan] = [nxtSpan, curSpan];
    };
    frogDiv.addEventListener("mouseenter", () => {
        if (frogInterval) return;
        frogInterval = setInterval(() => {
            if (!document.contains(frogDiv)) { clearInterval(frogInterval!); frogInterval = null; return; }
            frameIndex = (frameIndex + 1) % FROG_FRAMES.length;
            crossfadeTo(FROG_FRAMES[frameIndex]);
        }, 700);
    });
    frogDiv.addEventListener("mouseleave", () => {
        if (frogInterval) { clearInterval(frogInterval); frogInterval = null; }
        frameIndex = 0;
        crossfadeTo(BASE_FRAME);
    });
    return frogDiv;
}
