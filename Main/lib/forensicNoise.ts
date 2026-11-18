function simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return hash >>> 0;
}

function mulberry32(a: number): () => number {
    return function () {
        a |= 0;
        a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

const NOISE_PIXEL_FRACTION = 0.001;
const NOISE_ALPHA = 1;

export function applyForensicNoise(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    seed: string
) {
    if (width < 10 || height < 10) return;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const numPixels = Math.max(1, Math.floor((width * height) * NOISE_PIXEL_FRACTION));
    const rng = mulberry32(simpleHash(seed));

    for (let i = 0; i < numPixels; i++) {
        const px = Math.floor(rng() * width);
        const py = Math.floor(rng() * height);
        const idx = (py * width + px) * 4;
        data[idx] = Math.floor(rng() * 256);
        data[idx + 1] = Math.floor(rng() * 256);
        data[idx + 2] = Math.floor(rng() * 256);
        data[idx + 3] = NOISE_ALPHA;
    }

    ctx.putImageData(imageData, 0, 0);
}
