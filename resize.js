import { createCanvas, loadImage } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

async function resize() {
    const inputPath = 'cover.png';
    const outputPath = 'cover_small.jpg';

    const image = await loadImage(inputPath);
    // Resize to 400x400 to ensure small size
    const canvas = createCanvas(400, 400);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, 400, 400);

    // Save as JPEG with low quality to ensure it's under 64KB
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.3 });
    writeFileSync(outputPath, buffer);
    console.log('Resized image saved to cover_small.jpg');
}

resize().catch(console.error);
