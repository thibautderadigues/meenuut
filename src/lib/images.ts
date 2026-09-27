/** Au-delà, l'image est réduite avant d'être stockée : 1600 px suffisent pour la colonne et l'impression. */
const MAX_DIMENSION = 1600;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Image → data URL, stockée directement dans le document (local-first, pas de serveur).
 * Les grandes images sont réduites ; GIF et SVG restent intacts (animation, vectoriel).
 */
export async function imageToDataUrl(file: File): Promise<string> {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return readAsDataUrl(file);

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1_500_000) {
    bitmap.close();
    return readAsDataUrl(file);
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // PNG garde la transparence (captures d'écran, logos) ; le reste passe en JPEG.
  return file.type === 'image/png'
    ? canvas.toDataURL('image/png')
    : canvas.toDataURL('image/jpeg', 0.86);
}

export function imageFiles(files: FileList | null | undefined): File[] {
  return Array.from(files ?? []).filter((file) => file.type.startsWith('image/'));
}

/** Ouvre le sélecteur de fichiers du système. */
export function pickImages(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => resolve(imageFiles(input.files));
    input.click();
  });
}

export function altFromFileName(file: File): string {
  return file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
}
